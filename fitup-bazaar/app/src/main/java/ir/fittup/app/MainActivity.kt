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
import android.net.ConnectivityManager
import android.net.NetworkCapabilities
import android.net.Uri
import android.os.Handler
import android.os.Looper
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
import android.widget.LinearLayout
import android.widget.TextView
import android.widget.Toast
import androidx.activity.result.ActivityResultLauncher
import androidx.activity.result.contract.ActivityResultContracts
import androidx.appcompat.app.AlertDialog
import androidx.appcompat.app.AppCompatActivity
import androidx.core.app.NotificationCompat
import androidx.core.content.ContextCompat
// v1.15.4 (v206) — پراکسی محلی WebView: DNS هرگز وارد کش WebView نمی‌شود (درمان ریشه‌ای FakeDNS VPNها)
import androidx.webkit.ProxyConfig
import androidx.webkit.ProxyController
import androidx.webkit.WebViewFeature
import com.google.android.gms.auth.api.phone.SmsRetriever
// v1.16.0 (v223) — FCM: راه‌اندازی دستی (بدون google-services.json) — اگر
// stringsهای fcm_* خالی باشند یا گوشی سرویس گوگل نداشته باشد، کاملاً بی‌صدا رد می‌شود
import com.google.firebase.FirebaseApp
import com.google.firebase.FirebaseOptions
import com.google.firebase.messaging.FirebaseMessaging
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

    // ─── v1.17.0 (v224) — «اسپلش برند جایگزین صفحهٔ خطا» (دیرکتیو مالک) ───
    /** حلقهٔ اتصال خودکار فعال؟ (جایگزین گری‌گیری از نمای خطای حذف‌شده) */
    private var reconnectActive = false

    // ─── 🩹 v1.9 — نگهبان صفحهٔ سفید (فیکس P0 «صفحه سفید ابدی») ───
    // گزارش مالک + کاربران: بعد از آپدیت سایت، اپ صفحهٔ سفید می‌شد و حتی با
    // بستن/بازکردن هم بالا نمی‌آمد. ریشه: HTMLِ کش‌شدهٔ WebView به چانک‌های JS
    // حذف‌شدهٔ بیلد قبلی اشاره می‌کرد → هیچ JSی اجرا نمی‌شد → سفید همیشه‌گی.
    // (سمت سایت حالا HTML همیشه no-store است؛ این نگهبان لایهٔ نهایی recovery است)
    private var blankCheckPending = false
    private var blankPageReloadUsed = false
    /** شمار ریکاوری «صفحهٔ خالی» — سقف ۳؛ بعدش دیگر اسپلش برنمی‌گردد */
    private var blankRecoveryCount = 0

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

    // ─── v1.15.3 (v205) — NetworkChangeMonitor: وفاق نیم‌ثانیه‌ای با اینترنت جدید ───
    private val netMonHandler = Handler(Looper.getMainLooper())
    private var netMonPending: Runnable? = null
    private var lastDefaultNetwork: android.net.Network? = null
    private var lastVpnPresent = false
    // v1.15.4 (v206) — شناسهٔ آخرین تغییر اعمال‌شده (برای شست‌وی پراکسی فقط هنگام تغییر واقعی)
    private var lastProxyFlushIdentity: String? = null

    @SuppressLint("SetJavaScriptEnabled")
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        binding = ir.fittup.app.databinding.ActivityMainBinding.inflate(layoutInflater)
        setContentView(binding.root)

        webView = binding.webView
        swipeRefresh = binding.swipeRefresh
        splash = binding.splash

        setupFileChooser()
        setupCameraCapture()
        // v1.15.4 (v206) — پراکسی محلی WebView (قبل از هر لود — DNS تازه در هر اتصال)
        setupLoopbackProxy()
        setupWebView()
        setupPayment()
        setupNotifications()
        setupOtpRetrieverReceiver()

        // v1.15.3 (v205) — نگهبان تغییر شبکه/VPN (وفاق نیم‌ثانیه‌ای) + گرم‌کردن مسیر شبکه
        registerNetworkMonitor()
        warmNetworkForColdStart()
        // ═══ v1.15.0/v1.17.0 — ویدیوی خوش‌آمد تمام‌صفحه (دیرکتیو مالک):
        // «کلاً اپ باید با ویدیو بیاد بالا؛ قبلش هیچی نباشه و بعدشم مستقیم پنل
        // کاربری بیاد بالا» + «ویدیو فقط وقتی کاربر برنامه را بسته بوده؛
        // اگر در پس‌زمینه در حال اجراست تکرار نشود» ═══
        //   • شروع سردِ پروسه → فقط ویدیوی تمام‌صفحه (بدون لوگو/زمینهٔ سفید)
        //   • پایان ویدیو → مستقیم داشبورد (onPageFinished هرگز ویدیو را قطع نمی‌کند)
        //   • برگشت از پس‌زمینه/چرخش صفحه → بدون ویدیو (اسپلش سبک قبلی)
        val introRes = if (savedInstanceState == null && !introPlayedThisProcess) introVideoResId() else 0
        pageReady = false
        introActive = introRes != 0
        if (introRes != 0) {
            introPlayedThisProcess = true
            // هیچ چیز قبل از ویدیو — محتوای اسپلش مخفی + زمینهٔ تیرهٔ هم‌رنگ قاب ویدیو
            try { splash.setBackgroundColor(getColor(R.color.intro_bg)) } catch (_: Throwable) {}
            setSplashContentVisible(false)
            startIntroVideo(introRes)
        }

        // 🩹 v1.15.3 (v205) — نگهبان اسپلش/صفحهٔ سفید: کاربر هرگز «سفیدِ بی‌صدا» نمی‌بیند.
        //   • تا اولین پینت واقعی صفحه (onPageCommitVisible) اسپلش برند دیده می‌شود.
        //   • اگر تا ۴۵ ثانیه هیچ پینتی نشد (DNS/TTFB گیر کرده) → صفحهٔ خطای فارسی
        //     با دکمهٔ «تلاش مجدد» — نه سفیدِ بی‌راه‌حل (قبلاً ۱۵ ثانیه بود و
        //     اسپلش را می‌بست و کاربر ۲۰-۳۵ ثانیه سفید نگاه می‌کرد).
        android.os.Handler(android.os.Looper.getMainLooper()).postDelayed({
            try {
                // v1.17.0 (v224 — دیرکتیو مالک) — واچ‌داگ دیگر اسپلش را نمی‌بندد و
                // هیچ صفحهٔ خطایی نشان نمی‌دهد: اسپلش برند می‌ماند و فقط حلقهٔ اتصال
                // خودکار تضمین می‌شود. صفحهٔ خطا از چرخهٔ حیات حذف شده است.
                if (this@MainActivity::splash.isInitialized && splash.visibility == View.VISIBLE && !pageReady) {
                    Log.w("FitUpApp", "splash watchdog fired (45s) — keep splash + auto-reconnect")
                    showError()
                }
            } catch (_: Exception) {}
        }, 45_000)

        // v31 — «اعلان‌ها حتی وقتی برنامه بسته است» (کم‌مصرف — WorkManager):
        // زمان‌بندی دوره‌ای ۶ ساعته + همگام‌سازی فوری در باز شدن اپ
        NotificationSync.schedulePeriodic(this)
        NotificationSync.syncNow(this)
        OtpRetriever.dispatcher = { code -> dispatchOtpCode(code) }

        // v1.16.0 (v223) — FCM push: رسیدن اعلان‌ها حتی وقتی اپ کلاً از گوشی بسته است.
        // اگر مقادیر fcm_* در strings.xml خالی باشند یا گوشی سرویس گوگل نداشته
        // باشد، کاملاً بی‌صدا رد می‌شود (graceful skip — اپ مثل قبل فقط با
        // WorkManager کار می‌کند)
        setupFcm()

        if (savedInstanceState != null) {
            webView.restoreState(savedInstanceState)
        } else {
            // v1.5.4 — شروع با لینک عمیق (App Link / fitup_link اعلان) اگر هست؛
            // 🩹 v1.10.0 — اولویت دوم: URL ذخیره‌شدهٔ نجات اتصال (بازگشت دقیق به
            // همان صفحه بعد از ری‌استارت تمیز پروسه در سناریوی تغییر IP)؛
            // وگرنه شروع مستقیم با OTP/پنل — ?screen=auth: اگر سشن هست → پنل، وگرنه صفحه ورود
            // ═══ v1.17.0 (v224) — ریشهٔ اصلی «اتصال برقرار نیست» در شروع سرد ═══
            // WebView قبل از اتصالِ کامل شبکه (دیتای موبایل/واای‌فای تازه بعد از بوتِ
            // پروسه) لود می‌زند → فریم اصلی شکست می‌خورد → قبلاً صفحهٔ خطا می‌آمد.
            // حالا: اگر شبکه فعال نیست، اولین لود تا وصل‌شدن (حداکثر ۶ ثانیه) عقب
            // می‌افتد — ویدیو/اسپلش همین حین نمایش داده می‌شود و در مسیر اصلی دیگر
            // هیچ لودِ شکست‌خورده‌ای وجود ندارد.
            val target = deepLinkUrl(intent) ?: consumeNetGuardRestartUrl() ?: startUrl()
            if (hasActiveNetwork()) {
                webView.loadUrl(target)
            } else {
                waitForNetworkThenLoad(target)
            }
        }

        // ⛔ چک نسخه حذف شد (ریجکشن بازار): اپ بازار هرگز هیچ پیام به‌روزرسانی
        // نشان نمی‌دهد — به‌روزرسانی فقط از طریق خود کافه‌بازار انجام می‌شود.
    }

    /** شروع با ?screen=auth — کاربر لاگین‌شده مستقیم پنل را می‌بیند (نیاز کلیک «ورود» نیست) */

    // ═══════════ v1.15.0/v1.17.0 — ویدیوی خوش‌آمد تمام‌صفحه (دیرکتیو مالک) ═══════════
    // قواعد مالک:
    //   ۱) تمام‌صفحهٔ واقعی — بدون نوار مشکی بالا/پایین: cover-scaling با ابعاد
    //      واقعی ویدیو؛ فایل ویدیو (۱۰۸۰×۲۴۰۰) حاشیهٔ امن نارنجی دارد، پس برشِ
    //      جزئی فقط پس‌زمینه است و لوگو هرگز بریده نمی‌شود
    //   ۲) هیچ چیز قبل از ویدیو — لوگو/برند/شعار/اسپینر اسپلش مخفی می‌شوند
    //   ۳) پخش کامل تا آخر — onPageFinished ویدیو را قطع نمی‌کند؛ داشبورد فقط
    //      بعد از پایان ویدیو بالا می‌آید (تپ = رد شدن دستی؛ خطا/واچ‌داگ = فیل‌سیف)
    //   ۴) فقط شروع سردِ پروسه — برگشت از پس‌زمینه ویدیو ندارد؛ خروج واقعی
    //      کاربر (isFinishing) فلگ را در onDestroy ریست می‌کند
    private val splashVideoHandler = Handler(Looper.getMainLooper())
    private var splashVideoHidden = false
    /** صفحهٔ وب بارگذاری کامل شده؟ (شرط بستن اسپلش بعد از ویدیو) */
    private var pageReady = false
    /** ویدیوی خوش‌آمد در جریان است؟ تا پایانش اسپلش/داشبورد بسته نمی‌شوند */
    private var introActive = false
    private var videoWatchdog: Runnable? = null

    private fun introVideoResId(): Int = try {
        resources.getIdentifier("logo_motion", "raw", packageName)
    } catch (_: Throwable) { 0 }

    /** محتوای اسپلش — پیش از ویدیو مخفی، بعد از آن برگردانده می‌شود */
    private fun setSplashContentVisible(visible: Boolean) {
        val v = if (visible) View.VISIBLE else View.INVISIBLE
        try { binding.splashLogo.visibility = v } catch (_: Throwable) {}
        try { binding.splashTitle.visibility = v } catch (_: Throwable) {}
        try { binding.splashSlogan.visibility = v } catch (_: Throwable) {}
        try { binding.splashSpinner.visibility = v } catch (_: Throwable) {}
    }

    private fun startIntroVideo(resId: Int) {
        val wrap = binding.splashVideoWrap
        val video = binding.splashVideo
        try {
            splashVideoHidden = false
            // v1.17.0 (v224 — دیرکتیو مالک: «اولین چیزی که کاربر می‌بینه باید شروع ویدیو باشه»)
            // پوسترِ عینِ فریم اول ویدیو از لحظهٔ صفر روی میز است — سطح VideoView تا
            // آماده‌شدن MediaPlayer مشکی است؛ پوستر آن را می‌پوشاند = صفر فریم مشکی.
            try { binding.splashVideoPoster.visibility = View.VISIBLE } catch (_: Throwable) {}
            wrap.visibility = View.VISIBLE
            applyIntroSystemBars()
            video.setVideoPath("android.resource://$packageName/$resId")
            video.setOnPreparedListener { mp ->
                try {
                    coverFillVideo(mp.videoWidth, mp.videoHeight)
                    video.start()
                    // v1.17.0 — برداشتن پوستر ۲۵۰ms پس از شروع پخش: اولین فریم‌های
                    // واقعی ویدیو (پیکسل‌به‌پیکسل عین پوستر) از زیرش رد می‌شوند — گذر نامرئی
                    cancelPosterHide()
                    val ph = Runnable { try { binding.splashVideoPoster.visibility = View.GONE } catch (_: Throwable) {} }
                    posterHideRunnable = ph
                    splashVideoHandler.postDelayed(ph, 250)
                    // واچ‌داگ متناسب با طول واقعی ویدیو (+۵ ثانیه حاشیه) — هرگز گیر نمی‌کند
                    val dur = try { mp.duration.toLong().coerceAtLeast(3000) } catch (_: Throwable) { 4000L }
                    scheduleVideoWatchdog(dur + 5_000)
                } catch (t: Throwable) {
                    Log.w("FitUp", "intro prepared failed: ${t.message}")
                    hideSplashVideo()
                }
            }
            video.setOnCompletionListener { hideSplashVideo() }
            video.setOnErrorListener { _, _, _ ->
                hideSplashVideo()
                true
            }
            // تپ = رد شدن (اختیاری برای کاربر عجول — پایان ویدیو = مستقیم داشبورد)
            video.setOnClickListener { hideSplashVideo() }
        } catch (t: Throwable) {
            Log.w("FitUp", "intro video failed: ${t.message}")
            hideSplashVideo()
        }
    }

    /** تمام‌صفحهٔ واقعی: مقیاس cover — کل قاب پر می‌شود (فقط پس‌زمینهٔ ویدیو کمی بریده می‌شود) */
    private fun coverFillVideo(vw: Int, vh: Int) {
        try {
            val video = binding.splashVideo
            val dm = resources.displayMetrics
            val root = binding.root
            val screenW = maxOf(root.width, dm.widthPixels)
            val screenH = maxOf(root.height, dm.heightPixels)
            if (screenW <= 0 || screenH <= 0) return
            val lp = video.layoutParams as android.widget.FrameLayout.LayoutParams
            if (vw <= 0 || vh <= 0) {
                // ابعاد نامشخص — فیت عرضی (فایل حاشیهٔ امن دارد)
                lp.width = screenW
                lp.height = (screenW * 2400f / 1080f).toInt()
            } else {
                val scale = maxOf(screenW.toFloat() / vw, screenH.toFloat() / vh)
                lp.width = (vw * scale).toInt().coerceAtLeast(screenW)
                lp.height = (vh * scale).toInt().coerceAtLeast(screenH)
            }
            video.layoutParams = lp
        } catch (_: Throwable) {}
    }

    /** پوستر فریم اول — بردارندهٔ تأخیری پس از شروع پخش (لغو صریح در hideSplashVideo) */
    private var posterHideRunnable: Runnable? = null

    private fun cancelPosterHide() {
        try { posterHideRunnable?.let { splashVideoHandler.removeCallbacks(it) } } catch (_: Throwable) {}
        posterHideRunnable = null
    }

    private fun scheduleVideoWatchdog(ms: Long) {
        cancelVideoWatchdog()
        val r = Runnable {
            if (binding.splashVideo.visibility == View.VISIBLE) {
                Log.w("FitUp", "intro video watchdog fired (${ms}ms)")
                hideSplashVideo()
            }
        }
        videoWatchdog = r
        splashVideoHandler.postDelayed(r, ms)
    }

    private fun cancelVideoWatchdog() {
        try { videoWatchdog?.let { splashVideoHandler.removeCallbacks(it) } } catch (_: Throwable) {}
        videoWatchdog = null
    }

    /** هنگام ویدیو: نوار وضعیت/ناوبری هم‌رنگ پس‌زمینهٔ نارنجی ویدیو — تمام‌صفحهٔ یکدست */
    private fun applyIntroSystemBars() {
        try {
            val orange = getColor(R.color.intro_orange)
            window.statusBarColor = orange
            @Suppress("DEPRECATION")
            window.navigationBarColor = orange
            if (Build.VERSION.SDK_INT >= 23) {
                val d = window.decorView
                var f = d.systemUiVisibility
                f = f and View.SYSTEM_UI_FLAG_LIGHT_STATUS_BAR.inv()
                d.systemUiVisibility = f
            }
        } catch (_: Throwable) {}
    }

    /** بعد از ویدیو: برگرداندن نوارهای روشن (مطابق تم وب‌سایت) */
    private fun restoreSystemBarsAfterIntro() {
        try {
            val white = getColor(R.color.white)
            window.statusBarColor = white
            @Suppress("DEPRECATION")
            window.navigationBarColor = white
            if (Build.VERSION.SDK_INT >= 23) {
                val d = window.decorView
                var f = d.systemUiVisibility
                f = f or View.SYSTEM_UI_FLAG_LIGHT_STATUS_BAR
                d.systemUiVisibility = f
            }
        } catch (_: Throwable) {}
    }

    private fun hideSplashVideo() {
        if (splashVideoHidden) return
        splashVideoHidden = true
        cancelVideoWatchdog()
        introActive = false
        try {
            val video = binding.splashVideo
            try { video.pause() } catch (_: Throwable) {}
            try { video.stopPlayback() } catch (_: Throwable) {}
            // v1.15.1 — فیکس باگ صدا (همسان با fitup-app): ویدیو از درخت نما جدا
            // می‌شود تا هیچ پیاده‌سازیِ OEM از VideoView حتی نتواند صدا/تصویر را
            // دوباره بالا بیاورد — نمای جدا شده هرگز surface نمی‌گیرد.
            try { (video.parent as? ViewGroup)?.removeView(video) } catch (_: Throwable) {}
            cancelPosterHide()
            try { binding.splashVideoPoster.visibility = View.GONE } catch (_: Throwable) {}
            binding.splashVideoWrap.visibility = View.GONE
        } catch (_: Throwable) {}
        restoreSystemBarsAfterIntro()
        // محتوای اسپلش برمی‌گردد (اگر صفحه هنوز آماده نیست، اسپلش خالیِ تیره نمی‌ماند)
        setSplashContentVisible(true)
        // زمینهٔ اسپلش به حالت روشن برمی‌گردد (متن تیرهٔ برند روی زمینهٔ تیره نماند)
        try { splash.setBackgroundColor(getColor(R.color.splash_bg)) } catch (_: Throwable) {}
        // پایان ویدیو → اگر صفحه هم آماده است، مستقیم داشبورد
        maybeCloseSplash()
    }

    /** بستن اسپلش فقط وقتی هم ویدیو تمام شده هم صفحه آماده است */
    private fun maybeCloseSplash() {
        if (introActive) return
        if (!pageReady) return
        closeSplashNow()
    }

    private fun closeSplashNow() {
        if (this@MainActivity::splash.isInitialized && splash.visibility != View.GONE) {
            splash.visibility = View.GONE
            if (pageReady) scheduleBlankPageCheck()
        }
    }
    // ═══════════ پایان ویدیوی خوش‌آمد تمام‌صفحه ═══════════


    // ═══════════ v1.13.0 — دارایی آفلاین بذر (فونت‌ها + چالش‌ها) ═══════════
    /** پیشوندهای مسیری که نسخهٔ داخل APK برایشان سرو می‌شود */
    // v1.17.0 — + چانک‌های JS/CSS سایت (_next/static) از داخل APK — جابجایی نرم و بدون شبکه؛
    // ویدیوها هرگز بذر نمی‌شوند (استریم و زنده‌بودن محتوا حفظ می‌شود)
    // v1.17.1 — + splash/ و فایل‌های ریشهٔ برند (favicon/مانیفست/آیکون/hero) که در
    // هر شروع سرد درخواست می‌شوند — صفر رفت‌وبرگشت شبکه در بالا آمدن اولیه (همسان fitup-app)
    private val SEED_PREFIXES = arrayOf("_next/static/", "animations/", "images/", "fonts/", "splash/")
    private val SEED_ROOT_FILES = setOf(
        "manifest.json",
        "favicon.png", "favicon-16.png", "favicon-32.png",
        "apple-touch-icon.png",
        "fitup-logo.png", "fitup-logo-64.png",
        "icon-512.png", "icon-512-maskable.png",
        "hero-fitup.png", "hero-fitup.webp",
        "hero-fitup-mobile.webp", "hero-fitup-desktop.webp",
        "hero-fitup-680.webp", "hero-fitup-splash.png",
    )

    private fun seedMime(path: String): String = when {
        path.endsWith(".webp") -> "image/webp"
        path.endsWith(".png") -> "image/png"
        path.endsWith(".jpg") || path.endsWith(".jpeg") -> "image/jpeg"
        path.endsWith(".svg") -> "image/svg+xml"
        path.endsWith(".woff2") -> "font/woff2"
        path.endsWith(".woff") -> "font/woff"
        path.endsWith(".ttf") -> "font/ttf"
        path.endsWith(".css") -> "text/css"
        path.endsWith(".js") -> "application/javascript"
        else -> "application/octet-stream"
    }

    /**
     * اگر درخواست متعلق به دامنهٔ فیتاپ و مسیرش در «بذرِ» داخل APK باشد، همان
     * فایل محلی سرو می‌شود (با کش یک‌هفته‌ای)؛ در غیر این صورت null → شبکه.
     * نبود فایل در بذر = null = رفتار کاملاً عادی (محتوای جدید بدون آپدیت اپ).
     */
    private fun serveSeedAsset(uri: android.net.Uri): WebResourceResponse? {
        return try {
            val host = uri.host?.lowercase() ?: return null
            if (host != "fittup.ir" && !host.endsWith(".fittup.ir")) return null
            val path = uri.path?.trimStart('/') ?: return null
            if (SEED_PREFIXES.none { path.startsWith(it) } && path !in SEED_ROOT_FILES) return null
            // v1.17.0 — aapt/AGP مسیرهای زیرخط‌دار (_next) را از snapshot ورودی حذف می‌کند؛
            // روی دیسک همان فایل‌ها زیر پوشهٔ nx/ ذخیره شده‌اند (URL سمت وب دست‌نخورده)
            val assetPath = if (path.startsWith("_next/")) "nx/" + path.removePrefix("_next/") else path
            val stream = assets.open("seed/$assetPath")
            val resp = WebResourceResponse(seedMime(path), null, stream)
            resp.responseHeaders = mapOf(
                "Access-Control-Allow-Origin" to "*",
                "Cache-Control" to "public, max-age=604800"
            )
            resp
        } catch (_: Throwable) {
            null // فایل در بذر نیست → شبکه عادی
        }
    }
    // ═══════════ پایان دارایی آفلاین بذر ═══════════

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
                // v1.17.0 — پایان بارگذاری ≠ بستن ویدیو؛ داشبورد فقط بعد از پایان
                // کامل ویدیوی خوش‌آمد بالا می‌آید (دیرکتیو مالک)؛ در مسیر بدون ویدیو
                // مثل قبل اسپلش همین‌جا بسته می‌شود.
                pageReady = true
                swipeRefresh.isRefreshing = false
                injectBridgeHelper()
                maybeCloseSplash()
                // بازیابی خریدهای consume-نشده — بعد از هر بارگذاری کامل صفحه
                maybeRestorePurchases()
                // 🩹 v1.9 — نگهبان صفحهٔ سفید: اگر صفحه بعد از لود عملاً خالی باشد
                // (JS مرده — چانک‌های بیلد قبلی بعد از آپدیت سایت)، خودکار پاک‌سازی
                // کش + تلاش مجدد انجام می‌شود؛ کاربر هرگز در سفیدِ بی‌صدا گیر نمی‌کند.
                scheduleBlankPageCheck()
            }

            /** v1.15.3 (v205) — اولین پینت واقعی = آماده (خیلی زودتر از onPageFinished)؛
             *  اسپلش همین‌جا بسته می‌شود — کاربر هرگز بین اسپلش و محتوا «سفید» نمی‌بیند. */
            override fun onPageCommitVisible(view: WebView, url: String) {
                super.onPageCommitVisible(view, url)
                pageReady = true
                maybeCloseSplash()
            }

            // v1.13.0 — دارایی‌های آفلاین «بذر»: فونت‌ها + انیمیشن/کاورهای چالش از داخل APK
            // (کش هوشمند — اگر فایل در APK نبود، همان مسیر از شبکه لود می‌شود؛
            //  پس محتوا همیشه به‌روز و استریم ویدیو دست‌نخورده — فقط سریع‌تر و آفلاین هم کار می‌کند)
            override fun shouldInterceptRequest(
                view: WebView,
                request: WebResourceRequest
            ): WebResourceResponse? = serveSeedAsset(request.url)

                        /** خطای بارگذاری فریم اصلی → صفحه خطای فارسی با دکمه تلاش مجدد */
            override fun onReceivedError(
                view: WebView,
                request: WebResourceRequest,
                error: WebResourceError
            ) {
                super.onReceivedError(view, request, error)
                if (request.isForMainFrame) showError()
            }

            // ═══ v1.17.1 (v225 — ریشهٔ نهایی «اتصال برقرار نیست» مالک) ═══
            // فال‌بک آفلاینِ سرویس‌ورکر با وضعیت ۵۰۳ برمی‌گردد — این «خطای شبکه»
            // نیست، پس onReceivedError آن را نمی‌بیند؛ قبلاً onPageCommitVisible
            // صفحه را «آماده» تلقی می‌کرد و بعد از پایان ویدیو، صفحهٔ خطای لایهٔ
            // وب (اتصال برقرار نیست / فیتاپ به اینترنت نیاز دارد) دیده می‌شد.
            // حالا هر پاسخ ۵xx برای فریم اصلی = «این صفحهٔ واقعی نیست» →
            // اسپلش برند می‌ماند/برمی‌گردد + حلقهٔ اتصال خودکار تا لود موفق.
            // کاربر فقط: ویدیو → اسپلش → داشبورد. (۴xx مثل ۴۰۴ واقعی رد
            // می‌شود تا صفحه‌های معتبر نادرست «خطا» تلقی نشوند.)
            override fun onReceivedHttpError(
                view: WebView,
                request: WebResourceRequest,
                errorResponse: WebResourceResponse
            ) {
                super.onReceivedHttpError(view, request, errorResponse)
                if (request.isForMainFrame) {
                    try {
                        if (errorResponse.statusCode in 500..599) showError()
                    } catch (_: Throwable) {}
                }
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
     * «تلاش مجدد» برای کاربر می‌مانند.
     * (v205 — این سیاست با NetworkChangeMonitorِ پایین «کامل» شد: هیچ رفرش/باز
     *  و بسته‌ای وجود ندارد، فقط قفل DNS/سوکت‌های آیندهٔ پروسه به شبکهٔ سالم +
     *  خبر فوری به موتور خودترمیمی وب — وفاق نیم‌ثانیه‌ای بی‌صدا.) ─── */

    /* ─── v1.15.3 (v205) — NetworkChangeMonitor: وفاق نیم‌ثانیه‌ای با اینترنت جدید ───
     *
     * ریشهٔ باگ ده‌بارهٔ «خاموش‌کردن VPN → اپ کلاً قطع می‌شد»: بعد از سوییچ،
     * استک شبکهٔ Chromium داخل WebView (سوکت‌های keep-alive مرده + پیکربندی
     * DNS دوران تونل) مسموم می‌ماند؛ WebView جاسازی‌شده روی بعضی دستگاه‌ها/
     * فیلترشکن‌ها سیگنال تغییر شبکه را از دست می‌دهد → هر درخواست تازه روی
     * سوکت/DNS مرده گیر می‌کند تا ری‌استارت اپ. مرورگر درون اینستاگرام هم
     * دقیقاً همین ضعف را دارد (گزارش مالک).
     *
     * درمان استاندارد اپ‌های بزرگ (مستند رسمی ConnectivityManager):
     *  ۱) NetworkCallback (تاخیر واقعی ~۵۰-۲۰۰ms) — تغییر شبکه/VPN خیلی قبل
     *     از اولین fetch شکست‌خورده فهمیده می‌شود.
     *  ۲) bindProcessToNetwork(شبکهٔ سالم): «همهٔ سوکت‌های آینده و همهٔ
     *     resolveهای DNS پروسه» به شبکهٔ سالم قفل می‌شوند؛ استک شبکهٔ WebView
     *     داخل همین پروسه است → اولین اتصال بعد از سوییچ با DNS/مسیر درست
     *     ساخته می‌شود. هیچ reload/بازوبستنی در کار نیست — صفحه و مدال‌ها
     *     دست‌نخورده (سیاست v1.8 حفظ و کامل شد).
     *  ۳) خبر فوری به وب (window.__fitupNativeNetworkChanged) → موتور خودترمیمی
     *     همان لحظه زامبی‌ها را آزاد و پروب بازیابی را روشن می‌کند؛ موفقیت →
     *     رویداد fitup:connection-restored → تازه‌سازی درجای داده‌ها.
     *  (آخرین حلقهٔ زنجیره — فقط قطعی ممتد ≥۶۰ ثانیه — پل netRescue است که
     *   وب با راستی‌آزمایی استکِ مستقل جاوا صدا می‌زند؛ همان ماشین فعلی.)
     */

    /** آیا VPN فعال است؟ (کال‌بک‌های TRANSPORT_VPN — بدون هیچ مجوزی) */
    private fun isVpnActive(): Boolean {
        return try {
            val cm = getSystemService(Context.CONNECTIVITY_SERVICE) as? ConnectivityManager
                ?: return false
            for (network in cm.allNetworks) {
                val caps = cm.getNetworkCapabilities(network) ?: continue
                if (caps.hasTransport(NetworkCapabilities.TRANSPORT_VPN)) return true
            }
            false
        } catch (_: Exception) {
            false
        }
    }

    /**
     * v1.15.4 (v206) — پراکسی محلی WebView (درمان ریشه‌ای سناریوی FakeDNS):
     *
     * درس v205 (گزارش مالک: فقط خاموش‌کردن FakeDNS پت‌نگ درستش کرد): bindProcessToNetwork
     * فقط سوکت/resolveهای «آینده» را قفل می‌کند ولی IPهای فیک (۱۹۸.۱۸.x.x) که حین VPN
     * در HostCache خصوصی WebView نشسته‌اند، بعد از خاموشی به بلک‌هول می‌روند و کشِ
     * WebView با هیچ API اندرویدی پاک‌شدنی نیست.
     *
     * درمان: همهٔ ترافیک WebView از پراکسی داخلی (۱۲۷.۰.۰.۱) رد می‌شود — WebView هرگز
     * خودش DNS حل نمی‌کند (کش مسموم از معادله خارج می‌شود) و با هر VPNی — حتی با
     * FakeDNS روشن — اپ در ۱-۲ ثانیه برمی‌گردد. هیچ تغییر ظاهری/رفتاری کاربری ندارد.
     *
     * ضد خرابی: WebView قدیمی (بدون PROXY_OVERRIDE) یا خطای راه‌اندازی → override ست
     * نمی‌شود و رفتار v205 دست‌نخورده می‌ماند (همان وفاق نیم‌ثانیه‌ای قبلی).
     */
    private fun setupLoopbackProxy() {
        try {
            if (!WebViewFeature.isFeatureSupported(WebViewFeature.PROXY_OVERRIDE)) {
                Log.i("FitUpApp", "lproxy: PROXY_OVERRIDE unsupported — v205 path stays as is")
                return
            }
            val proxy = LoopbackProxy.get()
            if (!proxy.isRunning) {
                proxy.networkProvider = {
                    lastDefaultNetwork ?: try {
                        (getSystemService(Context.CONNECTIVITY_SERVICE) as? ConnectivityManager)?.activeNetwork
                    } catch (_: Exception) {
                        null
                    }
                }
                proxy.vpnActiveProvider = { lastVpnPresent }
                if (!proxy.start()) return
            }
            val config = ProxyConfig.Builder()
                .addProxyRule("127.0.0.1:${proxy.port}")
                // هیچ‌وقت مسیر لوکال از پراکسی رد نشود (لوپ‌نشدن + سرعت لوکال)
                .addBypassRule("localhost")
                .addBypassRule("127.0.0.1")
                .addBypassRule("[::1]")
                .build()
            ProxyController.getInstance().setProxyOverride(
                config,
                // اجرا مستقیم در ترد فراخوان — کال‌بک فقط لاگ است
                java.util.concurrent.Executor { it.run() }
            ) {
                Log.i("FitUpApp", "lproxy: WebView proxy override active (127.0.0.1:${proxy.port})")
            }
        } catch (e: Throwable) {
            Log.w("FitUpApp", "lproxy: setup failed (v205 path stays): ${e.message}")
        }
    }

    /** ثبت کال‌بک‌های شبکه (یک‌بار در onCreate) — بدون هیچ مجوز جدید */
    private fun registerNetworkMonitor() {
        val cm = getSystemService(Context.CONNECTIVITY_SERVICE) as? ConnectivityManager ?: return
        lastVpnPresent = isVpnActive()
        // ۱) شبکهٔ پیش‌فرضِ سیستم (API 24 = minSdk) — نکتهٔ مستند: خروجی این
        //    کال‌بک پیش‌فرضِ سیستم است نه قفلِ پروسه؛ پس مستقیم برای bind امن است.
        try {
            cm.registerDefaultNetworkCallback(object : ConnectivityManager.NetworkCallback() {
                override fun onAvailable(network: android.net.Network) {
                    lastDefaultNetwork = network
                    scheduleNetworkApply("default-available")
                }

                override fun onCapabilitiesChanged(network: android.net.Network, caps: NetworkCapabilities) {
                    if (network == lastDefaultNetwork) scheduleNetworkApply("default-caps")
                }

                override fun onLost(network: android.net.Network) {
                    if (network == lastDefaultNetwork) {
                        lastDefaultNetwork = null
                        scheduleNetworkApply("default-lost")
                    }
                }

                override fun onBlockedStatusChanged(network: android.net.Network, blocked: Boolean) {
                    if (network == lastDefaultNetwork) {
                        scheduleNetworkApply(if (blocked) "default-blocked" else "default-unblocked")
                    }
                }
            })
        } catch (e: Exception) {
            Log.w("FitUpApp", "netmon: default callback failed: ${e.message}")
        }
        // ۲) رویداد اختصاصی VPN (روشن/خاموش شدن فیلترشکن) — دقیق‌ترین سیگنال سوییچ
        try {
            val vpnRequest = android.net.NetworkRequest.Builder()
                .addTransportType(NetworkCapabilities.TRANSPORT_VPN)
                .build()
            cm.registerNetworkCallback(vpnRequest, object : ConnectivityManager.NetworkCallback() {
                override fun onAvailable(network: android.net.Network) {
                    lastVpnPresent = true
                    scheduleNetworkApply("vpn-on")
                }

                override fun onLost(network: android.net.Network) {
                    lastVpnPresent = false
                    scheduleNetworkApply("vpn-off")
                }
            })
        } catch (e: Exception) {
            Log.w("FitUpApp", "netmon: vpn callback failed: ${e.message}")
        }
    }

    /** دی‌بانس ۳۰۰ms — فصلِ کال‌بک‌های متوالی فقط یک‌بار اعمال شود (مجموع <۰.۵ ثانیه) */
    private fun scheduleNetworkApply(reason: String) {
        runOnUiThread {
            try {
                netMonPending?.let { netMonHandler.removeCallbacks(it) }
                val r = Runnable { applyNetworkChange(reason) }
                netMonPending = r
                netMonHandler.postDelayed(r, 300)
            } catch (_: Exception) {}
        }
    }

    /** قفل پروسه به شبکهٔ سالم + خبر فوری به وب — قلبِ وفاق نیم‌ثانیه‌ای */
    private fun applyNetworkChange(reason: String) {
        val cm = getSystemService(Context.CONNECTIVITY_SERVICE) as? ConnectivityManager
        var hasNetwork = false
        var boundOk = false
        if (cm != null) {
            val target = lastDefaultNetwork ?: cm.activeNetwork
            val caps = try { target?.let { cm.getNetworkCapabilities(it) } } catch (_: Exception) { null }
            hasNetwork = target != null && caps?.hasCapability(NetworkCapabilities.NET_CAPABILITY_INTERNET) == true
            // بدون شبکهٔ معتبر → قفل پاک شود (null) تا مدیریت به سیستم برگردد
            boundOk = try {
                cm.bindProcessToNetwork(if (hasNetwork) target else null)
            } catch (e: Exception) {
                Log.w("FitUpApp", "netmon: bindProcessToNetwork failed: ${e.message}")
                false
            }
        }
        Log.i("FitUpApp", "netmon: reason=$reason vpn=$lastVpnPresent hasNetwork=$hasNetwork bound=$boundOk")
        // ─── v1.15.4 (v206) — شست‌وی سوکت‌های بالادستی پراکسی محلی ───
        // فقط وقتی «هویت» شبکه/VPN واقعاً عوض شده (کال‌بک‌های پرتکرار caps
        // نباید SSE/H2 سالم را قربانی کنند). مرگ فوری میلی‌ثانیه‌ای به‌جای
        // هنگ روی تونل مرده → اتصال بعدی با DNS تازه روی شبکهٔ سالم.
        val flushIdentity = try {
            val net = lastDefaultNetwork ?: cm?.activeNetwork
            "${net?.networkHandle ?: "none"}|vpn=$lastVpnPresent|has=$hasNetwork"
        } catch (_: Exception) {
            null
        }
        if (flushIdentity != null && flushIdentity != lastProxyFlushIdentity) {
            lastProxyFlushIdentity = flushIdentity
            LoopbackProxy.get().onNetworkChanged()
        }
        dispatchNativeNetworkChanged(reason, hasNetwork)
    }

    /** خبر «شبکه عوض شد» به موتور خودترمیمی وب (زامبی‌آزاری + پروب فوری) */
    private fun dispatchNativeNetworkChanged(reason: String, hasNetwork: Boolean) {
        if (!this::webView.isInitialized) return
        try {
            val payload = "{\"reason\":\"$reason\",\"vpn\":$lastVpnPresent,\"hasNetwork\":$hasNetwork,\"ts\":${System.currentTimeMillis()}}"
            webView.evaluateJavascript(
                "(function(){try{if(window.__fitupNativeNetworkChanged){window.__fitupNativeNetworkChanged($payload);}}catch(e){}})()",
                null
            )
        } catch (e: Exception) {
            Log.w("FitUpApp", "netmon: js dispatch failed: ${e.message}")
        }
    }

    /**
     * v1.15.3 (v205) — گرم‌کردن مسیر شبکه در شروع سرد (کاهش اسپلش/سفید طولانی):
     * یک درخواست سبک با استک جاوا (DNS در سطح netd کش می‌شود — مشترک با WebView؛
     * مسیر تونل VPN هم گرم می‌شود) در پس‌زمینه، هم‌زمان با ویدیو/اسپلش.
     */
    private fun warmNetworkForColdStart() {
        Thread {
            try {
                val ok = freshProbe(BuildConfig.SITE_URL.trimEnd('/') + "/favicon.png")
                Log.i("FitUpApp", "cold-start network warmup: $ok")
            } catch (_: Throwable) {
            }
        }.start()
    }

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
            // ═══ v1.17.0 (v224 — دیرکتیو مالک: «به جای این صفحه همون اسپلش خود اپ‌ها رو
            // بذار» + «این مدال الکی داره نشون داده میشه») ═══
            // دیگر هیچ نمای خطا/در حال اتصالی وجود ندارد (از XML هم حذف شد). showError یعنی:
            //   ① اسپلش برند فیتاپ (لوگو + «فیتاپ» + شعار + اسپینر) روی میز می‌ماند/برمی‌گردد
            //   ② حلقهٔ اتصال خودکار (پروب مستقل جاوا) تا پینت واقعی صفحه تلاش می‌کند
            //   ③ وقتی صفحه پینت شد (onPageCommitVisible) اسپلش خودش می‌رود — داشبورد
            // کاربر هرگز «اتصال برقرار نیست» نمی‌بیند؛ فقط اسپلش خود اپ را می‌بیند.
            reconnectActive = true
            pageReady = false
            swipeRefresh.isRefreshing = false
            if (!introActive && this@MainActivity::splash.isInitialized && splash.visibility != View.VISIBLE) {
                try {
                    splash.setBackgroundColor(getColor(R.color.splash_bg))
                    setSplashContentVisible(true)
                    splash.visibility = View.VISIBLE
                } catch (_: Throwable) {}
            }
            beginAutoReconnect()
        }
    }

    private fun hideError() {
        runOnUiThread {
            // v1.17.0 — نمای خطا حذف شده؛ فقط حلقهٔ اتصال متوقف می‌شود (صفحه شروع به لود کرده)
            cancelAutoReconnect()
        }
    }

    // ─── v1.17.0 (v224) — شروع سرد روی شبکهٔ هنوز-وصل‌نشده ───
    /** آیا پروسه همین حالا شبکهٔ اینترنت‌دار دارد؟ (ConnectivityManager — استک اندروید) */
    private fun hasActiveNetwork(): Boolean {
        return try {
            val cm = getSystemService(Context.CONNECTIVITY_SERVICE) as ConnectivityManager
            val n = cm.activeNetwork ?: return false
            val caps = cm.getNetworkCapabilities(n) ?: return false
            caps.hasCapability(NetworkCapabilities.NET_CAPABILITY_INTERNET)
        } catch (_: Throwable) {
            false
        }
    }

    private var coldLoadPoll: Runnable? = null
    private val coldLoadHandler = Handler(Looper.getMainLooper())

    /** تا وصل‌شدن شبکه صبر می‌کند (پولینگ ۳۰۰ms، سقف ۶ ثانیه — فیل‌سیف) بعد لود می‌زند */
    private fun waitForNetworkThenLoad(target: String) {
        var waited = 0L
        val poll = object : Runnable {
            override fun run() {
                coldLoadPoll = null
                if (isFinishing || isDestroyed) return
                if (hasActiveNetwork() || waited >= 6_000L) {
                    try { webView.loadUrl(target) } catch (_: Throwable) {}
                    return
                }
                waited += 300L
                coldLoadPoll = this
                coldLoadHandler.postDelayed(this, 300L)
            }
        }
        coldLoadPoll = poll
        coldLoadHandler.postDelayed(poll, 300L)
    }

    /* ───────────── v222 — اتصال خودکار بدون صفحهٔ خطا ─────────────
     * سناریوی مالک: اپ ۱-۲ ساعت در پس‌زمینه → برگشت → «اتصال برقرار نیست» +
     * دکمهٔ تلاش مجدد. ریشه: سوکت‌های WebView بعد از خواب طولانی/تعویض شبکه
     * مرده‌اند؛ اولین ناوبری شکست می‌خورد و قبلاً صفحهٔ خطا می‌آمد.
     * حالا: هر خطای بارگذاری اصلی → نمای «در حال اتصال…» + پروب مستقل جاوا
     * (freshProbe — استک جدا از Chromium) با بک‌آف ۱٫۵s→۴s بی‌نهایت؛
     * سالم بود مسیر → reload خودکار همان صفحه (onPageStarted → hideError).
     * صفر تعامل کاربر؛ صفحهٔ خطا دیگر وجود خارجی ندارد. */
    private var autoReconnectAttempts = 0
    private var autoReconnectRunnable: Runnable? = null
    private val autoReconnectInFlight = java.util.concurrent.atomic.AtomicBoolean(false)
    private val autoReconnectHandler = android.os.Handler(android.os.Looper.getMainLooper())

    private fun cancelAutoReconnect() {
        autoReconnectRunnable?.let { autoReconnectHandler.removeCallbacks(it) }
        autoReconnectRunnable = null
        autoReconnectInFlight.set(false)
        reconnectActive = false
    }

    private fun beginAutoReconnect() {
        if (!::webView.isInitialized) return
        autoReconnectAttempts = 0
        scheduleAutoReconnectAttempt(300L)
    }

    private fun scheduleAutoReconnectAttempt(delayMs: Long) {
        if (!::webView.isInitialized) return
        autoReconnectRunnable?.let { autoReconnectHandler.removeCallbacks(it) }
        val r = Runnable {
            autoReconnectRunnable = null
            if (!reconnectActive) return@Runnable
            if (!autoReconnectInFlight.compareAndSet(false, true)) return@Runnable
            Thread {
                val ok = try {
                    freshProbe(BuildConfig.SITE_URL.trimEnd('/') + "/favicon.png?hc=" + System.currentTimeMillis())
                } catch (_: Exception) { false }
                autoReconnectInFlight.set(false)
                runOnUiThread {
                    if (!reconnectActive) return@runOnUiThread
                    if (ok) {
                        // مسیر واقعی سالم است → بارگذاری مجدد؛ onPageStarted خودش
                        // نمای اتصال را می‌بندد. اگر باز هم شکست خورد، onReceivedError
                        // دوباره showError → حلقه ادامه می‌یابد.
                        try { webView.reload() } catch (_: Exception) {}
                    } else {
                        autoReconnectAttempts++
                        scheduleAutoReconnectAttempt(if (autoReconnectAttempts < 3) 1_500L else 4_000L)
                    }
                }
            }.start()
        }
        autoReconnectRunnable = r
        autoReconnectHandler.postDelayed(r, delayMs)
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
                            } else if (blankRecoveryCount < 3) {
                                // v1.17.0 — به‌جای صفحهٔ خطا: اسپلش برند + حلقهٔ اتصال خودکار
                                // (سقف ۳ دور تا چرخهٔ بی‌پایان نشود؛ بعدش صفحه رها می‌شود)
                                blankRecoveryCount++
                                showError()
                            }
                        } else {
                            blankRecoveryCount = 0
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
              // ─── v1.15.6 (v211) — قیمت واقعی SKU از خودِ بازار ───
              // سایت با fitupBazaarSkuPrice(sku) پرامیس می‌گیرد: {ok, sku, price, title, error}
              // «price» دقیقاً همان رشتهٔ نمایشی است که پنجرهٔ پرداخت بازار نشان می‌دهد
              // → مبلغ مودال سایت = مبلغ واقعی درگاه (دیرکتیو مالک) + مبنای سقف
              // واقعی پیشخان برای JWT تخفیف پویا (ضد خطای «اطلاعات ارسالی نامعتبر»).
              window.__bazaarSkuResult = window.__bazaarPaymentResult;
              window.fitupBazaarSkuPrice = function(sku) {
                return new Promise(function(resolve) {
                  var id = 'sk' + Date.now() + Math.floor(Math.random() * 1000);
                  window.__bazaarPending[id] = resolve;
                  var done = false;
                  var finish = function(r) { if (!done) { done = true; delete window.__bazaarPending[id]; resolve(r); } };
                  window.__bazaarPending[id] = finish;
                  try {
                    window.FitUpNative.getSkuDetails(String(sku), id);
                  } catch (e) {
                    finish({ ok: false, error: String(e) });
                    return;
                  }
                  setTimeout(function() { finish({ ok: false, error: 'timeout' }); }, 8000);
                });
              };
              // ─── v1.15.6 (v211) — نسخهٔ کافه‌بازار نصب‌شده (گیت تخفیف پویا ۱۳.۳.۰+) ───
              window.fitupBazaarVersion = function() {
                try { return String(window.FitUpNative.getBazaarVersion() || ''); }
                catch (e) { return ''; }
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

    /** v1.15.6 (v211) — پاسخ نتیجهٔ getSkuDetails به وب (همان نقشهٔ pending پرداخت) */
    private fun respondSkuResult(callbackId: String, json: JSONObject) {
        runOnUiThread {
            webView.evaluateJavascript(
                "window.__bazaarSkuResult && window.__bazaarSkuResult('$callbackId', $json);",
                null
            )
        }
    }

    /**
     * v1.15.6 (v211) — خواندن قیمت نمایشی SKU از خودِ بازار (Poolakey
     * getInAppSkuDetails). فقط خواندنی — هیچ اثری روی جریان خرید ندارد.
     * «price» همان رشته‌ای است که پنجرهٔ پرداخت بازار نشان می‌دهد
     * (مثلاً «۳۵۰٬۰۰۰ تومان») — سایت آن را در مودال نمایش می‌دهد تا مبلغ
     * مودال = مبلغ واقعی درگاه، و سرور سقف واقعی پیشخان را برای JWT تخفیف
     * پویا به‌دست می‌آورد.
     */
    private fun fetchBazaarSkuDetails(sku: String, callbackId: String) {
        val safeSku = sku.trim().take(128)
        if (safeSku.isEmpty()) {
            respondSkuResult(callbackId, JSONObject().put("ok", false).put("error", "شناسه محصول خالی است."))
            return
        }
        val paymentRef = payment
        if (paymentRef == null || !paymentReady) {
            respondSkuResult(callbackId, JSONObject().put("ok", false).put("error", "اتصال به پرداخت بازار برقرار نیست."))
            return
        }
        try {
            val skus = listOf(safeSku)
            paymentRef.getInAppSkuDetails(skus) {
                getSkuDetailsSucceed { list ->
                    val match = list.firstOrNull { it.sku == safeSku } ?: list.firstOrNull()
                    if (match == null) {
                        respondSkuResult(
                            callbackId,
                            JSONObject().put("ok", false).put("error", "محصول در کافه‌بازار یافت نشد.")
                        )
                    } else {
                        respondSkuResult(
                            callbackId,
                            JSONObject()
                                .put("ok", true)
                                .put("sku", match.sku ?: safeSku)
                                .put("price", match.price ?: "")
                                .put("title", match.title ?: "")
                        )
                    }
                }
                getSkuDetailsFailed { throwable ->
                    respondSkuResult(
                        callbackId,
                        JSONObject().put("ok", false).put("error", throwable?.message ?: "خطای دریافت قیمت از بازار")
                    )
                }
            }
        } catch (e: Exception) {
            Log.w("FitUp", "getSkuDetails exception: ${e.message}")
            respondSkuResult(callbackId, JSONObject().put("ok", false).put("error", e.message ?: "خطای نامشخص"))
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

    /* ───────────── FCM (v1.16.0 / v223) — push در اپ کلاً بسته ───────────── */

    /**
     * راه‌اندازی دستی Firebase بدون google-services.json / بدون پلاگین
     * (هم‌الگوی اپ اختصاصی): مقادیر از strings.xml (fcm_app_id / fcm_api_key /
     * fcm_project_id / fcm_sender_id) خوانده می‌شوند؛ هر چهار مقدار باید پر
     * باشند وگرنه FCM کلاً بی‌صدا رد می‌شود و اپ دقیقاً مثل قبل (سینک
     * WorkManager) کار می‌کند. روی گوشی‌های بدون سرویس گوگل هم گرفتن توکن
     * با catch بی‌صدا رد می‌شود (اپ بازار هیچ رفتار جدیدی نشان نمی‌دهد).
     * بعد از init، توکن فعلی گرفته و با کوکی سشن روی سرور ثبت می‌شود.
     */
    private fun setupFcm() {
        try {
            val appId = getString(R.string.fcm_app_id).trim()
            val apiKey = getString(R.string.fcm_api_key).trim()
            val projectId = getString(R.string.fcm_project_id).trim()
            val senderId = getString(R.string.fcm_sender_id).trim()
            if (appId.isEmpty() || apiKey.isEmpty() || projectId.isEmpty() || senderId.isEmpty()) {
                Log.i("FitUpApp", "FCM not configured (fcm_* strings empty) — push disabled, WorkManager fallback active")
                return
            }
            if (FirebaseApp.getApps(this).isEmpty()) {
                val app = FirebaseApp.initializeApp(
                    this,
                    FirebaseOptions.Builder()
                        .setApplicationId(appId)
                        .setApiKey(apiKey)
                        .setProjectId(projectId)
                        .setGcmSenderId(senderId)
                        .build()
                )
                if (app == null) {
                    Log.w("FitUpApp", "FirebaseApp.initializeApp returned null — FCM disabled")
                    return
                }
            }
            pushFcmTokenNow()
        } catch (e: Exception) {
            Log.w("FitUpApp", "FCM init failed (feature disabled): ${e.message}")
        }
    }

    /** گرفتن توکن فعلی FCM و ثبت آن روی سرور (کوکی سشن داخل FcmRegistration) */
    private fun pushFcmTokenNow() {
        try {
            if (FirebaseApp.getApps(this).isEmpty()) return
            FirebaseMessaging.getInstance().token.addOnSuccessListener { token ->
                if (!token.isNullOrBlank()) {
                    FcmRegistration.postDeviceToken(applicationContext, token)
                }
            }
        } catch (e: Exception) {
            Log.w("FitUpApp", "fcm token fetch failed (گوشی بدون سرویس گوگل؟): ${e.message}")
        }
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

        /**
         * v1.15.6 (v211) — نسخهٔ کافه‌بازار نصب‌شده روی دستگاه (versionName).
         * کاربرد: گیت سمت سایت برای «تخفیف پویا» — بازار ۱۳.۳.۰ به بالا JWT تخفیف
         * پویا را پشتیبانی می‌کند؛ پایین‌تر، درگاه درخواست را با خطای
         * «اطلاعات ارسالی برنامه برای پرداخت نامعتبر است» رد می‌کند. خروجی خالی =
         * بازار یافت نشد.
         */
        @JavascriptInterface
        fun getBazaarVersion(): String {
            if (!bridgeAllowed()) return ""
            return try {
                val info = packageManager.getPackageInfo("com.farsitel.bazaar", 0)
                info.versionName ?: ""
            } catch (_: Exception) {
                ""
            }
        }

        /**
         * v1.15.6 (v211) — قیمت نمایشی SKU از خودِ بازار (Poolakey getInAppSkuDetails).
         * نتیجه async با window.__bazaarSkuResult(id, {ok, sku, price, title, error}).
         * هدف: «مبلغ مودال سایت = مبلغ واقعی پنجرهٔ پرداخت بازار» (دیرکتیو مالک)
         * + سقفِ واقعی پیشخان برای ساخت JWT تخفیف پویا روی سرور.
         * ⚠️ فقط خواندنی — هیچ تغییری در جریان خود خرید (startBazaarPurchase).
         */
        @JavascriptInterface
        fun getSkuDetails(sku: String, callbackId: String) {
            if (!bridgeAllowed()) return
            runOnUiThread { fetchBazaarSkuDetails(sku, callbackId) }
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

        /**
         * v1.17.3 (v227) — وضعیت مجوز اعلان برای تشخیص «پوش ۲۰۰ می‌دهد ولی نوتیف نمی‌رسد».
         * گوگل پیام را تحویل می‌دهد (سرور delivered=1) ولی اگر کاربر مجوز اعلان را
         * نداده باشد، اندروید ۱۳+ نوتیف را بی‌صدا دور می‌ریزد. پنل ادمین با این پل
         * وضعیت واقعی گوشی را نشان می‌دهد و دکمهٔ فعال‌سازی همان‌جاست.
         * خروجی: "granted" | "denied" | "unsupported" (زیر اندروید ۱۳ همیشه granted است)
         */
        @JavascriptInterface
        fun notificationPermissionStatus(): String {
            if (!bridgeAllowed()) return "denied"
            return try {
                if (Build.VERSION.SDK_INT < 33) {
                    "granted" // زیر اندروید ۱۳ مجوز در نصب داده شده و قابل رد نیست
                } else {
                    val granted = ContextCompat.checkSelfPermission(
                        applicationContext,
                        android.Manifest.permission.POST_NOTIFICATIONS
                    ) == PackageManager.PERMISSION_GRANTED
                    if (granted) "granted" else "denied"
                }
            } catch (_: Exception) {
                "unsupported"
            }
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
        // ─── v222 — بیداری شبکه بعد از پس‌زمینهٔ طولانی (دیرکتیو مالک: «با بالا
        // آمدن برنامه سریعاً اتصال برقرار باشد») ───
        // ① سوکت‌های بالادستی پراکسی بعد از خواب طولانی مرده‌اند — بستنشان یعنی
        //    اولین درخواست با اتصال تازه باز می‌شود (نه شکست → صفحهٔ خطا).
        try { LoopbackProxy.get().onNetworkChanged() } catch (_: Exception) {}
        // ② اگر اسپلشِ «در حال اتصال» باز است، حلقهٔ اتصال خودکار فوراً از سر گرفته می‌شود
        try {
            if (reconnectActive) {
                beginAutoReconnect()
            }
        } catch (_: Exception) {}
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

    override fun onStop() {
        // ─── v1.15.1 — فیکس باگ صدا (همسان با fitup-app): خروج از پیش‌زمینه =
        // پایان قطعی ویدیوی ورود؛ برگشت هیچ‌وقت ویدیو/صدای ورود ندارد ───
        if (introActive) hideSplashVideo()
        super.onStop()
    }

    override fun onSaveInstanceState(outState: Bundle) {
        super.onSaveInstanceState(outState)
        webView.saveState(outState)
    }

    override fun onDestroy() {
        // v1.17.0 — خروج واقعی از اپ → باز شدن بعدی دوباره ویدیوی خوش‌آمد دارد؛
        // تخریب سیستمی (پس‌زمینه/چرخش) فلگ را نگه می‌دارد تا ویدیو تکرار نشود
        if (isFinishing) introPlayedThisProcess = false
        cancelVideoWatchdog()
        cancelPosterHide()
        coldLoadPoll?.let { coldLoadHandler.removeCallbacks(it) }
        cancelAutoReconnect()
        try { unregisterReceiver(otpReceiver) } catch (_: Exception) {}
        OtpRetriever.dispatcher = null
        connection?.disconnect()
        payment = null
        super.onDestroy()
    }

    companion object {
        /** کانال اعلان — برای NotificationSyncWorker هم لازم است (public const) */
        const val CHANNEL_ID = "fitup_general"

        // ═══ v1.17.0 — ویدیوی خوش‌آمد فقط در شروع سردِ پروسه ═══
        // فلگ سطح پروسه: برگشت از پس‌زمینه/چرخش هرگز ویدیو را دوباره پخش نمی‌کند؛
        // خروج واقعی کاربر (finish) در onDestroy ریستش می‌کند تا باز شدن بعدی ویدیو داشته باشد.
        @Volatile
        var introPlayedThisProcess = false
    }
}
