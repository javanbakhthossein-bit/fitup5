package ir.fittup.app

import android.net.Network
import android.util.Log
import java.io.BufferedInputStream
import java.io.IOException
import java.io.InputStream
import java.io.OutputStream
import java.net.InetAddress
import java.net.InetSocketAddress
import java.net.ServerSocket
import java.net.Socket
import java.util.Collections
import java.util.concurrent.ExecutorService
import java.util.concurrent.Executors
import java.util.concurrent.atomic.AtomicBoolean

/**
 * ─── v1.17.4 (v206) — LoopbackProxy: پراکسی محلی WebView — DNS هرگز وارد کش WebView نمی‌شود ───
 *
 * درس واقعی v205 (گزارش مالک: «راهکار نسخه‌های جدید درست نشد؛ فقط خاموش‌کردن
 * FakeDNS پت‌نگ درستش کرد»): bindProcessToNetwork فقط سوکت‌ها/resolveهای
 * «آیندهٔ» پروسه را به شبکهٔ سالم قفل می‌کند — ولی VPNهای FakeDNS (مثل پت‌نگ
 * با پیش‌فرض روشن) حین فعال‌بودن به WebView «IP فیک» (رنج ۱۹۸.۱۸.۰.۰/۱۵)
 * می‌دهند و WebView آن‌ها را در HostCache خصوصی خودش کش می‌کند؛ بعد از
 * خاموش‌شدن VPN، هر درخواست تازه به همان IP فیک می‌رود → بلک‌هول بی‌پاسخ
 * → هنگ ۳۰-۶۰ ثانیه‌ای تا انقضای کش. کش DNS داخلی WebView با هیچ API
 * اندرویدی پاک‌شدنی نیست — پس باید کاری کنیم اصلاً پر نشود.
 *
 * راه‌حل استاندارد (androidx.webkit ProxyController): همهٔ ترافیک WebView از
 * یک پراکسی HTTP کوچک داخل خود اپ (۱۲۷.۰.۰.۱) رد می‌شود:
 *
 *  ۱) WebView هیچ‌وقت خودش DNS حل نمی‌کند — نام دامنه داخل خط CONNECT برای
 *     ما می‌آید و ما «هر بار» تازه resolve می‌کنیم (مسیر netd هر شبکه —
 *     بدون کش JVM) → کش مسموم عملاً از معادله خارج می‌شود؛ با «هر» VPN
 *     FakeDNSی هم اپ سالم می‌ماند.
 *  ۲) کانکشن‌های بالادستی در لحظهٔ تغییر شبکه (NetworkChangeMonitor v205)
 *     بسته می‌شوند → مرگ فوریِ میلی‌ثانیه‌ای به‌جای هنگ ۳۰-۶۰ ثانیه‌ای →
 *     درخواست بعدی با DNS تازه روی شبکهٔ سالم ساخته می‌شود (وفاق ۱-۲ ثانیه‌ای).
 *  ۳) تونل CONNECT کاملاً شفاف است — TLS سرتاسری بین WebView و سرور می‌ماند
 *     (محتوا دست اپ نمی‌رسد)، SSE/WebSocket/HTTP2 داخل تونل سالم‌اند.
 *  ۴) دارایی‌های بذر (shouldInterceptRequest → serveSeedAsset) قبل از استک
 *     شبکه هندل می‌شوند و اصلاً به پراکسی نمی‌رسند؛ file:// هم رد نمی‌شود.
 *  ۵) نشانی‌های لوکال در ProxyConfig bypass شده‌اند (localhost/127.0.0.1/::1).
 *
 * ضد خرابی (دیرکتیو مالک: «هیچ مشکلی نباید پیش بیاید»):
 *  • اگر WebView قدیمی بود (PROXY_OVERRIDE ساپورت نمی‌شد) یا پراکسی به هر
 *    دلیل بالا نیامد → override ست نمی‌شود و رفتار v205 دست‌نخورده می‌ماند.
 *  • همهٔ مسیرها try/catch؛ هیچ استثنایی از پراکسی به پروسهٔ اپ نمی‌رسد؛
 *    ترد‌ها daemon هستند و با پروسه تمام می‌شوند.
 *  • DNS فیک فقط وقتی VPN فعال است قابل‌قبول است (از دل تونل کار می‌کند)؛
 *    با VPN خاموش، IP فیک = کش مسموم → رد فوری → پاسخ 502 سریع (نه هنگ) —
 *    موتور خودترمیمی وب (v205) همان لحظه retry می‌کند.
 */
class LoopbackProxy private constructor() {

    companion object {
        private const val TAG = "FitUpApp"
        /** مهلت اتصال بالادستی — به‌قدر کافی کوتاه که بلک‌هول «سریع» رد شود، نه هنگ */
        private const val UPSTREAM_CONNECT_TIMEOUT_MS = 8_000
        /** اندازهٔ بافر پمپ دوسویهٔ تونل */
        private const val PUMP_BUFFER_SIZE = 16 * 1024

        @Volatile
        private var instance: LoopbackProxy? = null

        fun get(): LoopbackProxy =
            instance ?: synchronized(this) {
                instance ?: LoopbackProxy().also { instance = it }
            }
    }

    /** پورت واقعی پراکسی بعد از start (۰ = هنوز شروع نشده) */
    @Volatile
    var port: Int = 0
        private set

    /** تأمین «شبکهٔ مقصد» — همان هدف bindProcessToNetwork در MainActivity */
    @Volatile
    var networkProvider: (() -> Network?)? = null

    /** وضعیت لحظه‌ای VPN — IP فیک فقط حین VPN معتبر است */
    @Volatile
    var vpnActiveProvider: (() -> Boolean)? = null

    private val running = AtomicBoolean(false)
    private var serverSocket: ServerSocket? = null
    private val executor: ExecutorService =
        Executors.newCachedThreadPool { r ->
            Thread(r).apply {
                isDaemon = true
                name = "fitup-lproxy"
            }
        }

    /** سوکت‌های بالادستی زنده — برای بستن فوری هنگام تغییر شبکه */
    private val upstreamSockets = Collections.synchronizedList(ArrayList<Socket>())

    val isRunning: Boolean
        get() = running.get() && port != 0

    /**
     * شروع پراکسی روی ۱۲۷.۰.۰.۱ با پورت دینامیک (بدون تداخل با هیچ سرویس دیگر).
     * idempotent — اگر از قبل روشن است همان برگردانده می‌شود.
     */
    fun start(): Boolean {
        if (isRunning) return true
        synchronized(this) {
            if (isRunning) return true
            return try {
                val ss = ServerSocket()
                // فقط لوپ‌بک — از بیرون دستگاه هیچ دسترسی‌ای نیست
                ss.bind(InetSocketAddress(InetAddress.getByName("127.0.0.1"), 0))
                serverSocket = ss
                port = ss.localPort
                running.set(true)
                executor.execute { acceptLoop(ss) }
                Log.i(TAG, "lproxy: started on 127.0.0.1:$port")
                true
            } catch (e: Throwable) {
                Log.w(TAG, "lproxy: start failed: ${e.message}")
                running.set(false)
                port = 0
                false
            }
        }
    }

    /** حلقهٔ پذیرش — هرگز نباید بمیرد؛ هر استثنایی جذب و ادامه می‌یابد */
    private fun acceptLoop(ss: ServerSocket) {
        while (running.get() && !ss.isClosed) {
            val client = try {
                ss.accept()
            } catch (_: Throwable) {
                break
            }
            executor.execute {
                try {
                    handleClient(client)
                } catch (e: Throwable) {
                    Log.d(TAG, "lproxy: client ended: ${e.javaClass.simpleName}")
                    closeQuietly(client)
                }
            }
        }
    }

    /** قطع همهٔ سوکت‌های بالادستی (تغییر شبکه/VPN) — مرگ فوری به‌جای هنگ */
    fun onNetworkChanged() {
        try {
            val sockets: List<Socket> = synchronized(upstreamSockets) {
                ArrayList(upstreamSockets).also { upstreamSockets.clear() }
            }
            if (sockets.isNotEmpty()) {
                for (s in sockets) closeQuietly(s)
                Log.i(TAG, "lproxy: network changed → ${sockets.size} upstream socket(s) closed (fast-death)")
            }
        } catch (e: Throwable) {
            Log.w(TAG, "lproxy: onNetworkChanged: ${e.message}")
        }
    }

    /* ───────────── هندل اتصال کلاینت (WebView) ───────────── */

    private fun handleClient(client: Socket) {
        client.tcpNoDelay = true
        val input = BufferedInputStream(client.getInputStream(), PUMP_BUFFER_SIZE)
        val firstLine = readAsciiLine(input) ?: run { closeQuietly(client); return }
        val parts = firstLine.split(" ")
        if (parts.size < 2) { closeQuietly(client); return }

        when {
            // اکثریت قریب به اتفاق ترافیک: HTTPS/WSS → تونل شفاف
            parts[0].equals("CONNECT", ignoreCase = true) -> {
                drainHeaders(input)
                handleConnect(client, input, parts[1])
            }
            // HTTP ساده با URI مطلق (کمیاب — فوروارد مینیمال با Connection: close)
            else -> handlePlainHttp(client, input, firstLine)
        }
    }

    /** CONNECT host:port → resolve تازه + تونل دوسویهٔ شفاف */
    private fun handleConnect(client: Socket, input: InputStream, authority: String) {
        val colon = authority.lastIndexOf(':')
        val host = if (colon > 0) authority.substring(0, colon) else authority
        val portNo = if (colon > 0) authority.substring(colon + 1).toIntOrNull() ?: 443 else 443

        if (host.isEmpty() || portNo !in 1..65535) {
            writeProxyError(client, "HTTP/1.1 400 Bad Request")
            return
        }

        val upstream = openUpstream(host, portNo)
        if (upstream == null) {
            // رد فوری (DNS فیک با VPN خاموش / DNS ناموجود / سرور نشدنی) —
            // Chromium درخواست را «سریع» می‌بندد؛ موتور خودترمیمی وب retry می‌کند
            writeProxyError(client, "HTTP/1.1 502 Bad Gateway")
            return
        }

        try {
            client.getOutputStream().apply {
                write("HTTP/1.1 200 Connection Established\r\n\r\n".toByteArray(Charsets.ISO_8859_1))
                flush()
            }
        } catch (_: Throwable) {
            closeQuietly(upstream)
            closeQuietly(client)
            return
        }

        registerUpstream(upstream)
        try {
            pumpBothWays(input, client, upstream)
        } finally {
            unregisterUpstream(upstream)
            closeQuietly(upstream)
            closeQuietly(client)
        }
    }

    /** فوروارد مینیمال HTTP مطلق (بدون keep-alive — Connection: close) */
    private fun handlePlainHttp(client: Socket, input: BufferedInputStream, firstLine: String) {
        val headers = mutableListOf<String>()
        while (true) {
            val line = readAsciiLine(input) ?: break
            if (line.isEmpty()) break
            headers.add(line)
        }
        // GET http://host:port/path HTTP/1.1 → GET /path HTTP/1.1
        val sp = firstLine.split(" ", limit = 3)
        if (sp.size < 3) { writeProxyError(client, "HTTP/1.1 400 Bad Request"); return }
        val uri = try { java.net.URI(sp[1]) } catch (_: Exception) { null }
        if (uri == null || uri.host.isNullOrBlank()) { writeProxyError(client, "HTTP/1.1 400 Bad Request"); return }
        val host = uri.host ?: return
        val portNo = if (uri.port > 0) uri.port else 80
        val pathAndQuery = buildString {
            append(uri.rawPath ?: "/")
            if (!uri.rawQuery.isNullOrBlank()) append("?").append(uri.rawQuery)
        }

        val upstream = openUpstream(host, portNo)
        if (upstream == null) { writeProxyError(client, "HTTP/1.1 502 Bad Gateway"); return }

        registerUpstream(upstream)
        try {
            val out = upstream.getOutputStream()
            out.write("${sp[0]} $pathAndQuery ${sp[2]}\r\n".toByteArray(Charsets.ISO_8859_1))
            var hadHost = false
            for (h in headers) {
                if (h.startsWith("Connection:", ignoreCase = true)) continue // خودمان close می‌گذاریم
                if (h.startsWith("Proxy-", ignoreCase = true)) continue     // هدرهای پراکسی مال خودمان است
                if (h.startsWith("Host:", ignoreCase = true)) hadHost = true
                out.write("$h\r\n".toByteArray(Charsets.ISO_8859_1))
            }
            if (!hadHost) out.write("Host: $host\r\n".toByteArray(Charsets.ISO_8859_1))
            out.write("Connection: close\r\n\r\n".toByteArray(Charsets.ISO_8859_1))
            out.flush()

            // بدنهٔ درخواست (اگر هست — Content-Length دار) تا سمت سرور برود
            val contentLength = headers.firstOrNull { it.startsWith("Content-Length:", ignoreCase = true) }
                ?.substringAfter(':')?.trim()?.toLongOrNull() ?: 0L
            if (contentLength > 0) {
                var remaining = contentLength
                val buf = ByteArray(PUMP_BUFFER_SIZE)
                while (remaining > 0) {
                    val n = input.read(buf, 0, minOf(buf.size.toLong(), remaining).toInt())
                    if (n < 0) break
                    out.write(buf, 0, n)
                    remaining -= n
                }
            }
            out.flush()
            // پاسخ کامل سرور تا EOF به کلاینت برمی‌گردد
            copyStream(upstream.getInputStream(), client.getOutputStream(), null)
        } catch (_: Throwable) {
            // بسته شدن سمت سرور/کلاینت — رفتار عادی Connection: close
        } finally {
            unregisterUpstream(upstream)
            closeQuietly(upstream)
            closeQuietly(client)
        }
    }

    /* ───────────── اتصال بالادستی + DNS تازه (قلب درمان) ───────────── */

    /**
     * باز کردن سوکت به host:port با resolve «تازه در هر اتصال»:
     *  ۱) مسیر netd مخصوص شبکهٔ مقصد (Network.getAllByName) — بدون کش JVM
     *  ۲) فال‌بک مسیر استاندارد (InetAddress)
     *  ۳) فیلتر Fake-IP (۱۹۸.۱۸.۰.۰/۱۵) — با VPN خاموش یعنی کش مسموم → رد
     */
    private fun openUpstream(host: String, portNo: Int): Socket? {
        val address = resolveFresh(host) ?: return null
        return try {
            val net = networkProvider?.invoke()
            val socket = if (net != null) {
                net.socketFactory.createSocket()
            } else {
                Socket()
            }
            socket.tcpNoDelay = true
            // بدون SO_TIMEOUT — SSE/WebSocket تونل‌های طولانی‌مدت‌اند
            socket.connect(InetSocketAddress(address, portNo), UPSTREAM_CONNECT_TIMEOUT_MS)
            socket
        } catch (e: Throwable) {
            Log.d(TAG, "lproxy: upstream $host:$portNo failed: ${e.javaClass.simpleName}")
            null
        }
    }

    private fun resolveFresh(host: String): InetAddress? {
        // خودِ IP literal؟ (بدون DNS)
        if (host.firstOrNull()?.isDigit() == true || host.contains(':')) {
            val literal = try { InetAddress.getByName(host) } catch (_: Throwable) { null }
            if (literal != null) {
                val vpnOn = try { vpnActiveProvider?.invoke() ?: false } catch (_: Throwable) { false }
                return if (isFakeIp(literal) && !vpnOn) null else literal
            }
        }
        val vpnOn = try { vpnActiveProvider?.invoke() ?: false } catch (_: Throwable) { false }

        // ۱) مسیر اختصاصی شبکهٔ مقصد (netd — بدون کش JVM)
        val net = try { networkProvider?.invoke() } catch (_: Throwable) { null }
        if (net != null) {
            try {
                pickAddress(net.getAllByName(host), vpnOn)?.let { return it }
            } catch (_: Throwable) {
                // ادامه با مسیر استاندارد
            }
        }
        // ۲) مسیر استاندارد (ممکن است کش JVM داشته باشد — فیلتر فیک حکم می‌کند)
        return try {
            pickAddress(InetAddress.getAllByName(host), vpnOn)
        } catch (_: Throwable) {
            null
        }
    }

    private fun pickAddress(addrs: Array<InetAddress>, vpnOn: Boolean): InetAddress? {
        val healthy = addrs.filter { !isFakeIp(it) }
        if (healthy.isNotEmpty()) {
            return healthy.firstOrNull { it.address.size == 4 } ?: healthy.first()
        }
        // همه فیک‌اند: فقط حین VPN معتبرند (از دل تونل کار می‌کنند)
        if (vpnOn) {
            return addrs.firstOrNull { it.address.size == 4 } ?: addrs.firstOrNull()
        }
        Log.w(TAG, "lproxy: DNS returned only Fake-IP(s) with VPN off — poisoned cache refused (fast 502)")
        return null
    }

    /** رنج استاندارد Fake-IP همهٔ هسته‌های رایج (Xray/sing-box/Clash): ۱۹۸.۱۸.۰.۰/۱۵ */
    private fun isFakeIp(a: InetAddress): Boolean {
        val b = a.address
        return b.size == 4 && b[0].toInt() == 198 && (b[1].toInt() == 18 || b[1].toInt() == 19)
    }

    /* ───────────── پمپ دوسویهٔ تونل ───────────── */

    /**
     * پمپ دوسویهٔ تونل.
     * نکتهٔ حیاتی: سمت کلاینت باید از همان BufferedInputStream هدرها خوانده شود —
     * اگر به استریم خام برگردیم، بایت‌های از-قبل-بافرشده گم می‌شوند.
     */
    private fun pumpBothWays(clientInput: InputStream, client: Socket, upstream: Socket) {
        val cToU = executor.submit {
            try {
                copyStream(clientInput, upstream.getOutputStream()) { closeQuietly(upstream) }
            } catch (_: Throwable) {
                closeQuietly(upstream)
            }
        }
        try {
            copyStream(upstream.getInputStream(), client.getOutputStream()) { closeQuietly(client) }
        } catch (_: Throwable) {
            closeQuietly(client)
        }
        // سمت upstream→client تمام شد؛ سمت دیگر هم باید تمام شود (کوتاه‌مدت)
        try { cToU.get() } catch (_: Throwable) {}
    }

    /** کپی خام بایت — محتوا هرگز خوانده/تغییر نمی‌کند (TLS سرتاسری می‌ماند) */
    private fun copyStream(src: InputStream, dst: OutputStream, onEnd: (() -> Unit)?) {
        val buf = ByteArray(PUMP_BUFFER_SIZE)
        try {
            while (true) {
                val n = try { src.read(buf) } catch (_: Throwable) { break }
                if (n < 0) break
                try {
                    dst.write(buf, 0, n)
                    dst.flush()
                } catch (_: Throwable) {
                    break
                }
            }
        } finally {
            try { onEnd?.invoke() } catch (_: Throwable) {}
        }
    }

    /* ───────────── رجیستری + ابزارهای کوچک ───────────── */

    private fun registerUpstream(s: Socket) {
        try { upstreamSockets.add(s) } catch (_: Throwable) {}
    }

    private fun unregisterUpstream(s: Socket) {
        try { upstreamSockets.remove(s) } catch (_: Throwable) {}
    }

    private fun writeProxyError(client: Socket, statusLine: String) {
        try {
            client.getOutputStream().apply {
                write("$statusLine\r\nConnection: close\r\n\r\n".toByteArray(Charsets.ISO_8859_1))
                flush()
            }
        } catch (_: Throwable) {
        } finally {
            closeQuietly(client)
        }
    }

    /** خواندن یک خط ASCII از استریم (HTTP header) */
    private fun readAsciiLine(input: InputStream): String? {
        val sb = StringBuilder(96)
        var prev = -1
        while (true) {
            val c = try { input.read() } catch (_: Throwable) { return null }
            if (c < 0) return if (sb.isEmpty()) null else sb.toString()
            if (c == '\n'.code) {
                if (prev == '\r'.code && sb.isNotEmpty()) sb.setLength(sb.length - 1)
                return sb.toString()
            }
            sb.append(c.toChar())
            if (sb.length > 16 * 1024) return null // هدر غیرعادی — رد
            prev = c
        }
    }

    /** مصرف هدرهای باقی‌مانده تا خط خالی (پایان هدر) */
    private fun drainHeaders(input: InputStream) {
        while (true) {
            val line = readAsciiLine(input) ?: return
            if (line.isEmpty()) return
        }
    }

    private fun closeQuietly(s: Socket?) {
        try { s?.close() } catch (_: Throwable) {}
    }
}
