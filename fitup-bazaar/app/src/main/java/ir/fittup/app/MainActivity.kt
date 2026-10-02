package ir.fittup.app

import android.annotation.SuppressLint
import android.app.Dialog
import android.content.ActivityNotFoundException
import android.app.NotificationChannel
import android.app.NotificationManager
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
import android.provider.Settings
import android.util.Base64
import android.util.Log
import android.view.View
import android.view.ViewGroup
import android.webkit.CookieManager
import android.webkit.JavascriptInterface
import android.webkit.PermissionRequest
import android.webkit.ValueCallback
import android.webkit.WebChromeClient
import android.webkit.WebResourceError
import android.webkit.WebResourceRequest
import android.webkit.WebResourceResponse
import android.webkit.WebSettings
import android.webkit.WebView
import android.webkit.WebViewClient
import android.widget.Button
import android.widget.LinearLayout
import android.widget.TextView
import android.widget.Toast
import androidx.activity.result.ActivityResultLauncher
import androidx.activity.result.contract.ActivityResultContracts
import androidx.appcompat.app.AlertDialog
import androidx.appcompat.app.AppCompatActivity
import androidx.core.app.NotificationCompat
import androidx.core.content.ContextCompat
import com.google.android.gms.auth.api.phone.SmsRetriever
import ir.cafebazaar.poolakey.Connection
import ir.cafebazaar.poolakey.Payment
import ir.cafebazaar.poolakey.config.PaymentConfiguration
import ir.cafebazaar.poolakey.config.SecurityCheck
import ir.cafebazaar.poolakey.request.PurchaseRequest
import org.json.JSONArray
import org.json.JSONObject
import java.io.File
import java.io.FileOutputStream
import java.net.URI

/**
 * FitUp — اپ کافه‌بازار (v1.5.3)
 *
 * پوسته اندرویدی (WebView) پنل کاربری فیتاپ + پرداخت درون‌برنامه‌ای بازار (پولکی).
 *
 * ⛔ قانون مهم (فیکس ریجکشن بازار v1.5.3): این اپ هیچ UI به‌روزرسانی ندارد —
 * نه چک نسخه، نه دیالوگ/توست/پیام آپدیت. به‌روزرسانی فقط از طریق خود بازار انجام می‌شود.
 *
 * ⚠️ طبق قوانین انتشار بازار: فقط پنل کاربری (بدون پنل مدیریت) و پرداخت اشتراک
 * دیجیتال فقط از IAB بازار.
 *
 * پل JS (window.FitUpNative) — متدهای سایت:
 *  - isBazaarApp(): Boolean                    → تشخیص محیط بازار
 *  - appVersion(): String                      → نسخه اپ
 *  - purchaseSubscription(sku, payload, cbId, dynamicPriceToken) → خرید محصول/اشتراک بازار
 *  - consumePurchase(purchaseToken)            → مصرف خرید (برای خرید مجدد/تمدید)
 *  - isPaymentAvailable(): Boolean             → اتصال پرداخت برقرار است؟
 *  - downloadFile(filename, dataUrl)           → ذخیره خروجی PNG/PDF در Downloads
 *  - printPage()                               → چاپ صفحه (PrintManager)
 *  - showNotification(title, body)             → نوتیف سیستم اندروید
 *  - requestNotificationPermission()           → مجوز POST_NOTIFICATIONS
 *
 * سایت (page-client) هم window.__fitupBazaarRestore(purchases) را فراهم می‌کند که
 * خریدهای consume-نشده بعد از اتصال پولکی به آن فرستاده می‌شوند (بازیابی خرید).
 */
class MainActivity : AppCompatActivity() {

    private lateinit var binding: ir.fittup.app.databinding.ActivityMainBinding
    private lateinit var webView: WebView
    private lateinit var swipeRefresh: androidx.swiperefreshlayout.widget.SwipeRefreshLayout
    private lateinit var splash: LinearLayout
    private lateinit var errorView: LinearLayout

    // ─── 🩹 v1.9 — نگهبان صفحهٔ سفید (فیکس P0 «صفحه سفید ابدی») ───
    // گزارش مالک + کاربران: بعد از آپدیت سایت، اپ صفحهٔ سفید می‌شد و حتی با
    // بستن/بازکردن هم بالا نمی‌آمد. ریشه: HTMLِ کش‌شدهٔ WebView به چانک‌های JS
    // حذف‌شدهٔ بیلد قبلی اشاره می‌کرد → هیچ JSی اجرا نمی‌شد → سفید همیشه‌گی.
    // (سمت سایت حالا HTML همیشه no-store است؛ این نگهبان لایهٔ نهایی recovery است)
    private var blankCheckPending = false
    private var blankPageReloadUsed = false
    private lateinit var errorRetry: Button

    private var payment: Payment? = null
    private var connection: Connection? = null
    @Volatile private var paymentReady = false
    /** کلید RSA معتبر است؟ اگر نه، خریدها fail-closed خطا می‌دهند (امنیت) */
    private var rsaKeyValid = false

    // آپلود فایل (عکس/ویدیو در چت و آنالیزها) — بدون این، input file در WebView کار نمی‌کند
    private var filePathCallback: ValueCallback<Array<Uri>>? = null
    private lateinit var fileChooserLauncher: ActivityResultLauncher<Intent>

    // ─── v120 — دوربین برای آپلود عکس/ویدیو (رفع تذکر کافه‌بازار) ───
    // تذکر بازار (versionCode 15): «امکان استفاده از دوربین وجود ندارد و صرفاً
    // می‌توان از تصاویر حافظهٔ گوشی استفاده کرد». سایت حالا
    // input[type=file][capture] می‌سازد (شیت «دوربین / گالری» در همهٔ نقاط
    // آپلود)؛ اینجا isCaptureEnabled=true → دوربین واقعی باز می‌شود → مجوز
    // CAMERA در مانیفست واقعاً استفاده می‌شود و تذکر برطرف است.
    private var pendingCameraUri: Uri? = null
    private var pendingCameraAfterPermission: WebChromeClient.FileChooserParams? = null
    private lateinit var cameraCaptureLauncher: ActivityResultLauncher<Intent>
    private val cameraPermissionLauncher = registerForActivityResult(ActivityResultContracts.RequestPermission()) { granted ->
        val params = pendingCameraAfterPermission
        pendingCameraAfterPermission = null
        if (granted && params != null) {
            launchCameraCaptureIntent(params)
        } else {
            // کاربر مجوز دوربین را نداد → fallback به انتخابگر گالری تا UX مرده نباشد
            fallbackToGallery(params)
        }
    }

    /** callback فعال پرداخت — پرداخت‌ها یکی‌یکی (single flight) */
    private var activePaymentCallbackId: String? = null

    /** URL اصلی (فریم اصلی) — برای چک origin پل JS */
    @Volatile private var lastMainUrl: String? = null

    private lateinit var notifPermissionLauncher: ActivityResultLauncher<String>

    // ─── دوربین/میکروفون وب (getUserMedia): مجوز دقیقاً در زمان استفاده ───
    /** درخواست معلقِ WebChromeClient.onPermissionRequest — با نتیجه دیالوگ/مجوز resolve می‌شود */
    private var pendingWebPermissionRequest: PermissionRequest? = null
    private val mediaPermissionLauncher = registerForActivityResult(ActivityResultContracts.RequestMultiplePermissions()) { grants ->
        pendingWebPermissionRequest?.let { req ->
            pendingWebPermissionRequest = null
            val ok = grants.values.all { it }
            runOnUiThread { if (ok) req.grant(req.resources) else req.deny() }
        }
    }

    // ─── v1.6.1 — موقعیت مکانی (GPS) برای «مسیریاب فیتاپ» (پیاده‌روی/دویدن) ───
    // صفحهٔ /activity از navigator.geolocation.watchPosition استفاده می‌کند؛
    // WebView بدون onGeolocationPermissionsShowPrompt + پرمیشن runtime اندروید،
    // درخواست موقعیت را بی‌صدا رد می‌کند. الگو دقیقاً مثل دوربین/میکروفون:
    // دیالوگ فارسی اجازه → پرمیشن «در زمان استفاده» اندروید → grant/deny.
    private var pendingGeolocationCallback: android.webkit.GeolocationPermissions.Callback? = null
    private var pendingGeolocationOrigin: String? = null
    private val locationPermissionLauncher = registerForActivityResult(ActivityResultContracts.RequestMultiplePermissions()) { grants ->
        val cb = pendingGeolocationCallback
        val origin = pendingGeolocationOrigin
        pendingGeolocationCallback = null
        pendingGeolocationOrigin = null
        if (cb != null && origin != null) {
            val ok = grants.values.any { it }
            // v1.5.6 — مجوز تأییدشده ذخیره می‌شود تا مدال لوکیشن تکرار نشود + retain=true
            if (ok) {
                try {
                    getSharedPreferences("fitup_web_perms", android.content.Context.MODE_PRIVATE)
                        .edit().putBoolean("geo_granted", true).apply()
                } catch (_: Exception) { }
            }
            runOnUiThread { cb.invoke(origin, ok, true) }
        }
    }

    // ─── OTP خودکار (بدون هیچ پرمیشن پیامک) ───
    // ۱) کیبورد/سیستم: ورودی کد در سایت autocomplete="one-time-code" دارد →
    //    اندروید کد پیامک را بدون هیچ مجوزی پیشنهاد می‌دهد (اندروید ۹+)
    // ۲) کلیپ‌بورد: اگر کاربر کد را کپی کند، در onResume اتو-درج می‌شود
    // ⛔ خواندن مستقیم پیامک (RECEIVE_SMS) عمداً حذف شد — از اندروید ۱۳+ پرمیشن
    //    SMS برای اپ‌های خارج از گوگل‌پلی (از جمله بازار) «محدود» است؛
    //    دیالوگ ترسناک «App was denied access» می‌آمد و اجازه هم هیچ‌وقت داده
    //    نمی‌شد. قانون حریم خصوصی بازار هم با حذفش راضی‌تر است.
    /** آخرین متن کلیپ‌بورد dispatch شده — جلوگیری از dispatch تکراری */
    private var lastClipboardDispatched: String? = null

    @SuppressLint("SetJavaScriptEnabled")
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        binding = ir.fittup.app.databinding.ActivityMainBinding.inflate(layoutInflater)
        setContentView(binding.root)

        webView = binding.webView
        swipeRefresh = binding.swipeRefresh
        splash = binding.splash
        errorView = binding.errorView
        errorRetry = binding.errorRetry

        // 🩹 v1.5.5 (باگ بحرانی «دکمهٔ تلاش مجدد کار نمی‌کند»): دکمهٔ تلاش مجدد
        // صفحهٔ خطا bind شده بود ولی هیچ listener نداشت! کاربری که زرین‌پال برایش
        // باز نشده (VPN/قطعی شبکه) در صفحهٔ خطا گیر می‌کرد. حالا: reload WebView —
        // onPageStarted خودش hideError را صدا می‌زند.
        errorRetry.setOnClickListener {
            errorView.visibility = View.GONE
            swipeRefresh.isRefreshing = true
            webView.reload()
        }

        setupFileChooser()
        setupCameraCapture()
        setupWebView()
        setupPayment()
        setupNotifications()
        setupOtpRetrieverReceiver()

        // 🩹 v1.8 — نگهبان اسپلش: هرگز روی اسپلش گیر نمی‌کنیم (باگ «روی اسپلش گیر
        // می‌کند و بالا نمی‌آید»). اگر صفحه تا ۱۵ ثانیه load نشد، اسپلش بی‌قید و
        // شرط بسته می‌شود؛ کاربر SplashLoader سبک وب/صفحهٔ خطا را می‌بیند.
        android.os.Handler(android.os.Looper.getMainLooper()).postDelayed({
            try {
                if (this@MainActivity::splash.isInitialized && splash.visibility == View.VISIBLE) {
                    splash.visibility = View.GONE
                    Log.w("FitUpApp", "splash watchdog fired (15s) — forced hide")
                }
            } catch (_: Exception) {}
        }, 15_000)

        // v31 — «اعلان‌ها حتی وقتی برنامه بسته است» (کم‌مصرف — WorkManager):
        // زمان‌بندی دوره‌ای ۶ ساعته + همگام‌سازی فوری در باز شدن اپ
        NotificationSync.schedulePeriodic(this)
        NotificationSync.syncNow(this)
        OtpRetriever.dispatcher = { code -> dispatchOtpCode(code) }

        if (savedInstanceState != null) {
            webView.restoreState(savedInstanceState)
        } else {
            // v1.5.4 — شروع با لینک عمیق (App Link / fitup_link اعلان) اگر هست؛
            // 🩹 v1.10.0 — اولویت دوم: URL ذخیره‌شدهٔ نجات اتصال (بازگشت دقیق به
            // همان صفحه بعد از ری‌استارت تمیز پروسه در سناریوی تغییر IP)؛
            // وگرنه شروع مستقیم با OTP/پنل — ?screen=auth: اگر سشن هست → پنل، وگرنه صفحه ورود
            webView.loadUrl(deepLinkUrl(intent) ?: consumeNetGuardRestartUrl() ?: startUrl())
        }

        // ⛔ چک نسخه حذف شد (ریجکشن بازار): اپ بازار هرگز هیچ پیام به‌روزرسانی
        // نشان نمی‌دهد — به‌روزرسانی فقط از طریق خود کافه‌بازار انجام می‌شود.
    }

    /** شروع با ?screen=auth — کاربر لاگین‌شده مستقیم پنل را می‌بیند (نیاز کلیک «ورود» نیست) */
    private fun startUrl(): String {
        val base = BuildConfig.SITE_URL.trimEnd('/')
        return if (base.contains("?")) "$base&screen=auth" else "$base?screen=auth"
    }

    /**
     * v1.5.5 — لینک عمیق ورودی (App Link یا اسکیم fitup:// یا اعلان) یا null:
     *  ۱) extra «fitup_link» از NotificationSync — مسیر/کوئری نسبی مثل
     *     "?tab=progress&section=checkup" یا "/panel" → SITE_URL + آن
     *  ۲) dataِ https روی دامنهٔ خودمان (fittup.ir) → همان URL — پارامترهای
     *     ?tab= ?ref= ?renewal= ?screen= ?article= دست‌نخورده می‌مانند
     *  ۳) v1.5.5 — اسکیم اختصاصی fitup://open?url=<encoded> از صفحهٔ /go سایت
     *     (لینک‌های هوشمند پیامک — فقط URL دامنهٔ خودمان پذیرفته می‌شود)
     * (null-امن — هرگز به‌خاطر لینک خراب کرش نمی‌کند)
     */
    private fun deepLinkUrl(from: Intent?): String? {
        if (from == null) return null
        try {
            val extra = from.getStringExtra("fitup_link")
            if (!extra.isNullOrBlank() && (extra.startsWith("/") || extra.startsWith("?"))) {
                return BuildConfig.SITE_URL.trimEnd('/') + extra
            }
            val data = from.data ?: return null
            val scheme = data.scheme?.lowercase()
            // ─── v1.5.5: fitup://open?url=<encoded> — از لینک هوشمند /go سایت ───
            if (scheme == "fitup") {
                val target = data.getQueryParameter("url") ?: return null
                if (target.startsWith("/")) {
                    // مسیر نسبی روی دامنهٔ خودمان
                    return BuildConfig.SITE_URL.trimEnd('/') + target
                }
                val t = android.net.Uri.parse(target)
                val tScheme = t.scheme?.lowercase()
                val tHost = t.host?.lowercase() ?: return null
                if (isAllowedHost(tHost) && tScheme == "https") return target
                return null
            }
            if (scheme != "https") return null
            val host = data.host?.lowercase() ?: return null
            // فقط دامنه‌های مجاز — همان منطق isAllowedHost (فیتاپ و زیردامنه‌ها)
            if (isAllowedHost(host)) return data.toString()
        } catch (_: Exception) {
        }
        return null
    }

    /** v1.5.4 — لینک عمیق وقتی اپ باز است (launchMode=singleTask → onNewIntent) */
    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        setIntent(intent)
        // WebView ممکن است هنوز آماده نباشد — هرگز کرش نکن
        if (!::webView.isInitialized) return
        val url = deepLinkUrl(intent) ?: return
        runOnUiThread {
            try {
                webView.loadUrl(url)
                // v1.12 — زنده‌سازی پنل: بعد از ناوبری، به JS بگو اتصال زندهٔ پنل را برقرار کند
                dispatchReconnectSse()
            } catch (_: Exception) {
            }
        }
    }

    /* ───────────── WebView ───────────── */

    /**
     * v1.12 — زنده‌سازی پنل: به JS رویداد «fitup:reconnect-sse» می‌فرستد تا
     * اتصال زندهٔ پنل (SSE) دوباره وصل شود + WebView از حالت pause خارج شود.
     * در onResume و بعد از ناوبری دیپ‌لینک صدا زده می‌شود. null/کرش-امن.
     */
    private fun dispatchReconnectSse() {
        try {
            if (!::webView.isInitialized) return
            runOnUiThread {
                try {
                    webView.onResume()
                    webView.resumeTimers()
                    webView.evaluateJavascript(
                        "window.dispatchEvent(new Event('fitup:reconnect-sse'));",
                        null
                    )
                } catch (_: Exception) {
                }
            }
        } catch (_: Exception) {
        }
    }

    /**
     * v1.12 — زنده‌سازی پنل: رفرش هدفمند بخش‌های پنل بدون رفرش کل صفحه
     * (حفظ اسکرول/وضعیت کاربر). هر نام بخش فقط حروف/عدد/خط تیره —
     * هیچ ورودی دیگری به JS نمی‌رود (ضد تزریق).
     */
    private fun dispatchRefreshSections(sections: List<String>) {
        try {
            if (!::webView.isInitialized) return
            val safe = sections.map { s -> s.filter { it.isLetterOrDigit() || it == '_' || it == '-' }.take(32) }
                .filter { it.isNotEmpty() }
                .take(6)
            if (safe.isEmpty()) return
            runOnUiThread {
                try {
                    for (section in safe) {
                        webView.evaluateJavascript(
                            "window.dispatchEvent(new CustomEvent('refresh-section', { detail: '$section' }));",
                            null
                        )
                    }
                } catch (_: Exception) {
                }
            }
        } catch (_: Exception) {
        }
    }

    @SuppressLint("SetJavaScriptEnabled")
    private fun setupWebView() {
        val s: WebSettings = webView.settings
        s.javaScriptEnabled = true
        s.domStorageEnabled = true          // برای سشن لاگین OTP
        s.databaseEnabled = true
        s.loadWithOverviewMode = true
        s.useWideViewPort = true
        s.mediaPlaybackRequiresUserGesture = false   // ویدیوهای تمرین
        s.setGeolocationEnabled(true)                 // v1.6.1 — مسیریاب فیتاپ (GPS زنده)
        s.mixedContentMode = WebSettings.MIXED_CONTENT_NEVER_ALLOW
        s.allowFileAccess = false
        s.allowContentAccess = true          // برای انتخاب فایل (دوربین/گالری)
        s.userAgentString = (s.userAgentString ?: "") + " FitUpBazaar/" + BuildConfig.VERSION_NAME
        s.cacheMode = WebSettings.LOAD_DEFAULT
        // مقیاس متن ثابت — «تجربه اپ واقعی»: فونت سیستم اندروید نباید layout سایت را
        // بشکند یا متن‌ها ناهماهنگ بزرگ/کوچک شود (WebView پیش‌فرض textZoom را با
        // fontScale سیستم تغییر می‌دهد)
        s.textZoom = 100

        // کوکی‌ها را از قبل به WebView وصل کن (سشن OTP بین restartها زنده می‌ماند)
        try {
            CookieManager.getInstance().setAcceptCookie(true)
        } catch (_: Exception) {}

        // پس‌زمینه سفید — بدون فلش تیره هنگام بارگذاری
        webView.setBackgroundColor(Color.WHITE)

        webView.addJavascriptInterface(NativeBridge(), "FitUpNative")

        // v1.5.6 — دانلود فایل‌های data: (PNG/PDF برنامه‌های تمرینی/تغذیه/مکمل)
        // از پل MediaStore. مسیر اصلی از FitUpNative.downloadFile می‌گذرد؛ این
        // لیسنر برای هر مسیر جانبی است.
        // ⚠️ سیاست کافه‌بازار: آپدیت اپ فقط از طریق خود بازار — عمداً لینک‌های
        // http/https/APK را نمی‌گیریم تا دانلود مستقیم APK داخل اپ ممکن نشود.
        webView.setDownloadListener { url, _, _, mimetype, _ ->
            try {
                if (url.startsWith("data:", ignoreCase = true)) {
                    val ext = when {
                        mimetype.contains("pdf", true) -> "pdf"
                        mimetype.contains("png", true) -> "png"
                        mimetype.contains("jpeg", true) || mimetype.contains("jpg", true) -> "jpg"
                        mimetype.contains("webp", true) -> "webp"
                        else -> "bin"
                    }
                    downloadDataUrl("fitup-${System.currentTimeMillis()}.$ext", url)
                }
            } catch (_: Exception) {
                toast("دانلود ممکن نشد")
            }
        }

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

                // فقط دامنه‌های خودمان + درگاه پرداخت داخل WebView؛ بقیه (لینک بیرونی
                // مقالات) → مرورگر. 🩹 v1.5.5 (باگ بحرانی «رفتن به درگاه پرداخت هیچ
                // کاری نمی‌کند»): قبلاً زرین‌پال/شاپرک هم به مرورگر بیرونی
                // openExternal می‌شد — بدون مرورگر، catch خالی = هیچ اتفاقی نمی‌افتاد
                // (دکمهٔ بی‌خاصیت)؛ و با مرورگر هم سشن/بازگشت خودکار (payment_verify)
                // از دست می‌رفت → تراکنش برای همیشه «در انتظار» می‌ماند. حالا درگاه
                // مثل اپ اختصاصی داخل WebView باز می‌شود و کاربر به سایت برمی‌گردد.
                val host = url.host ?: return false
                if (!isAllowedHost(host) && !isPaymentHost(host)) {
                    openExternal(url)
                    return true
                }
                return false
            }

            override fun onPageFinished(view: WebView, url: String) {
                splash.visibility = View.GONE
                swipeRefresh.isRefreshing = false
                injectBridgeHelper()
                // بازیابی خریدهای consume-نشده — بعد از هر بارگذاری کامل صفحه
                maybeRestorePurchases()
                // 🩹 v1.9 — نگهبان صفحهٔ سفید: اگر صفحه بعد از لود عملاً خالی باشد
                // (JS مرده — چانک‌های بیلد قبلی بعد از آپدیت سایت)، خودکار پاک‌سازی
                // کش + تلاش مجدد انجام می‌شود؛ کاربر هرگز در سفیدِ بی‌صدا گیر نمی‌کند.
                scheduleBlankPageCheck()
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
                Log.e("FitUp", "WebView renderer gone — recreating activity")
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
                // ─── v120 — پشتیبانی دوربین (رفع تذکر کافه‌بازار versionCode 15) ───
                // input با صفت capture (گزینهٔ «گرفتن با دوربین» در سایت) →
                // isCaptureEnabled=true → دوربین واقعی باز می‌شود.
                val wantsImage = params.acceptTypes.any { it.startsWith("image/") }
                val wantsVideo = params.acceptTypes.any { it.startsWith("video/") }
                if (params.isCaptureEnabled && (wantsImage || wantsVideo)) {
                    val cameraGranted = ContextCompat.checkSelfPermission(
                        this@MainActivity, android.Manifest.permission.CAMERA
                    ) == PackageManager.PERMISSION_GRANTED
                    if (cameraGranted) {
                        return try {
                            launchCameraCaptureIntent(params)
                            true
                        } catch (e: ActivityNotFoundException) {
                            fallbackToGallery(params)
                            true
                        }
                    } else {
                        // چون اپ مجوز CAMERA را در مانیفست اعلان کرده، سیستم برای
                        // ACTION_IMAGE_CAPTURE همین مجوز را الزامی می‌کند —
                        // در زمان استفاده درخواست می‌شود (نه در استارتاپ).
                        pendingCameraAfterPermission = params
                        try {
                            cameraPermissionLauncher.launch(android.Manifest.permission.CAMERA)
                            return true
                        } catch (_: Exception) {
                            pendingCameraAfterPermission = null
                            return fallbackToGallery(params)
                        }
                    }
                }
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
             * ─── v1.6.1 — موقعیت مکانی (GPS) — دقیقاً در زمان استفاده ───
             * مسیریاب فیتاپ (/activity) موقعیت را فقط وقتی کاربر دکمهٔ «شروع» را
             * می‌زند درخواست می‌کند. الگو: دیالوگ کوتاه فارسی اجازه → پرمیشن
             * runtime اندروید (در زمان استفاده — سازگار با قانون حریم خصوصی بازار).
             */
            override fun onGeolocationPermissionsShowPrompt(
                origin: String?,
                callback: android.webkit.GeolocationPermissions.Callback?
            ) {
                val geoHost: String? = try { URI(origin).host } catch (_: Exception) { null }
                if (origin == null || callback == null || geoHost == null || !isAllowedHost(geoHost)) {
                    callback?.invoke(origin ?: "", false, false)
                    return
                }
                // v1.5.6 — تیکت مالک: «مدال اجازهٔ لوکیشن هر بار با دکمهٔ شروع میاد» —
                // retain=false ← WebView مجوز را به خاطر نمی‌سپارد. فیکس: ذخیرهٔ مجوز
                // در SharedPreferences + grant بدون دیالوگ با retain=true.
                val geoPrefs = getSharedPreferences("fitup_web_perms", android.content.Context.MODE_PRIVATE)
                if (geoPrefs.getBoolean("geo_granted", false)) {
                    callback.invoke(origin, true, true)
                    return
                }
                pendingGeolocationCallback = callback
                pendingGeolocationOrigin = origin
                runOnUiThread {
                    AlertDialog.Builder(this@MainActivity)
                        .setTitle("اجازه دسترسی به موقعیت")
                        .setMessage("برای ثبت مسیر پیاده‌روی و دویدن، اجازهٔ دسترسی به موقعیت مکانی می‌دهی؟ (فقط یک بار پرسیده می‌شود)")
                        .setPositiveButton("اجازه می‌دهم") { _, _ ->
                            val perms = arrayOf(
                                android.Manifest.permission.ACCESS_FINE_LOCATION,
                                android.Manifest.permission.ACCESS_COARSE_LOCATION
                            )
                            val alreadyGranted = ContextCompat.checkSelfPermission(this@MainActivity, android.Manifest.permission.ACCESS_FINE_LOCATION) == PackageManager.PERMISSION_GRANTED ||
                                ContextCompat.checkSelfPermission(this@MainActivity, android.Manifest.permission.ACCESS_COARSE_LOCATION) == PackageManager.PERMISSION_GRANTED
                            if (alreadyGranted) {
                                geoPrefs.edit().putBoolean("geo_granted", true).apply()
                                pendingGeolocationCallback = null
                                pendingGeolocationOrigin = null
                                callback.invoke(origin, true, true)
                            } else {
                                try {
                                    locationPermissionLauncher.launch(perms)
                                } catch (_: Exception) {
                                    pendingGeolocationCallback = null
                                    pendingGeolocationOrigin = null
                                    callback.invoke(origin, false, false)
                                }
                            }
                        }
                        .setNegativeButton("نه") { _, _ ->
                            pendingGeolocationCallback = null
                            pendingGeolocationOrigin = null
                            callback.invoke(origin, false, false)
                        }
                        .setOnCancelListener {
                            pendingGeolocationCallback = null
                            pendingGeolocationOrigin = null
                            callback.invoke(origin, false, false)
                        }
                        .show()
                }
            }

            /**
             * ─── مجوز دوربین/میکروفون وب — دقیقاً در زمان استفاده ───
             * سایت برای ضبط صدا (ویس چت) یا ویدیو (آنالیز ویدیویی تمرین/بدن) از
             * navigator.mediaDevices.getUserMedia استفاده می‌کند؛ این کال‌بک فقط
             * در همان لحظه اجرا می‌شود (نه در استارتاپ). الگوی سایت: دیالوگ کوتاه
             * فارسی اجازه → سپس مجوز runtime اندروید.
             */
            override fun onPermissionRequest(request: PermissionRequest) {
                val resources = request.resources
                val needsVideo = resources.contains(PermissionRequest.RESOURCE_VIDEO_CAPTURE)
                val needsAudio = resources.contains(PermissionRequest.RESOURCE_AUDIO_CAPTURE)
                if (!needsVideo && !needsAudio) {
                    request.deny()
                    return
                }
                runOnUiThread {
                    val what = when {
                        needsVideo && needsAudio -> "ضبط ویدیو (دوربین و میکروفون)"
                        needsVideo -> "استفاده از دوربین"
                        else -> "استفاده از میکروفون"
                    }
                    // دیالوگ کوتاه، نه متن طولانی رباتی — الگوی دیالوگ پیامک OTP
                    AlertDialog.Builder(this@MainActivity)
                        .setTitle("اجازه دسترسی")
                        .setMessage("برای $what اجازه می‌دهی؟")
                        .setPositiveButton("اجازه می‌دهم") { _, _ ->
                            requestMediaRuntimePermissions(request)
                        }
                        .setNegativeButton("نه") { _, _ -> request.deny() }
                        .show()
                }
            }
        }

        swipeRefresh.setOnRefreshListener { webView.reload() }
        // رنگ برند فیتاپ
        swipeRefresh.setColorSchemeColors(Color.parseColor("#f97316"))

        // ─── FIX: اسکرول به بالا → رفرش نمی‌شود ───
        // باگ: SwipeRefreshLayout همیشه فعال بود؛ وقتی صفحه اسکرول‌شده بود و
        // کاربر انگشت را به پایین می‌کشید (برای برگشتن به بالای صفحه)، به‌جای
        // اسکرول، pull-to-refresh فعال می‌شد و صفحه رفرش می‌شد. رفع: refresh فقط
        // وقتی مجاز است که WebView دقیقاً در بالای صفحه است (scrollY == 0).
        swipeRefresh.isEnabled = true
        webView.setOnScrollChangeListener { _, _, scrollY, _, _ ->
            swipeRefresh.isEnabled = scrollY == 0
        }
    }

    /** آیا این host دامنه مجاز ماست؟ */
    private fun isAllowedHost(host: String): Boolean {
        val siteHost = try { URI(BuildConfig.SITE_URL).host } catch (_: Exception) { null }
        if (host == "fittup.ir" || host.endsWith(".fittup.ir")) return true
        if (siteHost != null && (host == siteHost || host.endsWith(".$siteHost"))) return true
        return false
    }

    /* ─── v1.8 — سیاست شبکه: «VPN / سوییچ شبکه = هیچ رویداد» (دیرکتیو مالک) ───
     * نسخهٔ قبل بازیابی «هوشمند» داشت (NetworkCallback → پروب HTTP → recreate).
     * خودش منبع دو باگ شد: recreate صفحه را از نو بارگذاری می‌کرد → کاربر وسط
     * مدال خرید/تحلیل آنبوردینگ بیرون می‌افتاد (یک‌بار OTP، یک‌بار گیر اسپلش).
     * حالا مثل همهٔ اپ‌های استاندارد دنیا: با سوییچ VPN/شبکه هیچ کاری نمی‌کنیم —
     * صفحه و مدال‌ها دست‌نخورده می‌مانند. سوکت‌های مرده را وب خودش با تایم‌اوت/
     * ریتری (net-shield v156 + fetchWithResilience) دور می‌زند و اتصال بعدی روی
     * شبکهٔ فعال ساخته می‌شود. رفرش دستی (pull-to-refresh) و صفحهٔ خطا با دکمهٔ
     * «تلاش مجدد» برای کاربر می‌مانند. ─── */

    /**
     * 🩹 v1.5.5 — درگاه پرداخت باید مثل اپ اختصاصی داخل WebView باز شود.
     * فقط برای مسیریابی ناوبری استفاده می‌شود؛ پل JS (bridgeAllowed) عمداً
     * فقط دامنهٔ خودمان را قبول می‌کند (امنیت، بدون تغییر).
     */
    private fun isPaymentHost(host: String): Boolean {
        return host == "zarinpal.com" || host.endsWith(".zarinpal.com") ||
            host == "zarin.link" || host.endsWith(".zarin.link") ||
            host == "shaparak.ir" || host.endsWith(".shaparak.ir")
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
                    // v1.5.4 — سخت‌سازی امنیتی (ضد intent-redirection؛ هم‌تراز اپ اختصاصی):
                    // فقط ACTION_VIEW عمومی — بدون component/package/selector تا
                    // نتوان به اپ دلخواه (از جمله خود اپ با extraهای دلخواه) هدایت شد
                    intent.component = null
                    intent.selector = null
                    intent.setPackage(null)
                    startActivity(intent)
                }
                else -> startActivity(Intent(Intent.ACTION_VIEW, uri))
            }
        } catch (_: Exception) {
            // اپی برای این لینک نیست — نادیده بگیر (صفحه خطای WebView نشان نده)
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

    /* ───────────── 🩹 v1.9 — نگهبان صفحهٔ سفید ───────────── */
    // ۸ ثانیه بعد از پایان هر بارگذاری، حجم متن صفحه سنجیده می‌شود:
    //   • متن تقریباً صفر (len < 5) یعنی صفحه سفید/خالی است:
    //       بار اول → پاک‌کردن کش WebView (clearCache(true) — کوکی‌ها/سشن دست‌نخورده)
    //                 + reload → HTML تازه از سرور → درمان قطعی «کش حاوی بیلد مرده»
    //       باز هم خالی → صفحهٔ خطای فارسی با دکمهٔ تلاش مجدد (به‌جای سفیدِ بی‌صدا)
    //   • اسپلش/صفحهٔ خطای نیتیو هنوز باز هستند → چک نمی‌کنیم (لود نشده/خطا از قبل مدیریت است)
    private fun scheduleBlankPageCheck() {
        if (blankCheckPending) return
        blankCheckPending = true
        android.os.Handler(android.os.Looper.getMainLooper()).postDelayed({
            blankCheckPending = false
            try {
                if (!::webView.isInitialized) return@postDelayed
                if (this@MainActivity::splash.isInitialized && splash.visibility == View.VISIBLE) return@postDelayed
                if (this@MainActivity::errorView.isInitialized && errorView.visibility == View.VISIBLE) return@postDelayed
                webView.evaluateJavascript(
                    "(function(){var b=document.body;return b?((b.innerText||'').replace(/\\s+/g,'').length):0;})()"
                ) { value ->
                    try {
                        val len = value?.trim()?.removeSurrounding("\"")?.toIntOrNull() ?: 0
                        if (len < 5) {
                            Log.w("FitUp", "blank page detected (textLen=$len) — cache clear + reload")
                            if (!blankPageReloadUsed) {
                                blankPageReloadUsed = true
                                try { webView.clearCache(true) } catch (_: Exception) {}
                                webView.reload()
                            } else {
                                showError()
                            }
                        }
                    } catch (_: Exception) {
                    }
                }
            } catch (_: Exception) {
            }
        }, 8_000)
    }

    /* ───────────── helper سمت سایت ───────────── */

    /** helper سمت سایت — پرامیس تمیز برای خرید بازار + هندلر restore */
    private fun injectBridgeHelper() {
        val js = """
            (function() {
              if (window.__fitupBazaarInjected) return;
              window.__fitupBazaarInjected = true;
              window.__bazaarPending = {};
              // نتیجه پرداخت از نیتیو — id + آبجکت نتیجه
              window.__bazaarPaymentResult = function(id, result) {
                var p = window.__bazaarPending[id];
                if (p) { delete window.__bazaarPending[id]; p(result); }
              };
              // آیا داخل اپ بازار هستیم؟
              window.isFitUpBazaarApp = function() {
                try { return !!(window.FitUpNative && window.FitUpNative.isBazaarApp && window.FitUpNative.isBazaarApp()); }
                catch (e) { return false; }
              };
              // خرید از بازار → پرامیس {ok, purchaseToken, orderId, productId, error}
              // dynamicPriceToken (اختیاری): شناسه قیمت پویا برای پرداخت با مبلغ تخفیف‌دار
              window.fitupBazaarPurchase = function(sku, payload, dynamicPriceToken) {
                return new Promise(function(resolve) {
                  var id = 'cb' + Date.now() + Math.floor(Math.random() * 1000);
                  window.__bazaarPending[id] = resolve;
                  try {
                    var token = (dynamicPriceToken == null) ? '' : String(dynamicPriceToken);
                    window.FitUpNative.purchaseSubscription(String(sku), JSON.stringify(payload || {}), id, token);
                  } catch (e) {
                    delete window.__bazaarPending[id];
                    resolve({ ok: false, error: String(e) });
                  }
                });
              };
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
                // انتخاب چندگانه (عکس چت)
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

    /* ───────────── v120 — دوربین برای آپلود (رفع تذکر کافه‌بازار) ───────────── */

    private fun setupCameraCapture() {
        cameraCaptureLauncher = registerForActivityResult(ActivityResultContracts.StartActivityForResult()) { result ->
            val callback = filePathCallback ?: return@registerForActivityResult
            filePathCallback = null
            if (result.resultCode == RESULT_OK) {
                // عکس: خروجی در pendingCameraUri (EXTRA_OUTPUT) — ویدیو: Uri در data
                val uri = pendingCameraUri ?: result.data?.data
                pendingCameraUri = null
                callback.onReceiveValue(if (uri != null) arrayOf(uri) else arrayOf())
            } else {
                // کاربر دوربین را لغو کرد → پاسخ خالی (بدون فایل)
                pendingCameraUri = null
                callback.onReceiveValue(arrayOf())
            }
        }
    }

    /** باز کردن دوربین واقعی برای input[type=file] با پرچم capture
     *  نوع image → ACTION_IMAGE_CAPTURE با FileProvider و EXTRA_OUTPUT
     *  نوع video → ACTION_VIDEO_CAPTURE (نتیجه در data) */
    private fun launchCameraCaptureIntent(params: WebChromeClient.FileChooserParams) {
        val wantsVideo = params.acceptTypes.any { it.startsWith("video/") }
        if (wantsVideo) {
            cameraCaptureLauncher.launch(
                Intent(MediaStore.ACTION_VIDEO_CAPTURE).apply {
                    putExtra(MediaStore.EXTRA_VIDEO_QUALITY, 1)
                }
            )
        } else {
            // فایل ثابت → هر بار overwrite می‌شود؛ فایل اضافی انباشته نمی‌شود
            val dir = File(cacheDir, "camera")
            if (!dir.exists()) dir.mkdirs()
            val photoFile = File(dir, "fitup_camera.jpg")
            val uri = androidx.core.content.FileProvider.getUriForFile(
                this, "$packageName.fileprovider", photoFile
            )
            pendingCameraUri = uri
            cameraCaptureLauncher.launch(
                Intent(MediaStore.ACTION_IMAGE_CAPTURE).apply {
                    putExtra(MediaStore.EXTRA_OUTPUT, uri)
                    addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION or Intent.FLAG_GRANT_WRITE_URI_PERMISSION)
                }
            )
        }
    }

    /** عقب‌گرد امن به انتخابگر گالری/فایل اگر دوربین در دسترس نبود یا مجوز رد شد */
    private fun fallbackToGallery(params: WebChromeClient.FileChooserParams?): Boolean {
        return try {
            val intent = params?.createIntent()
                ?: Intent(Intent.ACTION_GET_CONTENT).apply {
                    addCategory(Intent.CATEGORY_OPENABLE)
                    type = "*/*"
                }
            intent.putExtra(Intent.EXTRA_ALLOW_MULTIPLE, true)
            fileChooserLauncher.launch(intent)
            true
        } catch (e: ActivityNotFoundException) {
            filePathCallback = null
            false
        }
    }

    /* ───────────── پرداخت درون‌برنامه‌ای بازار (پولکی) ───────────── */

    private fun setupPayment() {
        // کلید RSA از پیشخان توسعه‌دهندگان بازار (تب «پرداخت درون‌برنامه‌ای» برنامه)
        val configuredKey = BuildConfig.BAZAAR_RSA_PUBLIC_KEY.trim()
        rsaKeyValid = configuredKey.isNotEmpty() && configuredKey != "PASTE_YOUR_RSA_KEY_HERE"
        if (!rsaKeyValid) {
            Log.w("FitUp", "⚠️ BAZAAR_RSA_PUBLIC_KEY تنظیم نشده — خرید fail-closed می‌شود (امنیت). کلید را از پیشخان بازار بگیرید و در app/build.gradle.kts قرار دهید.")
        }
        val securityCheck = if (rsaKeyValid) {
            SecurityCheck.Enable(rsaPublicKey = configuredKey)
        } else {
            // اتصال برای query/restore باز می‌ماند؛ خود خرید fail-closed است (startBazaarPurchase)
            SecurityCheck.Disable
        }

        val config = PaymentConfiguration(localSecurityCheck = securityCheck)
        payment = Payment(context = this, config = config)

        // اتصال به سرویس پرداخت بازار — DSL با receiver
        connection = payment?.connect {
            connectionSucceed {
                paymentReady = true
                // بازیابی خریدهای consume-نشده (کرش بین پرداخت و فعال‌سازی سرور)
                queryUnconsumedPurchases()
            }
            connectionFailed { _ ->
                paymentReady = false
            }
            disconnected {
                paymentReady = false
            }
        }
    }

    /** بازیابی خریدها — فقط وقتی صفحه JS آماده است (پس از onPageFinished صدا زده می‌شود) */
    private var jsReadyForRestore = false
    private fun maybeRestorePurchases() {
        jsReadyForRestore = true
        if (paymentReady) queryUnconsumedPurchases()
    }

    /** خریدهای consume-نشده → به سایت (idempotent) → سایت بعد از فعال‌سازی consume می‌کند */
    private fun queryUnconsumedPurchases() {
        if (!jsReadyForRestore) return
        try {
            payment?.getPurchasedProducts {
                querySucceed { purchaseList ->
                    val items = purchaseList.filter { !it.purchaseToken.isNullOrBlank() }
                    if (items.isEmpty()) return@querySucceed
                    val arr = JSONArray()
                    for (p in items) {
                        arr.put(
                            JSONObject()
                                .put("productId", p.productId ?: "")
                                .put("purchaseToken", p.purchaseToken ?: "")
                                .put("orderId", p.orderId ?: "")
                                // v1.5.7 — امضای خرید برای مسیر پشتیبان RSA سرور
                                .put("dataJson", p.originalJson ?: "")
                                .put("signature", p.dataSignature ?: "")
                        )
                    }
                    runOnUiThread {
                        webView.evaluateJavascript(
                            "window.__fitupBazaarRestore && window.__fitupBazaarRestore($arr);",
                            null
                        )
                    }
                }
                queryFailed { _ ->
                    // بازار قدیمی/نصب‌نشده — نادیده بگیر
                }
            }
        } catch (e: Exception) {
            Log.w("FitUp", "queryPurchases failed: ${e.message}")
        }
    }

    /** شروع خرید از بازار — نتیجه به وب برمی‌گردد. fail-closed بدون کلید RSA.
     *  dynamicPriceToken: شناسه قیمت پویا (تخفیف/اعتبار ارتقا) — خالی = قیمت پایه SKU */
    private fun startBazaarPurchase(sku: String, payloadJson: String, callbackId: String, dynamicPriceToken: String) {
        // پاسخ به وب: window.__bazaarPaymentResult(id, resultObject)
        fun respond(json: JSONObject) {
            runOnUiThread {
                webView.evaluateJavascript(
                    "window.__bazaarPaymentResult && window.__bazaarPaymentResult('$callbackId', $json);",
                    null
                )
            }
        }

        if (!rsaKeyValid) {
            // fail-closed (ممیزی 2-d باگ #1): بدون کلید RSA، خرید هرگز انجام نمی‌شود —
            // نه SecurityCheck.Disable با «خرید بدون وریفای محلی».
            respond(
                JSONObject()
                    .put("ok", false)
                    .put("error", "پرداخت درون‌برنامه‌ای پیکربندی نشده است (کلید RSA). لطفاً از نسخه وب سایت خرید کنید یا اپ را به‌روزرسانی کنید.")
            )
            return
        }
        if (!paymentReady) {
            respond(
                JSONObject()
                    .put("ok", false)
                    .put("error", "اتصال به پرداخت بازار برقرار نیست. برنامه بازار را باز کنید، وارد حساب شوید و دوباره تلاش کنید.")
            )
            return
        }
        if (activePaymentCallbackId != null) {
            respond(JSONObject().put("ok", false).put("error", "یک پرداخت دیگر در حال انجام است."))
            return
        }
        activePaymentCallbackId = callbackId

        val finish: (JSONObject) -> Unit = { json ->
            activePaymentCallbackId = null
            respond(json)
        }

        val request = PurchaseRequest(
            productId = sku,
            payload = payloadJson,
            dynamicPriceToken = dynamicPriceToken.ifBlank { null } // قیمت پویا (تخفیف) اگر سایت ثبت کرده باشد
        )
        payment?.purchaseProduct(
            registry = activityResultRegistry,
            request = request,
        ) {
            purchaseSucceed { purchaseInfo ->
                val json = JSONObject()
                    .put("ok", true)
                    .put("purchaseToken", purchaseInfo.purchaseToken ?: "")
                    .put("orderId", purchaseInfo.orderId ?: "")
                    .put("productId", purchaseInfo.productId ?: sku)
                    .put("payload", purchaseInfo.payload ?: payloadJson)
                    .put("purchaseTime", purchaseInfo.purchaseTime ?: 0L)
                    // v1.5.7 — امضای خرید (originalJson + signature) به سایت می‌رود تا
                    // سرور بتواند در نبود API بازار، امضا را با کلید RSA پنل
                    // راستی‌آزمایی کند (رفع ایراد بازرسی بازار درباره پیغام
                    // «اعتبارنامه‌های API بازار تنظیم نیست» بعد از خرید موفق)
                    .put("dataJson", purchaseInfo.originalJson ?: "")
                    .put("signature", purchaseInfo.dataSignature ?: "")
                // سایت خودش purchaseToken را برای فعال‌سازی به /api/payment/bazaar/purchase
                // می‌فرستد و بعد از موفقیت consumePurchase را صدا می‌زند (تمدید ممکن می‌شود)
                finish(json)
            }
            purchaseFailed { throwable ->
                finish(
                    JSONObject()
                        .put("ok", false)
                        .put("error", "پرداخت ناموفق: ${throwable?.message ?: "خطای نامشخص"}")
                )
            }
            purchaseCanceled {
                finish(
                    JSONObject()
                        .put("ok", false)
                        .put("canceled", true)
                        .put("error", "پرداخت توسط شما لغو شد.")
                )
            }
            purchaseFlowBegan {
                // جریان خرید شروع شد — نیازی به عمل نیست
            }
            failedToBeginFlow { throwable ->
                // شروع جریان شکست خورد (بازار قدیمی/نصب‌نشده) — گارد single-flight آزاد می‌شود
                finish(
                    JSONObject()
                        .put("ok", false)
                        .put("error", "امکان شروع پرداخت نبود: ${throwable?.message ?: "برنامه بازار به‌روز نیست یا نصب نیست"}")
                )
            }
        }
    }

    /** consume خرید — بعد از فعال‌سازی موفق روی سرور از سمت سایت صدا زده می‌شود */
    private fun consumePurchaseToken(purchaseToken: String) {
        try {
            payment?.consumeProduct(purchaseToken) {
                consumeSucceed {
                    Log.d("FitUp", "purchase consumed: ${purchaseToken.take(24)}…")
                }
                consumeFailed { throwable ->
                    Log.w("FitUp", "consume failed: ${throwable?.message}")
                }
            }
        } catch (e: Exception) {
            Log.w("FitUp", "consume exception: ${e.message}")
        }
    }

    /* ───────────── دانلود / چاپ ───────────── */

    /** ذخیره data URL (PNG/PDF) در Downloads اندروید */
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
                // اندروید ۱۰+ — MediaStore (بدون نیاز به مجوز)
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
                // اندروید ۹ و پایین‌تر — پوشه اپ (بدون مجوز نوشتن)
                val dir = getExternalFilesDir(Environment.DIRECTORY_DOCUMENTS) ?: filesDir
                val file = File(dir, safeName)
                FileOutputStream(file).use { it.write(bytes) }
            }
            runOnUiThread { toast("«$safeName» ذخیره شد ✓") }
        } catch (e: Exception) {
            Log.e("FitUp", "download failed: ${e.message}")
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
        // کانال نوتیف (اندروید ۸+)
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            val channel = NotificationChannel(
                CHANNEL_ID,
                "اعلان‌های فیتاپ",
                NotificationManager.IMPORTANCE_DEFAULT
            ).apply { description = "یادآوری‌ها و خبرهای برنامه" }
            val nm = getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
            nm.createNotificationChannel(channel)
        }
        // ─── مجوز POST_NOTIFICATIONS دیگر «خودکار در استارتاپ» گرفته نمی‌شود ───
        // درخواست مالک: «دسترسی‌ها باید شخصی‌سازی‌شده اجازه بگیرن — الان انگار
        // کروم داره اجازه دسترسی می‌گیره». دیالوگ سیستمی بی‌سبق در لحظه‌ی باز
        // شدن اپ، همان حس «کروم اجازه می‌خواهد» را می‌داد. حالا فقط کانال ساخته
        // می‌شود و مجوز از پل JS (requestNotificationPermission) وقتی کاربر در
        // خود سایت روی «فعال‌سازی اعلان‌ها» کلیک می‌کند، خواسته می‌شود — با
        // توضیح زیبا در خود سایت قبل از دیالوگ کوتاه سیستمی.
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

    /* ───────────── دوربین/میکروفون WebView (getUserMedia) ───────────── */

    /**
     * مجوز runtime دوربین/میکروفون — دقیقاً وقتی سایت ضبط صدا/ویدیو می‌خواهد
     * (WebChromeClient.onPermissionRequest، بعد از دیالوگ اجازه فارسی).
     * اگر همه مجوزها از قبل داده شده باشند مستقیم grant می‌شود؛ وگرنه
     * دیالوگ سیستمی اندروید.
     */
    private fun requestMediaRuntimePermissions(webRequest: PermissionRequest) {
        // درخواست معلق قبلی را رد کن (درخواست همزمان/تکراری از صفحه)
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
                // دیالوگ سیستم باز نشد (مثلاً گوشی خاص) — fail بسته
                pendingWebPermissionRequest = null
                runOnUiThread { webRequest.deny() }
            }
        }
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
                // باز کردن اپ با لمس نوتیف
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
            Log.w("FitUp", "notification failed: ${e.message}")
        }
    }

    /* ───────────── OTP خودکار: کلیپ‌بورد (بدون پرمیشن) ───────────── */

    /**
     * درج کد OTP در صفحه ورود سایت — سایت window.__fitupNativeSmsCode را
     * فقط روی صفحه OTP فعال می‌کند (auth-screen)؛ خارج از آن فراخوانی بی‌اثر است.
     */
    private fun dispatchOtpCode(code: String) {
        runOnUiThread {
            webView.evaluateJavascript(
                "window.__fitupNativeSmsCode && window.__fitupNativeSmsCode('$code');",
                null
            )
        }
    }

    /** کد OTP از کلیپ‌بورد — v1.5.7: هم کدِ خالص و هم «متن کامل پیامک» کپی‌شده.
     *  برای جلوگیری از درج اشتباه عدد ۴-رقمی نامرتبط (مثل سال «1404»)، استخراج
     *  گروه ۴-رقمی فقط وقتی انجام می‌شود که متن شامل «فیتاپ» یا fittup باشد یا
     *  خود کلیپ‌بورد دقیقاً کد ۴-رقمی باشد. */
    private fun maybeDispatchClipboardOtp() {
        try {
            val cm = getSystemService(Context.CLIPBOARD_SERVICE) as? android.content.ClipboardManager ?: return
            val text = cm.primaryClip?.getItemAt(0)?.coerceToText(this)?.toString()?.trim() ?: return
            if (text == lastClipboardDispatched) return
            val code = when {
                Regex("^\\d{4}$").matches(text) -> text
                text.contains("فیتاپ") || text.contains("fittup", ignoreCase = true) ->
                    Regex("(?<!\\d)\\d{4}(?!\\d)").findAll(text).map { it.value }.lastOrNull()
                else -> null
            }
            if (code != null) {
                lastClipboardDispatched = text
                dispatchOtpCode(code)
            }
        } catch (_: Exception) {}
    }

    /* ───────────── OTP خودکار: SMS Retriever (v31 — بدون پرمیشن) ───────────── */
    // پیامکی که متنش با هش ۱۱-کاراکتری اپ امضا شده (سرور — ارسال خام sms.ir)
    // مستقیم به OtpRetrieverReceiver می‌رسد؛ بدون RECEIVE_SMS و بدون هیچ دیالوگی —
    // سازگار کامل با قانون حریم خصوصی بازار.

    private val otpReceiver = OtpRetrieverReceiver()

    private fun setupOtpRetrieverReceiver() {
        try {
            // فرستنده = Google Play Services (اپ دیگر) → EXPORTED لازم است
            ContextCompat.registerReceiver(
                this, otpReceiver,
                IntentFilter(SmsRetriever.SMS_RETRIEVED_ACTION),
                ContextCompat.RECEIVER_EXPORTED
            )
        } catch (_: Exception) {}
    }

    /** از پل وب (صفحهٔ ورود کد) — فعال‌سازی شنوندهٔ ۵ دقیقه‌ای */
    private fun startOtpSmsRetriever() {
        try {
            val task = SmsRetriever.getClient(this).startSmsRetriever()
            task.addOnSuccessListener { Log.i("FitUpBazaar", "SMS Retriever armed") }
            task.addOnFailureListener { Log.w("FitUpBazaar", "SMS Retriever unavailable: ${it.message}") }
        } catch (e: Exception) {
            // دستگاه بدون سرویس گوگل — fail-safe (ورود دستی/کلیپ‌بورد سر جایشان)
            Log.w("FitUpBazaar", "SMS Retriever start failed: ${e.message}")
        }
    }

    /* ───────────── اعلان‌ها حتی وقتی برنامه بسته است (v31) ───────────── */

    /**
     * دیالوگ فارسی یک‌بار-محور: «بهینه‌سازی باتری برای فیتاپ غیرفعال شود؟»
     * هدف: جلوی کشتن فرآیند WorkManager توسط بهینه‌سازهای تهاجمی — مخصوصاً
     * شیائومی/سامسونگ. مصرف باتری به‌طور محسوسی بالا نمی‌رود (فقط JobScheduler).
     * از پل وب بعد از رضایت اعلان‌ها صدا زده می‌شود؛ رد → دیگر پرسیده نمی‌شود.
     */
    private fun maybeRequestBatteryExemption() {
        try {
            val pm = getSystemService(Context.POWER_SERVICE) as android.os.PowerManager
            if (pm.isIgnoringBatteryOptimizations(packageName)) return
            val prefs = getSharedPreferences("fitup_settings", Context.MODE_PRIVATE)
            if (prefs.getBoolean("battery_prompt_dismissed", false)) return
            AlertDialog.Builder(this)
                .setTitle("اعلان‌ها حتی وقتی برنامه بسته است")
                .setMessage("برای اینکه یادآوری‌ها و خبرهای فیتاپ حتی وقتی برنامه را بسته‌ای به دستت برسند، بهینه‌سازی باتری را برای فیتاپ غیرفعال کن. مصرف باتری به‌طور محسوسی افزایش پیدا نمی‌کند.")
                .setPositiveButton("فعال‌سازی اعلان‌ها") { _, _ ->
                    try {
                        startActivity(
                            Intent(
                                Settings.ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS,
                                Uri.parse("package:$packageName")
                            )
                        )
                    } catch (_: Exception) {}
                }
                .setNegativeButton("بعداً") { _, _ ->
                    prefs.edit().putBoolean("battery_prompt_dismissed", true).apply()
                }
                .show()
        } catch (_: Exception) {}
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
            isAllowedHost(host)
        } catch (_: Exception) {
            false
        }
    }

    inner class NativeBridge {
        @JavascriptInterface
        fun isBazaarApp(): Boolean = bridgeAllowed()

        @JavascriptInterface
        fun appVersion(): String = BuildConfig.VERSION_NAME

        /**
         * v1.5.8 — کلید bridge ورود خودکار OTP.
         * صفحهٔ وب (auth-screen) این کلید را در هدر x-fitup-otp-bridge می‌فرستد؛
         * سرور با تطبیقش، کد را در همان پاسخ send-otp برمی‌گرداند تا کد بدون
         * تایپ/دکمه جا بیفتد و کاربر مستقیم وارد پنل شود (مثل اسنپ).
         */
        @JavascriptInterface
        fun getOtpBridgeKey(): String = BuildConfig.OTP_BRIDGE_SECRET

        @JavascriptInterface
        fun isPaymentAvailable(): Boolean = paymentReady && rsaKeyValid

        @JavascriptInterface
        fun purchaseSubscription(sku: String, payloadJson: String, callbackId: String, dynamicPriceToken: String) {
            if (!bridgeAllowed()) return
            runOnUiThread { startBazaarPurchase(sku, payloadJson, callbackId, dynamicPriceToken) }
        }

        @JavascriptInterface
        fun consumePurchase(purchaseToken: String) {
            if (!bridgeAllowed()) return
            consumePurchaseToken(purchaseToken)
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

        /**
         * مجوز اعلان‌های اندروید — از وب‌سایت با UI جذاب خودش صدا زده می‌شود
         * (بعد از توضیح و رضایت کاربر)، نه بی‌سبق در استارتاپ.
         */
        @JavascriptInterface
        fun requestNotificationPermission() {
            if (!bridgeAllowed()) return
            runOnUiThread { maybeRequestNotificationPermission() }
        }

        /** v31 — همگام‌سازی فوری اعلان‌ها (ورود به پنل) */
        @JavascriptInterface
        fun syncNotificationsNow() {
            if (!bridgeAllowed()) return
            NotificationSync.syncNow(applicationContext)
        }


        /** v31 — دیالوگ بهینه‌سازی باتری (بعد از رضایت اعلان‌ها) */
        @JavascriptInterface
        fun requestBatteryOptimization() {
            if (!bridgeAllowed()) return
            runOnUiThread { maybeRequestBatteryExemption() }
        }

        /** v31 — SMS Retriever بدون پرمیشن (صفحهٔ ورود کد) */
        @JavascriptInterface
        fun startOtpSmsRetriever() {
            if (!bridgeAllowed()) return
            startOtpSmsRetriever()
        }

        /**
         * ─── قفل pull-to-refresh برای اسکرول داخلی صفحه (فیکس باگ پروفایل) ───
         * باگ گزارش‌شده: در منوی پروفایل (و هر لیست داخلی اسکرول‌شونده)،
         * کشیدن انگشت به پایین برای «بالا بردن محتوا» باعث رفرش کامل صفحه
         * می‌شد — چون WebView در scrollY=0 بود و SwipeRefreshLayout فعال.
         * ریشه: اسکرولِ داخل عناصر داخلی (Sheet ها و لیست‌های overflow-y)
         * برای WebView نامرئی است. فیکس: سایت در لحظه‌ی شروع لمس روی هر
         * عنصر اسکرول‌شونده داخلی، این پل را با false صدا می‌زند → رفرش
         * قفل می‌شود؛ بعد از پایان لمس دوباره باز می‌شود. با این کار در هیچ
         * جای اپ، اسکرول به بالا باعث رفرش نمی‌شود و رفرش فقط از «واقعاً
         * بالای صفحه اصلی» کار می‌کند.
         */
        @JavascriptInterface
        fun setSwipeRefreshEnabled(enabled: Boolean) {
            if (!bridgeAllowed()) return
            runOnUiThread { swipeRefresh.isEnabled = enabled }
        }

        /**
         * v1.12 — زنده‌سازی پنل (سند real-time مالک — بخش ۲-ب): رفرش هدفمند یک
         * بخش پنل — فقط بخش مرتبط از سرور گرفته و آپدیت می‌شود (بدون رفرش کل
         * صفحه، بدون از دست رفتن اسکرول کاربر).
         * بخش‌ها: wallet | orders | dashboard | programs | messages |
         * notifications | subscription
         */
        @JavascriptInterface
        fun refreshSection(section: String) {
            if (!bridgeAllowed()) return
            val safe = section.filter { it.isLetterOrDigit() || it == '_' || it == '-' }.take(32)
            if (safe.isEmpty()) return
            runOnUiThread {
                try {
                    webView.evaluateJavascript(
                        "window.dispatchEvent(new CustomEvent('refresh-section', { detail: '$safe' }));",
                        null
                    )
                } catch (_: Exception) {
                }
            }
        }

        /**
         * 🩹 v1.11.0 — نجات اتصال بعد از تغییر IP/VPN (ConnectionGuard — بازطراحی):
         * وب بعد از ۱۲ ثانیه قطعیِ ممتد اینجا را صدا می‌زند. پروب نیتیو
         * (HttpURLConnection با استکِ جدا از Chromium) مسیر واقعی را تأیید
         * می‌کند و در صورت سالم‌بودن، صفحه «درجا» reload می‌شود.
         * ⚠️ v1.10.0 اینجا پروسه را با killProcess می‌کشت و به AlarmManager
         * تکیه داشت — در اندروید ۱۰+ لانچ اکتیویتی از پس‌زمینه بلاک می‌شود و
         * اپ بعد از سوییچ VPN کلاً بسته می‌ماند (گزارش مالک). قانون جدید:
         * «اپ هرگز خودش را نمی‌کشد» — سوییچ VPN = reload درجای همان صفحه.
         */
        @JavascriptInterface
        fun netRescue() {
            if (!bridgeAllowed()) return
            Thread {
                try {
                    var reachable = freshProbe("https://fittup.ir/favicon.png")
                    if (!reachable) {
                        // میزبان جایگزین = DNS/اتصال کاملاً تازه (فرار از کشِ میزبان اصلی)
                        Thread.sleep(1_500)
                        reachable = freshProbe("https://www.fittup.ir/favicon.png")
                    }
                    if (reachable) {
                        Log.w("FitUp", "netRescue: real network OK but web stack stale → in-place reload (no process kill)")
                        runOnUiThread {
                            try {
                                android.widget.Toast.makeText(
                                    this@MainActivity,
                                    "اتصال بازیابی شد — در حال تازه‌سازی صفحه…",
                                    android.widget.Toast.LENGTH_SHORT
                                ).show()
                            } catch (_: Exception) {}
                        }
                        // v1.12 — به JS اطلاع بده اتصال زندهٔ پنل را دوباره وصل کند
                        // (سند بخش ۲-د) — هم قبل از ریلود درجا، هم برای صفحهٔ تازه بعد از ریلود
                        dispatchReconnectSse()
                        Thread.sleep(600) // فرصت نمایش Toast
                        rescueReloadInPlace()
                    } else {
                        Log.i("FitUp", "netRescue: network truly down (VPN switching?) — no reload, web keeps probing")
                    }
                } catch (_: Exception) {
                }
            }.start()
        }
    }

    /* ───────────── 🩹 v1.11.0 — ConnectionGuard (نجات اتصال — بدون مرگ پروسه) ───────────── */

    /**
     * پروب تازه با استکِ خودِ جاوا (نه Chromium): HttpsURLConnection جدید با
     * Connection: close — هیچ پول/کشی با WebView به اشتراک گذاشته نمی‌شود.
     * هر پاسخ زیر ۵۰۰ یعنی مسیر واقعی به سایت سالم است.
     */
    private fun freshProbe(url: String): Boolean {
        return try {
            val conn = (java.net.URL(url).openConnection() as javax.net.ssl.HttpsURLConnection).apply {
                connectTimeout = 4_000
                readTimeout = 4_000
                instanceFollowRedirects = false
                setRequestProperty("Connection", "close")
                setRequestProperty("Cache-Control", "no-cache")
                setRequestProperty("User-Agent", "FitUpNetGuard/1.11")
            }
            val ok = try { conn.responseCode < 500 } catch (_: Exception) { false }
            try { conn.disconnect() } catch (_: Exception) {}
            ok
        } catch (_: Exception) {
            false
        }
    }

    /**
     * 🩹 v1.11.0 — بازیابی «درجا» بدون مرگ پروسه (بازطراحی ConnectionGuard):
     * سوییچ VPN/IP حالا فقط یک reload درجای همان صفحه است + اسپلش کوتاه تا
     * DOM کهنه دیده نشود. کاربر دقیقاً به صفحهٔ خودش برمی‌گردد (سشن/کوکی
     * دست‌نخورده) و اپ هیچ‌وقت بسته نمی‌شود.
     * (نسخهٔ 1.10.0 اینجا پروسه را killProcess می‌کرد و AlarmManager اپ را
     * دوباره باز می‌کرد — که در اندروید ۱۰+ بلاک می‌شد و اپ برای همیشه
     * بسته می‌ماند؛ ریشهٔ باگ گزارش‌شدهٔ مالک.)
     */
    private fun rescueReloadInPlace() {
        if (!::webView.isInitialized) return
        runOnUiThread {
            try {
                // اسپلش کوتاه — DOM کهنهٔ صفحهٔ قبلی حین ریلود دیده نشود
                if (this@MainActivity::splash.isInitialized) splash.visibility = View.VISIBLE
                webView.reload()
                // واچ‌داگ: اگر ناوبری به هر دلیلی finish نشد اسپلش گیر نکند
                android.os.Handler(android.os.Looper.getMainLooper()).postDelayed({
                    try {
                        if (this@MainActivity::splash.isInitialized) splash.visibility = View.GONE
                    } catch (_: Exception) {}
                }, 12_000)
                Log.w("FitUp", "netRescue: in-place reload done (process alive, same page)")
            } catch (e: Exception) {
                Log.e("FitUp", "netRescue in-place reload failed: ${e.message}")
            }
        }
    }

    /** URL ذخیره‌شدهٔ نجات (فقط تا ۲ دقیقه اعتبار دارد) — در onCreate مصرف می‌شود */
    private fun consumeNetGuardRestartUrl(): String? {
        return try {
            val prefs = getSharedPreferences("fitup_net_guard", Context.MODE_PRIVATE)
            val url = prefs.getString("restart_url", null)
            val at = prefs.getLong("restart_at", 0)
            prefs.edit().remove("restart_url").apply()
            if (!url.isNullOrBlank() && System.currentTimeMillis() - at < 120_000) url else null
        } catch (_: Exception) {
            null
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
        // 🩹 v1.5.5 (باگ «بک در درگاه پرداخت از برنامه خارج می‌کند»):
        // روی صفحهٔ غیر از سایت خودمان (زرین‌پال/بانک/شاپرک)، پل وب وجود ندارد →
        // 'unknown' → قبلاً مستقیم دیالوگ خروج! حالا اول webView.goBack؛ فقط اگر
        // جایی برای برگشتن نبود، دیالوگ خروج. رفتار داشبورد سایت دست‌نخورده ماند.
        val currentHost = try {
            URI(webView.url ?: "").host?.lowercase()
        } catch (_: Exception) {
            null
        }
        val siteHost = try { URI(BuildConfig.SITE_URL).host?.lowercase() } catch (_: Exception) { null }
        val onOurSite = currentHost != null && siteHost != null &&
            (currentHost == siteHost || currentHost.endsWith(".$siteHost"))
        if (!onOurSite) {
            if (webView.canGoBack()) {
                webView.goBack()
            } else {
                showExitConfirmDialog()
            }
            return
        }
        webView.evaluateJavascript(
            "(function(){try{if(window.__fitupNativeBack){return window.__fitupNativeBack();}}catch(e){}return 'unknown';})()"
        ) { result ->
            val where = result?.trim()?.removePrefix("\"")?.removeSuffix("\"") ?: "unknown"
            if (where == "home" || where == "unknown") {
                showExitConfirmDialog()
            }
        }
    }

    /** مودال تأیید خروج از برنامه (بک دوم روی داشبورد) — دیالوگ برندشدهٔ سفارشی */
    private var exitConfirmDialog: Dialog? = null

    private fun showExitConfirmDialog() {
        if (exitConfirmDialog?.isShowing == true) return
        val dialog = Dialog(this)
        exitConfirmDialog = dialog
        dialog.setContentView(R.layout.dialog_exit)
        dialog.setCancelable(true)             // دکمهٔ بک → بستن
        dialog.setCanceledOnTouchOutside(true) // لمس بیرون کارت → بستن
        dialog.window?.apply {
            // کارت سفیدِ گرد خودش پس‌زمینه است — پس‌زمینهٔ پنجره باید شفاف باشد
            setBackgroundDrawableResource(android.R.color.transparent)
            // چیدمان راست‌به‌چپ در خود layout با android:layoutDirection="rtl" ست شده
            // عرض: ۸۸٪ صفحه، حداکثر ۳۶۰dp — روی تبلت هم خوش‌فرم می‌ماند
            val dm = resources.displayMetrics
            setLayout(
                minOf((dm.widthPixels * 0.88f).toInt(), (360 * dm.density).toInt()),
                ViewGroup.LayoutParams.WRAP_CONTENT
            )
            // انیمیشن فید ساده برای باز/بسته شدن
            attributes.windowAnimations = R.style.FitUpExitDialogAnimation
        }
        // «موندن» → فقط بستن دیالوگ
        dialog.findViewById<TextView>(R.id.btnExitStay).setOnClickListener { dialog.dismiss() }
        // «خروج» → بستن دیالوگ + خروج کامل از برنامه
        dialog.findViewById<TextView>(R.id.btnExitLeave).setOnClickListener {
            dialog.dismiss()
            finishAffinity()
        }
        dialog.show()
    }

    override fun onResume() {
        super.onResume()
        // ─── v1.12 — زنده‌سازی پنل (سند real-time مالک — بخش ۲-الف) ───
        // برگشت به اپ → تایمر/رندر WebView از سر گرفته می‌شود و به JS گفته
        // می‌شود اتصال زندهٔ SSE را دوباره وصل کند → پنل بدون رفرش دستی به‌روز است
        dispatchReconnectSse()
        // OTP: شاید کد از کلیپ‌بورد آمده (کپی از نوتیف پیامک) — بدون پرمیشن
        maybeDispatchClipboardOtp()
        // OTP: کد رسیده در زمان بسته‌بودن اکتیویتی (SMS Retriever) — v31
        OtpRetriever.takePending(this)?.let { dispatchOtpCode(it) }
        // همگام‌سازی اعلان‌های از-دست-رفته در هر باز شدن
        NotificationSync.syncNow(applicationContext)
    }

    override fun onPause() {
        // ─── v1.12 — زنده‌سازی پنل (سند بخش ۲-الف) ───
        // توقف تایمرها/رندر WebView در پس‌زمینه (باتری/دیتا)؛ برگشت زنده
        // می‌شود در onResume (dispatchReconnectSse + resumeTimers)
        try {
            if (::webView.isInitialized) {
                webView.onPause()
                webView.pauseTimers()
            }
        } catch (_: Exception) {}
        // سشن OTP/لاگین — کوکی‌ها را فوراً روی دیسک flush کن (کرش/کشتن پروسه)
        try {
            CookieManager.getInstance().flush()
        } catch (_: Exception) {}
        super.onPause()
    }

    override fun onSaveInstanceState(outState: Bundle) {
        super.onSaveInstanceState(outState)
        webView.saveState(outState)
    }

    override fun onDestroy() {
        try { unregisterReceiver(otpReceiver) } catch (_: Exception) {}
        OtpRetriever.dispatcher = null
        connection?.disconnect()
        payment = null
        super.onDestroy()
    }

    companion object {
        /** کانال اعلان — برای NotificationSyncWorker هم لازم است (public const) */
        const val CHANNEL_ID = "fitup_general"
    }
}
