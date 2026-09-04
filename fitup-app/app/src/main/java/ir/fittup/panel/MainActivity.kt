package ir.fittup.panel

import android.annotation.SuppressLint
import android.app.DownloadManager
import android.app.NotificationChannel
import android.app.NotificationManager
import android.content.ActivityNotFoundException
import android.content.BroadcastReceiver
import android.content.ContentValues
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.content.pm.PackageManager
import android.graphics.Color
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.os.Environment
import android.print.PrintManager
import android.provider.MediaStore
import android.util.Base64
import android.util.Log
import android.view.View
import android.webkit.CookieManager
import android.webkit.JavascriptInterface
import android.webkit.PermissionRequest
import android.webkit.ValueCallback
import android.webkit.WebChromeClient
import android.webkit.WebResourceError
import android.webkit.WebResourceRequest
import android.webkit.WebSettings
import android.webkit.WebView
import android.webkit.WebViewClient
import android.widget.Button
import android.widget.LinearLayout
import android.widget.Toast
import androidx.activity.result.ActivityResultLauncher
import androidx.activity.result.contract.ActivityResultContracts
import androidx.appcompat.app.AlertDialog
import androidx.appcompat.app.AppCompatActivity
import androidx.core.app.NotificationCompat
import androidx.core.content.ContextCompat
import androidx.core.content.FileProvider
import org.json.JSONObject
import java.io.File
import java.io.FileOutputStream
import java.net.HttpURLConnection
import java.net.URI
import java.net.URL
import kotlin.concurrent.thread

/**
 * FitUp — اپ اندروید «اختصاصی» فیتاپ (نسخه سایت — v1.2.2)
 *
 * پوسته اندرویدی (WebView) پنل کاربری فیتاپ — دقیقاً همان ساختار خود سایت:
 *  - شروع با صفحه OTP (?screen=auth) → آنبوردینگ → پنل ورزشکار
 *  - پرداخت از درگاه خود سایت (زرین‌پال/شاپرک) داخل WebView
 *  - آپدیت: سایت داخل WebView مودال زیبا نشان می‌دهد؛ دانلود با DownloadManager
 *    و نصب با Installer اندروید (FileProvider)
 *  - همیشه به‌روز: HTML همیشه تازه از سایت (asset های hash دار)
 *
 * v1.1.0 — مجوزها با مودال زیبای سایت (pre-permission rationale):
 *  سایت قبل از هر دیالوگ سیستمی، مودال انیمه‌دار خودش را نشان می‌دهد
 *  (permission-gate) و بعد پل نیتیو مجوز اندروید را «در لحظهٔ استفاده»
 *  می‌گیرد: نوتیف بعد از ورود، میکروفون/دوربین لحظهٔ ضبط، گالری اولین انتخاب.
 *
 * پل JS (window.FitUpNative) — متدهای سایت:
 *  - isOwnApp(): Boolean                → تشخیص محیط اپ اختصاصی
 *  - getAppVersionCode(): Int           → برای مقایسه با /api/app/own/latest
 *  - getAppVersionName(): String        → نمایش نسخه
 *  - downloadUpdate(url)                → دانلود APK جدید + دیالوگ نصب
 *  - showNotification(title, body)      → نوتیف سیستم اندروید
 *  - requestNotificationPermission()    → مجوز POST_NOTIFICATIONS
 *  - requestSmsAutoRead()               → اجازه خواندن پیامک OTP (فقط صفحه ورود)
 *  - downloadFile(filename, dataUrl)    → ذخیره PNG/PDF در Downloads
 *  - printPage()                        → چاپ صفحه (PrintManager)
 *  - setSwipeRefreshEnabled(b)          → قفل pull-to-refresh هنگام اسکرول داخلی
 */
class MainActivity : AppCompatActivity() {

    private lateinit var binding: ir.fittup.panel.databinding.ActivityMainBinding
    private lateinit var webView: WebView
    private lateinit var swipeRefresh: androidx.swiperefreshlayout.widget.SwipeRefreshLayout
    private lateinit var splash: LinearLayout
    private lateinit var errorView: LinearLayout
    private lateinit var errorRetry: Button

    /** URL اصلی (فریم اصلی) — برای چک origin پل JS */
    @Volatile private var lastMainUrl: String? = null

    /** وضعیت دانلود در جریان — در SharedPreferences است، نه متغیر حافظه:
     *  اگر اکتیویتی بازسازی شد یا اپ بسته/باز شد، پایان دانلود گم نمی‌شود
     *  (بخشی از ریشه‌یابی باگ «دانلود شروع می‌شود ولی هیچ اتفاقی نمی‌افتد») */
    private val downloadPrefs by lazy { getSharedPreferences("fitup_download", Context.MODE_PRIVATE) }

    /** جلوگیری از تکرار دیالوگ آپدیت اجباری */
    private var forceDialogShown = false

    // آپلود فایل (عکس/ویدیو در چت و آنالیزها)
    private var filePathCallback: ValueCallback<Array<Uri>>? = null
    private lateinit var fileChooserLauncher: ActivityResultLauncher<Intent>

    private lateinit var notifPermissionLauncher: ActivityResultLauncher<String>

    // ─── دوربین/میکروفون وب (getUserMedia): مجوز دقیقاً در زمان استفاده ───
    private var pendingWebPermissionRequest: PermissionRequest? = null
    private val mediaPermissionLauncher = registerForActivityResult(ActivityResultContracts.RequestMultiplePermissions()) { grants ->
        pendingWebPermissionRequest?.let { req ->
            pendingWebPermissionRequest = null
            val ok = grants.values.all { it }
            runOnUiThread { if (ok) req.grant(req.resources) else req.deny() }
        }
    }

    // ─── OTP خودکار (بدون هیچ پرمیشن پیامک) ───
    // ۱) کیبورد/سیستم: ورودی کد در سایت autocomplete="one-time-code" دارد →
    //    اندروید کد پیامک را بدون هیچ مجوزی پیشنهاد می‌دهد (اندروید ۹+)
    // ۲) کلیپ‌بورد: اگر کاربر کد را کپی کند، در onResume اتو-درج می‌شود
    // ⛔ خواندن مستقیم پیامک (RECEIVE_SMS) عمداً حذف شد — از اندروید ۱۳+ پرمیشن
    //    SMS برای اپ‌های خارج از پلی «محدود» است؛ دیالوگ ترسناک
    //    «App was denied access» می‌آمد و اجازه هم هیچ‌وقت داده نمی‌شد.
    private var lastClipboardDispatched: String? = null

    @SuppressLint("SetJavaScriptEnabled")
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        binding = ir.fittup.panel.databinding.ActivityMainBinding.inflate(layoutInflater)
        setContentView(binding.root)

        webView = binding.webView
        swipeRefresh = binding.swipeRefresh
        splash = binding.splash
        errorView = binding.errorView
        errorRetry = binding.errorRetry

        setupFileChooser()
        setupWebView()
        setupNotifications()
        setupDownloadCompleteReceiver()

        if (savedInstanceState != null) {
            webView.restoreState(savedInstanceState)
        } else {
            // شروع مستقیم با OTP — ?screen=auth: اگر سشن هست → پنل، وگرنه صفحه ورود
            webView.loadUrl(startUrl())
        }

        checkAppVersion()
    }

    /** شروع با ?screen=auth — کاربر لاگین‌شده مستقیم پنل را می‌بیند */
    private fun startUrl(): String {
        val base = BuildConfig.SITE_URL.trimEnd('/')
        return if (base.contains("?")) "$base&screen=auth" else "$base?screen=auth"
    }

    /* ───────────── WebView ───────────── */

    @SuppressLint("SetJavaScriptEnabled")
    private fun setupWebView() {
        val s: WebSettings = webView.settings
        s.javaScriptEnabled = true
        s.domStorageEnabled = true          // برای سشن لاگین OTP
        s.databaseEnabled = true
        s.loadWithOverviewMode = true
        s.useWideViewPort = true
        s.mediaPlaybackRequiresUserGesture = false   // ویدیوهای تمرین
        s.mixedContentMode = WebSettings.MIXED_CONTENT_NEVER_ALLOW
        s.allowFileAccess = false
        s.allowContentAccess = true          // برای انتخاب فایل (دوربین/گالری)
        s.userAgentString = (s.userAgentString ?: "") + " FitUpApp/" + BuildConfig.VERSION_NAME
        s.cacheMode = WebSettings.LOAD_DEFAULT
        // مقیاس متن ثابت — «تجربه اپ واقعی» (فونت سیستم layout سایت را نشکند)
        s.textZoom = 100

        // کوکی‌ها را از قبل به WebView وصل کن (سشن OTP بین restartها زنده می‌ماند)
        try {
            CookieManager.getInstance().setAcceptCookie(true)
        } catch (_: Exception) {}

        // پس‌زمینه سفید — بدون فلش تیره هنگام بارگذاری
        webView.setBackgroundColor(Color.WHITE)

        webView.addJavascriptInterface(NativeBridge(), "FitUpNative")

        webView.webViewClient = object : WebViewClient() {
            override fun onPageStarted(view: WebView, url: String, favicon: android.graphics.Bitmap?) {
                super.onPageStarted(view, url, favicon)
                lastMainUrl = url
                hideError()
            }

            override fun shouldOverrideUrlLoading(view: WebView, request: WebResourceRequest): Boolean {
                val url = request.url
                val scheme = url.scheme?.lowercase() ?: return false

                // اسکیم‌های غیر http — باید native هندل شوند (tel/mailto/intent…)
                if (scheme != "http" && scheme != "https") {
                    return handleExternalScheme(url)
                }

                // مسیریابی هوشمند:
                //  - سایت فیتاپ → داخل WebView
                //  - درگاه پرداخت/بانک‌ها (زرین‌پال/شاپرک/…) → داخل WebView (برای برگشت موفق به پنل)
                //  - شبکه‌های اجتماعی و سایت‌های دیگر → مرورگر بیرونی
                return routeUrl(url)
            }

            override fun onPageFinished(view: WebView, url: String) {
                splash.visibility = View.GONE
                swipeRefresh.isRefreshing = false
                injectBridgeHelper()
            }

            /** خطای بارگذاری فریم اصلی → صفحه خطای فارسی با دکمه تلاش مجدد */
            override fun onReceivedError(
                view: WebView,
                request: WebResourceRequest,
                error: WebResourceError
            ) {
                super.onReceivedError(view, request, error)
                if (request.isForMainFrame) showError()
            }

            /** کرش رندرر (targetSdk 34) → بازسازی اکتویتی به‌جای صفحه سیاه */
            override fun onRenderProcessGone(view: WebView, detail: android.webkit.RenderProcessGoneDetail): Boolean {
                Log.e("FitUpApp", "WebView renderer gone — recreating activity")
                recreate()
                return true
            }
        }

        webView.webChromeClient = object : WebChromeClient() {
            override fun onShowFileChooser(
                view: WebView,
                callback: ValueCallback<Array<Uri>>,
                params: FileChooserParams
            ): Boolean {
                filePathCallback?.onReceiveValue(null)
                filePathCallback = callback
                return try {
                    val intent = params.createIntent()
                    // انتخاب چندگانه عکس (چت/آنالیز بدن چند زاویه)
                    intent.putExtra(Intent.EXTRA_ALLOW_MULTIPLE, true)
                    fileChooserLauncher.launch(intent)
                    true
                } catch (e: ActivityNotFoundException) {
                    filePathCallback = null
                    false
                }
            }

            /**
             * ─── مجوز دوربین/میکروفون وب — دقیقاً در زمان استفاده ───
             * سایت برای ضبط صدا (ویس چت) یا ویدیو (آنالیز ویدیویی تمرین/بدن) از
             * getUserMedia استفاده می‌کند؛ این کال‌بک فقط در همان لحظه اجرا می‌شود.
             *
             * v1.1.0: توضیحِ «چرا» حالا مودال زیبای خود سایت است (permission-gate،
             * انیمه‌دار با برند فیتاپ) — اینجا فقط دیالوگ سیستمی اندروید در همان
             * لحظه درخواست می‌شود (دیالوگ تکراری نیتیو حذف شد تا دوبار پرسیده نشود).
             */
            override fun onPermissionRequest(request: PermissionRequest) {
                val resources = request.resources
                val needsVideo = resources.contains(PermissionRequest.RESOURCE_VIDEO_CAPTURE)
                val needsAudio = resources.contains(PermissionRequest.RESOURCE_AUDIO_CAPTURE)
                if (!needsVideo && !needsAudio) {
                    request.deny()
                    return
                }
                requestMediaRuntimePermissions(request)
            }
        }

        // ─── دانلودها (APK آپدیت/فایل‌ها) → DownloadManager نیتیو ───
        webView.setDownloadListener { url, _, contentDisposition, mimetype, _ ->
            try {
                val fileName = guessFileName(contentDisposition, mimetype, url)
                startNativeDownload(url, fileName, isApk = fileName.endsWith(".apk", true))
            } catch (_: Exception) {
                toast("دانلود ممکن نشد")
            }
        }

        swipeRefresh.setOnRefreshListener { webView.reload() }
        // رنگ برند فیتاپ
        swipeRefresh.setColorSchemeColors(Color.parseColor("#f97316"))

        // ─── FIX: اسکرول به بالا → رفرش نمی‌شود ───
        // refresh فقط وقتی مجاز است که WebView دقیقاً در بالای صفحه است (scrollY == 0).
        swipeRefresh.isEnabled = true
        webView.setOnScrollChangeListener { _, _, scrollY, _, _ ->
            swipeRefresh.isEnabled = scrollY == 0
        }
    }

    /**
     * مسیریابی URL:
     * true  → بیرون از WebView هندل شد (مرورگر/دیالر)
     * false → داخل WebView بارگذاری شود
     */
    private fun routeUrl(url: Uri): Boolean {
        val host = url.host?.lowercase() ?: return false
        val siteHost = try { URI(BuildConfig.SITE_URL).host?.lowercase() } catch (_: Exception) { null }

        // سایت خودمان — همیشه داخل WebView
        if (host == "fittup.ir" || host.endsWith(".fittup.ir")) return false
        if (siteHost != null && (host == siteHost || host.endsWith(".$siteHost"))) return false

        // درگاه پرداخت سایت (زرین‌پال) و بانک‌ها (شاپراک) — داخل WebView تا کاربر
        // بعد از پرداخت به پنل برگردد (payment_verify در همان WebView اجرا می‌شود)
        if (host == "zarinpal.com" || host.endsWith(".zarinpal.com")) return false
        if (host == "zarin.link" || host.endsWith(".zarin.link")) return false
        if (host == "shaparak.ir" || host.endsWith(".shaparak.ir")) return false

        // شبکه‌های اجتماعی/استورها/سایت‌های دیگر → مرورگر بیرونی
        openExternal(url)
        return true
    }

    /** اسکیم‌های غیر وب — tel/mailto/intent و غیره */
    private fun handleExternalScheme(uri: Uri): Boolean {
        try {
            when (uri.scheme?.lowercase()) {
                "tel" -> startActivity(Intent(Intent.ACTION_DIAL, uri))
                "mailto" -> startActivity(Intent(Intent.ACTION_SENDTO, uri))
                "sms" -> startActivity(Intent(Intent.ACTION_SENDTO, uri))
                "intent" -> {
                    val intent = Intent.parseUri(uri.toString(), Intent.URI_INTENT_SCHEME)
                    // سخت‌سازی امنیتی (ضد intent-redirection): فقط ACTION_VIEW عمومی —
                    // بدون component/package/selector تا به اپ دلخواه هدایت نشود
                    intent.component = null
                    intent.selector = null
                    intent.setPackage(null)
                    startActivity(intent)
                }
                else -> startActivity(Intent(Intent.ACTION_VIEW, uri))
            }
        } catch (_: Exception) {
            // اپی برای این لینک نیست — نادیده بگیر
        }
        return true
    }

    private fun openExternal(uri: Uri) {
        try {
            startActivity(Intent(Intent.ACTION_VIEW, uri))
        } catch (_: ActivityNotFoundException) {
            // مرورگری نیست — نادیده بگیر
        }
    }

    /* ───────────── صفحه خطا ───────────── */

    private fun showError() {
        runOnUiThread {
            splash.visibility = View.GONE
            errorView.visibility = View.VISIBLE
            swipeRefresh.isRefreshing = false
        }
    }

    private fun hideError() {
        runOnUiThread { errorView.visibility = View.GONE }
    }

    /* ───────────── helper سمت سایت ───────────── */

    /** helper سمت سایت — تشخیص تمیز محیط اپ اختصاصی */
    private fun injectBridgeHelper() {
        val js = """
            (function() {
              if (window.__fitupOwnAppInjected) return;
              window.__fitupOwnAppInjected = true;
              // آیا داخل اپ اختصاصی فیتاپ هستیم؟
              window.isFitUpOwnApp = function() {
                try { return !!(window.FitUpNative && window.FitUpNative.isOwnApp && window.FitUpNative.isOwnApp()); }
                catch (e) { return false; }
              };
              // کوکی pwa_standalone — سرور برای URL «/» مستقیم صفحهٔ auth را
              // رندر می‌کند (نه لندینگ) — همان رفتار وب‌اپ. اپ همیشه با
              // ?screen=auth شروع می‌شود؛ این کوکی فقط حالت رفرش/بعد از خروج
              // را هم درست نگه می‌دارد.
              try {
                if (document.cookie.indexOf('pwa_standalone=1') === -1) {
                  document.cookie = 'pwa_standalone=1; path=/; max-age=31536000; samesite=lax';
                }
              } catch (e) {}
            })();
        """.trimIndent()
        runOnUiThread {
            webView.evaluateJavascript(js, null)
        }
    }

    /* ───────────── آپلود فایل ───────────── */

    private fun setupFileChooser() {
        fileChooserLauncher = registerForActivityResult(ActivityResultContracts.StartActivityForResult()) { result ->
            val callback = filePathCallback ?: return@registerForActivityResult
            filePathCallback = null
            val uris: Array<Uri>? = if (result.resultCode == RESULT_OK) {
                val data = result.data
                val clip = data?.clipData
                if (clip != null) {
                    Array(clip.itemCount) { i -> clip.getItemAt(i).uri }
                } else {
                    data?.data?.let { arrayOf(it) }
                }
            } else null
            callback.onReceiveValue(uris ?: arrayOf())
        }
    }

    /* ───────────── دانلود / آپدیت APK ───────────── */

    /*
     * ریشه‌یابی کامل باگ «دانلود شروع شد ولی دانلود نمی‌شود» (v1.2.2):
     *
     *  ۱) باگ اصلی اندروید ۱۴+: گیرندهٔ ACTION_DOWNLOAD_COMPLETE با
     *     RECEIVER_NOT_EXPORTED ثبت می‌شد؛ برادکست از DownloadProvider می‌آید
     *     (نه هستهٔ سیستم) → اندروید ۱۴+ آن را به گیرندهٔ NOT_EXPORTED نمی‌رساند
     *     → دانلود شاید تمام می‌شد ولی دیالوگ نصب هیچ‌وقت باز نمی‌شد.
     *     فیکس: RECEIVER_EXPORTED (برادکست protected است و فقط دانلودمنیجر
     *     می‌تواند بفرستد — از نظر امنیتی کاملاً امن است).
     *  ۲) دانلود نامرئی: مقصد APK پوشهٔ خصوصی اپ است و بدون مجوز
     *     POST_NOTIFICATIONS هیچ نوتیف پیشرفت/پایانی دیده نمی‌شد → کاربر
     *     «هیچ چیزی» نمی‌دید. حالا: بعد از enqueue توست دقیق می‌آید و
     *     پایان دانلود با دیالوگ داخل اپ تضمین می‌شود (بدون وابستگی به نوتیف).
     *  ۳) گم‌شدن پایان دانلود با بازسازی اکتیویتی: شناسهٔ دانلود فقط در حافظه
     *     بود؛ حالا در SharedPreferences است + در هر onResume از خود
     *     DownloadManager پرس‌وجو می‌شود (safety-net).
     *  ۴) پیام گمراه‌کننده: توست «شروع شد» حتی وقتی enqueue شکست می‌خورد
     *     نشان داده می‌شد؛ حالا شکست → دیالوگ «تلاش دوباره / دانلود با مرورگر».
     */

    /** شناسهٔ دانلود در جریان (SharedPreferences) */
    private fun pendingDownloadId(): Long = downloadPrefs.getLong(PREF_DOWNLOAD_ID, -1L)

    private fun savePendingDownload(id: Long, fileName: String, url: String) {
        downloadPrefs.edit()
            .putLong(PREF_DOWNLOAD_ID, id)
            .putString(PREF_DOWNLOAD_FILE, fileName)
            .putString(PREF_DOWNLOAD_URL, url)
            .apply()
    }

    private fun clearPendingDownload() {
        downloadPrefs.edit()
            .remove(PREF_DOWNLOAD_ID)
            .remove(PREF_DOWNLOAD_FILE)
            .remove(PREF_DOWNLOAD_URL)
            .apply()
    }

    /** وضعیت + فایل نهایی یک دانلود — پرس‌وجو از خود DownloadManager (نه حافظه) */
    private fun queryDownload(id: Long): Pair<Int, File?> {
        return try {
            val dm = getSystemService(Context.DOWNLOAD_SERVICE) as DownloadManager
            dm.query(DownloadManager.Query().setFilterById(id)).use { c ->
                if (!c.moveToFirst()) return Pair(-1, null)
                val status = c.getInt(c.getColumnIndexOrThrow(DownloadManager.COLUMN_STATUS))
                if (status != DownloadManager.STATUS_SUCCESSFUL) return Pair(status, null)
                var file: File? = null
                val localUri = c.getString(c.getColumnIndexOrThrow(DownloadManager.COLUMN_LOCAL_URI))
                if (!localUri.isNullOrBlank() && localUri.startsWith("file:")) {
                    file = try { File(URI(localUri).path) } catch (_: Exception) { null }
                }
                if (file == null) {
                    // fallback: مسیر مورد انتظار در پوشه Download اپ
                    val name = downloadPrefs.getString(PREF_DOWNLOAD_FILE, null)
                    if (!name.isNullOrBlank()) {
                        file = getExternalFilesDir(Environment.DIRECTORY_DOWNLOADS)?.let { File(it, name) }
                    }
                }
                Pair(status, file)
            }
        } catch (_: Exception) {
            Pair(-1, null)
        }
    }

    /** دانلود APK آپدیت — از پل JS (مودال آپدیت سایت) یا دیالوگ نیتیو.
     *  توست «شروع شد» فقط وقتی نمایش داده می‌شود که enqueue واقعاً موفق بوده. */
    private fun downloadApkUpdate(apkUrl: String) {
        val started = startNativeDownload(
            apkUrl,
            "fitup-update-${System.currentTimeMillis()}.apk",
            isApk = true
        )
        if (started) {
            toast("دانلود نسخه جدید شروع شد — پس از اتمام، پنجرهٔ نصب باز می‌شود")
        } else {
            showDownloadFailedDialog(apkUrl)
        }
    }

    /** شروع دانلود با DownloadManager → پوشه Download اپ (بدون مجوز نوشتن).
     *  @return true = واقعاً enqueue شد؛ false = شکست (caller بازخورد درست بدهد) */
    private fun startNativeDownload(url: String, fileName: String, isApk: Boolean): Boolean {
        val safeName = fileName.replace(Regex("[^A-Za-z0-9._-]"), "_").ifBlank {
            "fitup-${System.currentTimeMillis()}" + if (isApk) ".apk" else ""
        }
        try {
            val request = DownloadManager.Request(Uri.parse(url))
                .setTitle(if (isApk) "نسخه جدید فیتاپ" else safeName)
                .setDescription(if (isApk) "دانلود مستقیم از فیتاپ" else "دانلود فایل")
                .setNotificationVisibility(DownloadManager.Request.VISIBILITY_VISIBLE_NOTIFY_COMPLETED)
                .setDestinationInExternalFilesDir(this, Environment.DIRECTORY_DOWNLOADS, safeName)
                .setAllowedOverMetered(true)
                .setAllowedOverRoaming(true)
            val dm = getSystemService(Context.DOWNLOAD_SERVICE) as DownloadManager
            val id = dm.enqueue(request)
            savePendingDownload(id, safeName, url)
            if (isApk) {
                // چک زودهنگام: خطاهای آنی (آفلاین، ۴xx/۵xx، گواهی) در چند ثانیهٔ
                // اول STATUS_FAILED می‌شوند → فوراً دیالوگ جایگزین می‌آید تا
                // کاربر بی‌صدا منتظر نماند.
                webView.postDelayed({ checkEarlyFailure(id) }, 7_000)
            }
            return true
        } catch (e: Exception) {
            Log.e("FitUpApp", "download enqueue failed: ${e.message}")
            return false
        }
    }

    /** اگر دانلود APK در ثانیه‌های اول شکست خورد → دیالوگ تلاش مجدد/مرورگر */
    private fun checkEarlyFailure(id: Long) {
        if (id <= 0 || id != pendingDownloadId()) return // دانلود جدیدی شروع شده
        val (status, _) = queryDownload(id)
        if (status == DownloadManager.STATUS_FAILED) {
            val url = downloadPrefs.getString(PREF_DOWNLOAD_URL, null) ?: return
            clearPendingDownload()
            showDownloadFailedDialog(url)
        }
    }

    /** جلوی دوبار دیالوگ پشت‌سرهم (برادکست + onResume هم‌زمان) */
    private var handlingDownloadFinish = false

    /** پایان یک دانلود: بررسی واقعی از DownloadManager + دیالوگ نصب/خطا.
     *  هم از گیرندهٔ برادکست صدا زده می‌شود هم از onResume (safety-net). */
    private fun handleDownloadFinished(id: Long) {
        if (id <= 0 || id != pendingDownloadId()) return
        if (handlingDownloadFinish) return
        val fileName = downloadPrefs.getString(PREF_DOWNLOAD_FILE, null)
        if (fileName?.endsWith(".apk", true) != true) {
            // فایل معمولی (نه APK) — دانلودمنیجر خودش نوتیف دارد؛ فقط پاک کن
            clearPendingDownload()
            return
        }
        handlingDownloadFinish = true
        try {
            val (status, file) = queryDownload(id)
            if (status == DownloadManager.STATUS_SUCCESSFUL &&
                file != null && file.exists() && file.length() > 10_000
            ) {
                clearPendingDownload()
                showInstallDialog(file)
            } else if (status == DownloadManager.STATUS_FAILED) {
                val url = downloadPrefs.getString(PREF_DOWNLOAD_URL, null)
                clearPendingDownload()
                if (!url.isNullOrBlank()) showDownloadFailedDialog(url)
            }
            // STATUS_RUNNING/PENDING → هنوز در جریان است؛ صبر تا برادکست/resume بعدی
        } catch (_: Exception) {
        } finally {
            handlingDownloadFinish = false
        }
    }

    /** safety-net هر onResume: اگر برادکست پایان-دانلود را از دست داده‌ایم
     *  (کوارک اندروید ۱۴ / بازسازی اکتیویتی / بستن اپ)، با برگشتن به اپ
     *  دیالوگ نصب یا خطا نشان داده می‌شود. */
    private fun checkPendingDownload() {
        val id = pendingDownloadId()
        if (id > 0) handleDownloadFinished(id)
    }

    /** دیالوگ شکست دانلود — همیشه یک راه برای رسیدن به APK */
    private fun showDownloadFailedDialog(apkUrl: String) {
        runOnUiThread {
            AlertDialog.Builder(this)
                .setTitle("دانلود ناموفق بود")
                .setMessage(
                    "دانلود نسخه جدید به مشکل خورد (قطعی اینترنت یا خطای سرور).\n" +
                        "دوباره تلاش کنیم یا دانلود با مرورگر انجام شود؟"
                )
                .setPositiveButton("تلاش دوباره") { _, _ -> downloadApkUpdate(apkUrl) }
                .setNeutralButton("دانلود با مرورگر") { _, _ ->
                    try {
                        startActivity(Intent(Intent.ACTION_VIEW, Uri.parse(apkUrl)))
                    } catch (_: Exception) {
                    }
                }
                .setNegativeButton("لغو", null)
                .show()
        }
    }

    /** گیرندهٔ پایان دانلود → اگر APK بود، دیالوگ نصب.
     *  ⚠ RECEIVER_EXPORTED (نه NOT_EXPORTED): برادکست ACTION_DOWNLOAD_COMPLETE
     *  «protected» است و فقط دانلودمنیجر/سیستم می‌تواند بفرستد؛ در اندروید ۱۴+
     *  گیرندهٔ NOT_EXPORTED این برادکست را نمی‌گیرد (فرستنده DownloadProvider است)
     *  → ریشهٔ اصلی باگ «دیالوگ نصب هیچ‌وقت نیامد». */
    private fun setupDownloadCompleteReceiver() {
        val receiver = object : BroadcastReceiver() {
            override fun onReceive(context: Context?, intent: Intent?) {
                if (intent?.action != DownloadManager.ACTION_DOWNLOAD_COMPLETE) return
                val id = intent.getLongExtra(DownloadManager.EXTRA_DOWNLOAD_ID, -1L)
                handleDownloadFinished(id)
            }
        }
        try {
            if (Build.VERSION.SDK_INT >= 33) {
                registerReceiver(
                    receiver,
                    IntentFilter(DownloadManager.ACTION_DOWNLOAD_COMPLETE),
                    Context.RECEIVER_EXPORTED
                )
            } else {
                registerReceiver(receiver, IntentFilter(DownloadManager.ACTION_DOWNLOAD_COMPLETE))
            }
        } catch (_: Exception) {}
    }

    /** دیالوگ «نسخه جدید دانلود شد — نصب؟» */
    private fun showInstallDialog(file: File) {
        runOnUiThread {
            AlertDialog.Builder(this)
                .setTitle("نسخه جدید آماده است")
                .setMessage("فایل نسخه جدید فیتاپ دانلود شد. الان نصبش کنیم؟")
                .setPositiveButton("نصب") { _, _ -> installApk(file) }
                .setNegativeButton("بعداً", null)
                .show()
        }
    }

    /** نصب APK با FileProvider → Installer اندروید */
    private fun installApk(file: File) {
        try {
            // اندروید ۸+: اگر «نصب از منبع ناشناس» برای فیتاپ فعال نیست → تنظیمات
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O &&
                !packageManager.canRequestPackageInstalls()
            ) {
                AlertDialog.Builder(this)
                    .setTitle("اجازه نصب")
                    .setMessage("برای نصب نسخه جدید، یک‌بار اجازه «نصب برنامه‌های ناشناس» را به فیتاپ بده. (فقط برای آپدیت خود فیتاپ)")
                    .setPositiveButton("برو به تنظیمات") { _, _ ->
                        try {
                            startActivity(
                                Intent(
                                    android.provider.Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES,
                                    Uri.parse("package:$packageName")
                                )
                            )
                        } catch (_: Exception) {}
                    }
                    .setNegativeButton("انصراف", null)
                    .show()
                return
            }
            val uri = FileProvider.getUriForFile(this, "$packageName.fileprovider", file)
            val intent = Intent(Intent.ACTION_VIEW).apply {
                setDataAndType(uri, "application/vnd.android.package-archive")
                addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
            }
            startActivity(intent)
        } catch (e: Exception) {
            Log.e("FitUpApp", "install failed: ${e.message}")
            toast("نصب ممکن نشد — فایل در پوشه Download فیتاپ موجود است")
        }
    }

    /** نام فایل از Content-Disposition یا URL */
    private fun guessFileName(contentDisposition: String?, mimeType: String?, url: String): String {
        try {
            if (!contentDisposition.isNullOrBlank()) {
                val m = Regex("filename\\*=UTF-8''([^;]+)|filename=\"?([^\";]+)\"?", RegexOption.IGNORE_CASE)
                    .find(contentDisposition)
                if (m != null) {
                    val name = (m.groupValues[1].ifBlank { m.groupValues[2] })
                        .replace("+", " ")
                    if (name.isNotBlank()) return java.net.URLDecoder.decode(name, "UTF-8")
                }
            }
            if (!mimeType.isNullOrBlank() && mimeType.equals("application/vnd.android.package-archive", true)) {
                return "fitup-${System.currentTimeMillis()}.apk"
            }
            val path = URI(url).path ?: return "fitup-file"
            return path.substringAfterLast('/').ifBlank { "fitup-file" }
        } catch (_: Exception) {
            return "fitup-file"
        }
    }

    /* ───────────── ذخیره data URL (PNG/PDF) ───────────── */

    @SuppressLint("InlinedApi")
    private fun downloadDataUrl(filename: String, dataUrl: String) {
        try {
            val safeName = filename.ifBlank { "fitup-${System.currentTimeMillis()}" }
                .replace(Regex("[^A-Za-z0-9._-\\u0600-\\u06FF ]"), "_")
            val comma = dataUrl.indexOf(',')
            if (comma < 0 || !dataUrl.startsWith("data:", ignoreCase = true)) {
                runOnUiThread { toast("فایل قابل ذخیره نیست") }
                return
            }
            val meta = dataUrl.substring(5, comma)
            val mime = meta.substringBefore(";").ifBlank { "application/octet-stream" }
            val isBase64 = meta.contains("base64", ignoreCase = true)
            val bytes = if (isBase64) {
                Base64.decode(dataUrl.substring(comma + 1), Base64.DEFAULT)
            } else {
                dataUrl.substring(comma + 1).toByteArray(Charsets.UTF_8)
            }

            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                val values = ContentValues().apply {
                    put(MediaStore.Downloads.DISPLAY_NAME, safeName)
                    put(MediaStore.Downloads.MIME_TYPE, mime)
                    put(MediaStore.Downloads.IS_PENDING, 1)
                }
                val uri = contentResolver.insert(MediaStore.Downloads.EXTERNAL_CONTENT_URI, values)
                if (uri == null) {
                    runOnUiThread { toast("خطا در ذخیره فایل") }
                    return
                }
                contentResolver.openOutputStream(uri)?.use { it.write(bytes) }
                values.clear()
                values.put(MediaStore.Downloads.IS_PENDING, 0)
                contentResolver.update(uri, values, null, null)
            } else {
                val dir = getExternalFilesDir(Environment.DIRECTORY_DOCUMENTS) ?: filesDir
                val file = File(dir, safeName)
                FileOutputStream(file).use { it.write(bytes) }
            }
            runOnUiThread { toast("«$safeName» ذخیره شد ✓") }
        } catch (e: Exception) {
            Log.e("FitUpApp", "download failed: ${e.message}")
            runOnUiThread { toast("خطا در ذخیره فایل") }
        }
    }

    /** چاپ صفحه فعلی WebView با PrintManager اندروید */
    private fun printCurrentPage() {
        runOnUiThread {
            try {
                val printManager = getSystemService(Context.PRINT_SERVICE) as PrintManager
                val jobName = "FitUp ${BuildConfig.VERSION_NAME}"
                printManager.print(jobName, webView.createPrintDocumentAdapter(jobName), null)
            } catch (e: Exception) {
                toast("چاپ در این دستگاه ممکن نیست")
            }
        }
    }

    /* ───────────── نوتیفیکیشن native ───────────── */

    private fun setupNotifications() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            val channel = NotificationChannel(
                CHANNEL_ID,
                "اعلان‌های فیتاپ",
                NotificationManager.IMPORTANCE_DEFAULT
            ).apply { description = "یادآوری‌ها و خبرهای برنامه" }
            val nm = getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
            nm.createNotificationChannel(channel)
        }
        // مجوز POST_NOTIFICATIONS فقط از پل JS (requestNotificationPermission) —
        // وقتی کاربر در خود سایت روی «فعال‌سازی اعلان‌ها» کلیک می‌کند.
        notifPermissionLauncher = registerForActivityResult(ActivityResultContracts.RequestPermission()) { }
    }

    /** مجوز اعلان — از پل JS با توضیح زیبا در سایت، بعد از رضایت کاربر */
    private fun maybeRequestNotificationPermission() {
        try {
            if (Build.VERSION.SDK_INT >= 33 &&
                ContextCompat.checkSelfPermission(this, android.Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED
            ) {
                notifPermissionLauncher.launch(android.Manifest.permission.POST_NOTIFICATIONS)
            }
        } catch (_: Exception) {}
    }

    /** نمایش نوتیف سیستم — از پل JS (main-app polling) صدا زده می‌شود */
    private fun showNativeNotification(title: String, body: String) {
        try {
            if (Build.VERSION.SDK_INT >= 33 &&
                ContextCompat.checkSelfPermission(this, android.Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED
            ) {
                return // بدون مجوز، بی‌صدا رد شو
            }
            val notification = NotificationCompat.Builder(this, CHANNEL_ID)
                .setSmallIcon(R.mipmap.ic_launcher)
                .setContentTitle(title)
                .setContentText(body)
                .setStyle(NotificationCompat.BigTextStyle().bigText(body))
                .setAutoCancel(true)
                .setContentIntent(
                    android.app.PendingIntent.getActivity(
                        this, 0,
                        Intent(this, MainActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP),
                        android.app.PendingIntent.FLAG_UPDATE_CURRENT or android.app.PendingIntent.FLAG_IMMUTABLE
                    )
                )
                .build()
            val nm = getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
            nm.notify((System.currentTimeMillis() % 100000).toInt(), notification)
        } catch (e: Exception) {
            Log.w("FitUpApp", "notification failed: ${e.message}")
        }
    }

    /* ───────────── دوربین/میکروفون WebView ───────────── */

    private fun requestMediaRuntimePermissions(webRequest: PermissionRequest) {
        pendingWebPermissionRequest?.let { if (it !== webRequest) it.deny() }
        pendingWebPermissionRequest = webRequest
        val perms = mutableListOf<String>()
        if (webRequest.resources.contains(PermissionRequest.RESOURCE_VIDEO_CAPTURE)) {
            perms.add(android.Manifest.permission.CAMERA)
        }
        if (webRequest.resources.contains(PermissionRequest.RESOURCE_AUDIO_CAPTURE)) {
            perms.add(android.Manifest.permission.RECORD_AUDIO)
        }
        val alreadyGranted = perms.all {
            ContextCompat.checkSelfPermission(this, it) == PackageManager.PERMISSION_GRANTED
        }
        if (perms.isEmpty() || alreadyGranted) {
            pendingWebPermissionRequest = null
            runOnUiThread { webRequest.grant(webRequest.resources) }
        } else {
            try {
                mediaPermissionLauncher.launch(perms.toTypedArray())
            } catch (_: Exception) {
                pendingWebPermissionRequest = null
                runOnUiThread { webRequest.deny() }
            }
        }
    }

    /* ───────────── OTP خودکار: کلیپ‌بورد (بدون پرمیشن) ───────────── */

    private fun dispatchOtpCode(code: String) {
        runOnUiThread {
            webView.evaluateJavascript(
                "window.__fitupNativeSmsCode && window.__fitupNativeSmsCode('$code');",
                null
            )
        }
    }

    private fun maybeDispatchClipboardOtp() {
        try {
            val cm = getSystemService(Context.CLIPBOARD_SERVICE) as? android.content.ClipboardManager ?: return
            val text = cm.primaryClip?.getItemAt(0)?.coerceToText(this)?.toString()?.trim() ?: return
            if (text == lastClipboardDispatched) return
            if (Regex("^\\d{4,6}$").matches(text)) {
                lastClipboardDispatched = text
                dispatchOtpCode(text.take(4))
            }
        } catch (_: Exception) {}
    }

    /* ───────────── چک نسخه (fallback نیتیو) ───────────── */

    /**
     * در هر اجرا /api/app/own/latest را می‌خواند.
     * مودال زیبای آپدیت را خود سایت (AppUpdateModal) نشان می‌دهد؛ این چک نیتیو
     * فقط safety-net است: اگر صفحه سایت بالا نیامده باشد (خطای شبکه) و نسخهٔ
     * جدید «اجباری» بود، دیالوگ نیتیو با دانلود مستقیم نشان می‌دهیم.
     */
    private fun checkAppVersion() {
        thread {
            try {
                val url = URL(BuildConfig.SITE_URL.trimEnd('/') + "/api/app/own/latest")
                val conn = url.openConnection() as HttpURLConnection
                conn.connectTimeout = 10_000
                conn.readTimeout = 10_000
                conn.instanceFollowRedirects = true
                val body = conn.inputStream.bufferedReader().use { it.readText() }
                conn.disconnect()
                val json = JSONObject(body)
                if (!json.optBoolean("available", false)) return@thread
                val latest = json.optInt("latestVersionCode", 1)
                val forced = json.optBoolean("forceUpdate", false)
                val apkUrl = BuildConfig.SITE_URL.trimEnd('/') + "/api/app/own/download"
                if (BuildConfig.VERSION_CODE < latest && forced) {
                    runOnUiThread {
                        // فقط وقتی سایت بالا نیامده (وگرنه مودال سایت خودش را نشان می‌دهد)
                        if (errorView.visibility == View.VISIBLE && !forceDialogShown) {
                            forceDialogShown = true
                            showForceUpdateDialog(apkUrl)
                        }
                    }
                }
            } catch (e: Exception) {
                // آفلاین/خطا — نادیده بگیر؛ در اجرای بعدی دوباره تلاش می‌شود
            }
        }
    }

    /** دیالوگ آپدیت اجباری — دانلود مستقیم + نصب */
    private fun showForceUpdateDialog(apkUrl: String) {
        val dialog = AlertDialog.Builder(this)
            .setTitle("به‌روزرسانی لازم است")
            .setMessage("برای ادامه استفاده از فیتاپ، لطفاً نسخه جدید برنامه را دانلود و نصب کنید.")
            .setCancelable(false)
            .setPositiveButton("دانلود نسخه جدید") { _, _ -> downloadApkUpdate(apkUrl) }
            .setNeutralButton("تلاش مجدد") { _, _ ->
                forceDialogShown = false
                webView.reload()
                checkAppVersion()
            }
            .create()
        dialog.setCanceledOnTouchOutside(false)
        dialog.show()
    }

    private fun toast(msg: String) {
        runOnUiThread { Toast.makeText(this, msg, Toast.LENGTH_SHORT).show() }
    }

    /* ───────────── پل JS ───────────── */

    /** چک origin — پل فقط از دامنه خودمان قابل فراخوانی است (امنیت) */
    private fun bridgeAllowed(): Boolean {
        val u = lastMainUrl ?: return false
        return try {
            val host = URI(u).host ?: return false
            host == "fittup.ir" || host.endsWith(".fittup.ir") ||
                host == (try { URI(BuildConfig.SITE_URL).host } catch (_: Exception) { null } ?: host)
        } catch (_: Exception) {
            false
        }
    }

    inner class NativeBridge {
        /** اپ اختصاصی فیتاپ — نه بازار */
        @JavascriptInterface
        fun isOwnApp(): Boolean = bridgeAllowed()

        @JavascriptInterface
        fun isBazaarApp(): Boolean = false

        @JavascriptInterface
        fun appVersion(): String = BuildConfig.VERSION_NAME

        @JavascriptInterface
        fun getAppVersionCode(): Int = BuildConfig.VERSION_CODE

        @JavascriptInterface
        fun getAppVersionName(): String = BuildConfig.VERSION_NAME

        /** دانلود نسخه جدید (از مودال آپدیت سایت) → DownloadManager + نصب */
        @JavascriptInterface
        fun downloadUpdate(apkUrl: String) {
            if (!bridgeAllowed()) return
            runOnUiThread { downloadApkUpdate(apkUrl) }
        }

        @JavascriptInterface
        fun downloadFile(filename: String, dataUrl: String) {
            if (!bridgeAllowed()) return
            downloadDataUrl(filename, dataUrl)
        }

        @JavascriptInterface
        fun printPage() {
            if (!bridgeAllowed()) return
            printCurrentPage()
        }

        @JavascriptInterface
        fun showNotification(title: String, body: String) {
            if (!bridgeAllowed()) return
            showNativeNotification(title, body)
        }

        @JavascriptInterface
        fun requestNotificationPermission() {
            if (!bridgeAllowed()) return
            runOnUiThread { maybeRequestNotificationPermission() }
        }

        /** قفل pull-to-refresh برای اسکرول داخلی صفحه (فیکس باگ لیست‌ها) */
        @JavascriptInterface
        fun setSwipeRefreshEnabled(enabled: Boolean) {
            if (!bridgeAllowed()) return
            runOnUiThread { swipeRefresh.isEnabled = enabled }
        }
    }

    /* ───────────── چرخه حیات ───────────── */

    /* ───────────── ناوبری دکمه back (درخواست مالک) ───────────── */
    // بک اول از هر قسمتی به جز داشبورد → داشبورد (از طریق پل SPA — بدون رفرش صفحه)
    // بک روی داشبورد → مودال تأیید خروج؛ تأیید → خروج واقعی از برنامه
    // پل وب: window.__fitupNativeBack() در page-client.tsx تعریف شده و برمی‌گرداند:
    //   'overlay'   → فقط اورلی بسته شد (هیچ کاری نکن)
    //   'dashboard' → وب خودش به داشبورد پرید (هیچ کاری نکن)
    //   'home'      → روی داشبورد هستیم → مودال خروج
    //   'unknown'   → پل وب در دسترس نیست (صفحه هنوز لود نشده) → مودال خروج
    @Deprecated("Deprecated in Java")
    override fun onBackPressed() {
        webView.evaluateJavascript(
            "(function(){try{if(window.__fitupNativeBack){return window.__fitupNativeBack();}}catch(e){}return 'unknown';})()"
        ) { result ->
            val where = result?.trim()?.removePrefix("\"")?.removeSuffix("\"") ?: "unknown"
            if (where == "home" || where == "unknown") {
                showExitConfirmDialog()
            }
        }
    }

    /** مودال تأیید خروج از برنامه (بک دوم روی داشبورد) */
    private var exitConfirmDialog: AlertDialog? = null

    private fun showExitConfirmDialog() {
        if (exitConfirmDialog?.isShowing == true) return
        exitConfirmDialog = AlertDialog.Builder(this)
            .setTitle("خروج از فیتاپ")
            .setMessage("آیا مطمئنید که می‌خواهید از برنامه خارج شوید؟")
            .setPositiveButton("خروج") { _, _ -> finishAffinity() }
            .setNegativeButton("ماندن در برنامه", null)
            .show()
    }

    override fun onResume() {
        super.onResume()
        // چک نسخه در هر بازگشت (اگر نسخه اجباری جدید منتشر شده باشد)
        checkAppVersion()
        // پایان دانلود APK — اگر برادکست پایان-دانلود را از دست داده‌ایم
        // (کوارک اندروید ۱۴ / بازسازی اکتیویتی / بستن و بازکردن اپ)،
        // با برگشتن به اپ دیالوگ نصب/خطا نشان داده می‌شود
        checkPendingDownload()
        // OTP: شاید کد از کلیپ‌بورد آمده (کپی از نوتیف پیامک) — بدون پرمیشن
        maybeDispatchClipboardOtp()
    }

    override fun onPause() {
        // سشن OTP/لاگین — کوکی‌ها را فوراً روی دیسک flush کن
        try {
            CookieManager.getInstance().flush()
        } catch (_: Exception) {}
        super.onPause()
    }

    override fun onSaveInstanceState(outState: Bundle) {
        super.onSaveInstanceState(outState)
        webView.saveState(outState)
    }

    companion object {
        private const val CHANNEL_ID = "fitup_general"

        /** کلیدهای وضعیت دانلود APK (SharedPreferences "fitup_download") */
        private const val PREF_DOWNLOAD_ID = "download_id"
        private const val PREF_DOWNLOAD_FILE = "download_file"
        private const val PREF_DOWNLOAD_URL = "download_url"
    }
}
