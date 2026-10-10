package ir.fittup.panel

import android.animation.ValueAnimator
import android.annotation.SuppressLint
import android.app.Dialog
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
import android.graphics.drawable.GradientDrawable
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
import android.view.Gravity
import android.view.View
import android.view.ViewGroup
import android.view.animation.AccelerateDecelerateInterpolator
import android.view.animation.DecelerateInterpolator
import android.view.animation.LinearInterpolator
import android.view.animation.OvershootInterpolator
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
import android.widget.TextView
import android.widget.Toast
import android.widget.VideoView
import androidx.activity.result.ActivityResultLauncher
import androidx.activity.result.contract.ActivityResultContracts
import androidx.appcompat.app.AlertDialog
import androidx.appcompat.app.AppCompatActivity
// v1.10 (v171 — سند بازطراحی جریان پرداخت) — Chrome Custom Tabs برای درگاه
import androidx.browser.customtabs.CustomTabsIntent
import androidx.core.app.NotificationCompat
import androidx.core.content.ContextCompat
// v1.17.4 (v206) — پراکسی محلی WebView: DNS هرگز وارد کش WebView نمی‌شود (درمان ریشه‌ای FakeDNS VPNها)
import androidx.webkit.ProxyConfig
import androidx.webkit.ProxyController
import androidx.webkit.WebViewFeature
import com.google.android.gms.auth.api.phone.SmsRetriever
// v1.4 (Task 2-d) — FCM push: «اعلان‌ها حتی وقتی اپ کلاً بسته است»
// راه‌اندازی دستی (بدون google-services.json) — اگر stringsهای fcm_* خالی
// باشند هیچ‌کدام از این کلاس‌ها استفاده نمی‌شوند (graceful skip)
import com.google.firebase.FirebaseApp
import com.google.firebase.FirebaseOptions
import com.google.firebase.messaging.FirebaseMessaging
import org.json.JSONObject
import java.io.File
import java.io.FileOutputStream
import java.net.HttpURLConnection
import java.net.URI
import java.net.URL
import kotlin.concurrent.thread

/**
 * FitUp — اپ اندروید «اختصاصی» فیتاپ (نسخه سایت — v1.2.8)
 *
 * پوسته اندرویدی (WebView) پنل کاربری فیتاپ — دقیقاً همان ساختار خود سایت:
 *  - شروع با صفحه OTP (?screen=auth) → آنبوردینگ → پنل ورزشکار
 *  - پرداخت از درگاه خود سایت (زرین‌پال/شاپرک) داخل WebView
 *  - آپدیت (v1.2.8): سایت داخل WebView مودال زیبا نشان می‌دهد؛ دانلود/نصب APK
 *    با «مرورگر بیرونی» انجام می‌شود — اپ دیگر مجوز REQUEST_INSTALL_PACKAGES
 *    ندارد (پرچم قرمز Play Protect و عامل مسدودشدن اپ روی بعضی گوشی‌ها)
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
 *  - downloadUpdate(url)                → دانلود APK جدید با مرورگر بیرونی (v1.2.8)
 *  - showNotification(title, body)      → نوتیف سیستم اندروید
 *  - requestNotificationPermission()    → مجوز POST_NOTIFICATIONS
 *  - syncNotificationsNow()             → همگام‌سازی فوری اعلان‌ها (WorkManager)
 *  - syncDeviceToken()                  → ثبت مجدد توکن FCM روی سرور (v1.4 — بعد از ورود)
 *  - requestBatteryOptimization()       → دیالوگ غیرفعال‌سازی بهینه‌سازی باتری (یک‌بار)
 *  - startOtpSmsRetriever()             → SMS Retriever رسمی گوگل (بدون پرمیشن)
 *  - requestSmsAutoRead()               → حذف‌شده از v29 (پرمیشن محدود) — جایگزین: بالا
 *  - downloadFile(filename, dataUrl)    → ذخیره PNG/PDF در Downloads
 *  - printPage()                        → چاپ صفحه (PrintManager)
 *  - setSwipeRefreshEnabled(b)          → قفل pull-to-refresh هنگام اسکرول داخلی
 */
class MainActivity : AppCompatActivity() {

    private lateinit var binding: ir.fittup.panel.databinding.ActivityMainBinding
    private lateinit var webView: WebView
    private lateinit var swipeRefresh: androidx.swiperefreshlayout.widget.SwipeRefreshLayout
    private lateinit var splash: android.widget.FrameLayout

    // ─── انیمیشن ورود اسپلش (Task 4-e — لوگوی فیتاپ + شعار مالک) ───
    /** فلگ جلوگیری از اجرای تکراری انیمیشن ورود اسپلش */
    private var splashAnimated = false

    /** نماهای انیمیشن‌دار اسپلش — لغوِ ViewPropertyAnimatorها هنگام بستن زودهنگام */
    private val splashAnimViews = ArrayList<View>(6)

    /** انیمیتورهای مستقل اسپلش (شناوری/تپش لوگو + نقاط مداری) — لغو صریح تا
     *  هیچ ValueAnimatoreای پس از بستن اسپلش/نابودی اکتیویتی زنده نماند (بدون نشت) */
    private val splashAnimators = ArrayList<ValueAnimator>(4)

    // ─── v1.19.0 (v224) — «اسپلش برند جایگزین صفحهٔ خطا» (دیرکتیو مالک) ───
    /** حلقهٔ اتصال خودکار فعال؟ (جایگزین گری‌گیری از نمای خطای حذف‌شده) */
    private var reconnectActive = false
    /** شمار ریکاوری «صفحهٔ خالی» — سقف ۳؛ بعدش دیگر اسپلش برنمی‌گردد */
    private var blankRecoveryCount = 0

    // ─── 🩹 v1.7 — نگهبان صفحهٔ سفید (فیکس P0 «صفحه سفید ابدی») ───
    // گزارش مالک + کاربران: بعد از آپدیت سایت، اپ صفحهٔ سفید می‌شد و حتی با
    // بستن/بازکردن هم بالا نمی‌آمد. ریشه: HTMLِ کش‌شدهٔ WebView به چانک‌های JS
    // حذف‌شدهٔ بیلد قبلی اشاره می‌کرد → هیچ JSی اجرا نمی‌شد → سفید همیشه‌گی.
    // (سمت سایت حالا HTML همیشه no-store است؛ این نگهبان لایهٔ نهایی recovery است)
    private var blankCheckPending = false
    private var blankPageReloadUsed = false

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

    // ─── v120 — دوربین برای آپلود عکس/ویدیو (رفع تذکر کافه‌بازار) ───
    // تذکر بازار: «امکان استفاده از دوربین وجود ندارد و صرفاً می‌توان از تصاویر
    // حافظهٔ گوشی استفاده کرد». سایت حالا input[type=file][capture] می‌سازد
    // (شیت «دوربین / گالری» در همهٔ نقاط آپلود)؛ اینجا isCaptureEnabled=true
    // → دوربین واقعی باز می‌شود → مجوز CAMERA در مانیفست واقعاً استفاده می‌شود.
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

    // ─── v1.3.3 — موقعیت مکانی (GPS) برای «مسیریاب فیتاپ» (پیاده‌روی/دویدن) ───
    // صفحهٔ /activity از navigator.geolocation.watchPosition استفاده می‌کند؛
    // WebView بدون onGeolocationPermissionsShowPrompt + پرمیشن runtime اندروید،
    // درخواست موقعیت را بی‌صدا رد می‌کند. الگو مثل دوربین/میکروفون:
    // مودال برند سایت → پرمیشن «در زمان استفاده» اندروید → grant/deny.
    private var pendingGeolocationCallback: android.webkit.GeolocationPermissions.Callback? = null
    private var pendingGeolocationOrigin: String? = null
    private val locationPermissionLauncher = registerForActivityResult(ActivityResultContracts.RequestMultiplePermissions()) { grants ->
        val cb = pendingGeolocationCallback
        val origin = pendingGeolocationOrigin
        pendingGeolocationCallback = null
        pendingGeolocationOrigin = null
        if (cb != null && origin != null) {
            val ok = grants.values.any { it }
            // v1.3.4 — مجوز تأییدشده ذخیره می‌شود تا مدال لوکیشن تکرار نشود + retain=true
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
    //    SMS برای اپ‌های خارج از پلی «محدود» است؛ دیالوگ ترسناک
    //    «App was denied access» می‌آمد و اجازه هم هیچ‌وقت داده نمی‌شد.
    private var lastClipboardDispatched: String? = null

    // ─── v1.17.3 (v205) — NetworkChangeMonitor: وفاق نیم‌ثانیه‌ای با اینترنت جدید ───
    private val netMonHandler = Handler(Looper.getMainLooper())
    private var netMonPending: Runnable? = null
    private var lastDefaultNetwork: android.net.Network? = null
    private var lastVpnPresent = false
    // v1.17.4 (v206) — شناسهٔ آخرین تغییر اعمال‌شده (برای شست‌وی پراکسی فقط هنگام تغییر واقعی)
    private var lastProxyFlushIdentity: String? = null

    @SuppressLint("SetJavaScriptEnabled")
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        binding = ir.fittup.panel.databinding.ActivityMainBinding.inflate(layoutInflater)
        setContentView(binding.root)

        webView = binding.webView
        swipeRefresh = binding.swipeRefresh
        splash = binding.splash

        // ═══ v1.17.0 — دیرکتیو مالک: «کلاً اپ باید با ویدیو بیاد بالا؛ قبلش هیچی نباشه
        // و بعدشم مستقیم پنل کاربری بیاد بالا» + «ویدیو فقط وقتی کاربر برنامه را بسته
        // بوده؛ اگر در پس‌زمینه در حال اجراست تکرار نشود» ═══
        //   • شروع سردِ پروسه → فقط ویدیوی تمام‌صفحه (بدون لوگو/زمینهٔ سفید)
        //   • پایان ویدیو → مستقیم داشبورد (onPageFinished هرگز ویدیو را قطع نمی‌کند)
        //   • برگشت از پس‌زمینه/چرخش صفحه/بازگردانی اکتیویتی → بدون ویدیو (اسپلش سبک)
        val introRes = if (savedInstanceState == null && !introPlayedThisProcess) introVideoResId() else 0
        pageReady = false
        introActive = introRes != 0
        if (introRes != 0) {
            introPlayedThisProcess = true
            // هیچ چیز قبل از ویدیو — محتوای اسپلش مخفی + زمینهٔ تیرهٔ هم‌رنگ قاب ویدیو
            try { splash.setBackgroundColor(getColor(R.color.intro_bg)) } catch (_: Throwable) {}
            setSplashContentVisible(false)
            startIntroVideo(introRes)
        } else {
            // انیمیشن ورود اسپلش — مسیر بدون ویدیو (برگشت از پس‌زمینه)؛ غیرمسدودکننده
            startSplashAnimations()
        }

        // 🩹 v1.17.3 (v205) — نگهبان اسپلش/صفحهٔ سفید: کاربر هرگز «سفیدِ بی‌صدا» نمی‌بیند.
        //   • تا اولین پینت واقعی صفحه (onPageCommitVisible) اسپلش برند دیده می‌شود —
        //     حتی اگر شبکه/VPN شروع را کند کرده باشد، «سفید» اصلاً وجود ندارد.
        //   • اگر تا ۴۵ ثانیه هیچ پینتی نشد (DNS/TTFB گیر کرده) → صفحهٔ خطای فارسی
        //     با دکمهٔ «تلاش مجدد» — نه سفیدِ بی‌راه‌حل (قبلاً ۱۵ ثانیه بود و
        //     اسپلش را می‌بست و کاربر ۲۰-۳۵ ثانیه سفید نگاه می‌کرد — عین شکایت مالک).
        android.os.Handler(android.os.Looper.getMainLooper()).postDelayed({
            try {
                // v1.19.0 (v224 — دیرکتیو مالک) — واچ‌داگ دیگر اسپلش را نمی‌بندد و
                // هیچ صفحهٔ خطایی نشان نمی‌دهد: اسپلش برند می‌ماند و فقط حلقهٔ اتصال
                // خودکار تضمین می‌شود. صفحهٔ خطا از چرخهٔ حیات حذف شده است.
                if (this@MainActivity::splash.isInitialized && splash.visibility == View.VISIBLE && !pageReady) {
                    Log.w("FitUpApp", "splash watchdog fired (45s) — keep splash + auto-reconnect")
                    showError()
                }
            } catch (_: Exception) {}
        }, 45_000)


        setupFileChooser()
        setupCameraCapture()
        // v1.17.4 (v206) — پراکسی محلی WebView (قبل از هر لود — DNS تازه در هر اتصال)
        setupLoopbackProxy()
        setupWebView()
        setupNotifications()
        setupDownloadCompleteReceiver()
        setupOtpRetrieverReceiver()

        // v1.17.3 (v205) — نگهبان تغییر شبکه/VPN (وفاق نیم‌ثانیه‌ای) + گرم‌کردن مسیر شبکه
        registerNetworkMonitor()
        warmNetworkForColdStart()

        // v31 — «اعلان‌ها حتی وقتی برنامه بسته است» (کم‌مصرف — WorkManager):
        // زمان‌بندی دوره‌ای ۶ ساعته + همگام‌سازی فوری در باز شدن اپ
        NotificationSync.schedulePeriodic(this)
        NotificationSync.syncNow(this)
        OtpRetriever.dispatcher = { code -> dispatchOtpCode(code) }

        // v1.4 (Task 2-d) — FCM push: رسیدن اعلان‌ها حتی وقتی اپ کلاً از گوشی بسته است.
        // اگر مقادیر fcm_* در strings.xml خالی باشند، کاملاً بی‌صدا رد می‌شود
        // (graceful skip — اپ مثل قبل فقط با WorkManager کار می‌کند)
        setupFcm()

        if (savedInstanceState != null) {
            webView.restoreState(savedInstanceState)
        } else {
            // v1.2.5 — شروع با لینک عمیق (App Link / fitup_link اعلان) اگر هست؛
            // 🩹 v1.8.0 — اولویت دوم: URL ذخیره‌شدهٔ نجات اتصال (بازگشت دقیق به
            // همان صفحه بعد از ری‌استارت تمیز پروسه در سناریوی تغییر IP)؛
            // وگرنه شروع مستقیم با OTP — ?screen=auth: اگر سشن هست → پنل، وگرنه صفحه ورود
            // v1.11 — deepLinkUrl(coldStart = true): دیپ‌لینک پرداخت/کیف پول در
            // شروع سرد مثل قبل به داشبورد می‌رود (جریان پرداخت دست‌نخورده)
            // ═══ v1.19.0 (v224) — ریشهٔ اصلی «اتصال برقرار نیست» در شروع سرد ═══
            // WebView قبل از اتصالِ کامل شبکه (دیتای موبایل/واای‌فای تازه بعد از بوتِ
            // پروسه) لود می‌زند → فریم اصلی شکست می‌خورد → قبلاً صفحهٔ خطا می‌آمد.
            // حالا: اگر شبکه فعال نیست، اولین لود تا وصل‌شدن (حداکثر ۶ ثانیه) عقب
            // می‌افتد — ویدیو/اسپلش همین حین نمایش داده می‌شود و در مسیر اصلی دیگر
            // هیچ لودِ شکست‌خورده‌ای وجود ندارد.
            val target = deepLinkUrl(intent, coldStart = true) ?: consumeNetGuardRestartUrl() ?: startUrl()
            if (hasActiveNetwork()) {
                webView.loadUrl(target)
            } else {
                waitForNetworkThenLoad(target)
            }
        }

        checkAppVersion()
    }

    /* ───────────── انیمیشن ورود اسپلش (Task 4-e — بازطراحی برند) ─────────────
     *  دستور مالک: اسپلش = لوگوی فیتاپ + «فیتاپ» + شعار «هر بدنی فیتاپ میخواد!» —
     *  هر دو انیمیشن جذاب و قبل از لود صفحه. عکس هیرو حذف شد.
     *  فقط با API استاندارد android.view/animation — بدون وابستگی جدید.
     *  دسترسی به نماها با binding (به‌جای getChildAt) تا تغییر چیدمان هرگز نشکند.
     *  هر جا اسپلش زودتر بسته شود، همهٔ انیمیشن‌های در جریان لغو می‌شوند.
     */

    private fun startSplashAnimations() {
        if (splashAnimated) return
        splashAnimated = true

        val logo = binding.splashLogo
        val title = binding.splashTitle
        val slogan = binding.splashSlogan
        val spinner = binding.splashSpinner
        splashAnimViews.addAll(listOf(logo, title, slogan, spinner))

        val density = resources.displayMetrics.density

        // وضعیت شروع: همهٔ عناصر نامرئی / خارج از جای نهایی
        logo.scaleX = 0.55f
        logo.scaleY = 0.55f
        logo.alpha = 0f
        title.alpha = 0f
        title.translationY = 24f * density
        slogan.alpha = 0f
        slogan.translationY = 16f * density
        spinner.alpha = 0f

        // ─── لوگو: ورود اورشوت نرم ۰٫۵۵ → ۱٫۰ (۶۵۰ms) ───
        logo.animate().scaleX(1f).scaleY(1f).alpha(1f)
            .setDuration(650)
            .setInterpolator(OvershootInterpolator(1.15f))
            .start()

        // ─── شناوری پیوستهٔ لوگو: ۰ → −۱۴dp → ۰ (۲۲۰۰ms، رفت‌وبرگشت بی‌پایان) ───
        val floatAnim = ValueAnimator.ofFloat(0f, -14f * density).apply {
            duration = 2200
            repeatCount = ValueAnimator.INFINITE
            repeatMode = ValueAnimator.REVERSE
            interpolator = AccelerateDecelerateInterpolator()
            startDelay = 650
            addUpdateListener { logo.translationY = it.animatedValue as Float }
        }
        floatAnim.start()
        splashAnimators.add(floatAnim)

        // ─── تپش ملایم لوگو: ۱٫۰۰ → ۱٫۰۳ (تقلید هالهٔ تپندهٔ اسپلش وب) ───
        val pulseAnim = ValueAnimator.ofFloat(1f, 1.03f).apply {
            duration = 1600
            repeatCount = ValueAnimator.INFINITE
            repeatMode = ValueAnimator.REVERSE
            interpolator = AccelerateDecelerateInterpolator()
            startDelay = 700
            addUpdateListener {
                logo.scaleX = it.animatedValue as Float
                logo.scaleY = it.animatedValue as Float
            }
        }
        pulseAnim.start()
        splashAnimators.add(pulseAnim)

        // ─── دو نقطهٔ مداری دور لوگو — ساختهٔ کد (GradientDrawable؛ بدون فایل جدید):
        //     نارنجی ۷ ثانیه + کهربایی ۱۱ ثانیه خلاف جهت، خطی و بی‌پایان ───
        val orbit = binding.logoOrbit
        val orbitRadius = 72f * density
        val dotSpecs = listOf(Color.parseColor("#f97316") to 7000L, Color.parseColor("#fbbf24") to 11000L)
        for ((dotColor, periodMs) in dotSpecs) {
            val dot = View(this)
            val dotBg = GradientDrawable()
            dotBg.shape = GradientDrawable.OVAL
            dotBg.setColor(dotColor)
            dot.background = dotBg
            dot.alpha = 0f
            val dotSize = (8f * density).toInt().coerceAtLeast(1)
            orbit.addView(dot, android.widget.FrameLayout.LayoutParams(dotSize, dotSize, Gravity.CENTER))

            // فید ملایم نقطه هم‌زمان با آغاز مدار
            dot.animate().alpha(0.95f).setStartDelay(650).setDuration(400).start()
            splashAnimViews.add(dot)

            // مدار دایره‌ای با translationX/Y: نقطهٔ دوم با ضریب −۱ خلاف جهت می‌چرخد
            val direction = if (periodMs == 7000L) 1f else -1f
            val orbitAnim = ValueAnimator.ofFloat(0f, 360f).apply {
                duration = periodMs
                repeatCount = ValueAnimator.INFINITE
                repeatMode = ValueAnimator.RESTART
                interpolator = LinearInterpolator()
                startDelay = 650
                addUpdateListener { anim ->
                    val angle = Math.toRadians((direction * (anim.animatedValue as Float)).toDouble())
                    dot.translationX = (orbitRadius * Math.cos(angle)).toFloat()
                    dot.translationY = (orbitRadius * Math.sin(angle)).toFloat()
                }
            }
            orbitAnim.start()
            splashAnimators.add(orbitAnim)
        }

        // ─── برند «فیتاپ»: فید + سُرش به بالا (۲۴dp → ۰) ───
        title.animate().alpha(1f).translationY(0f)
            .setStartDelay(250)
            .setDuration(500)
            .setInterpolator(DecelerateInterpolator())
            .start()

        // ─── شعار «هر بدنی فیتاپ میخواد!» — فید + سُرش، هم‌تراز با اسپلش وب (۵۰۰ms) ───
        slogan.animate().alpha(1f).translationY(0f)
            .setStartDelay(500)
            .setDuration(500)
            .setInterpolator(DecelerateInterpolator())
            .start()

        // ─── اسپینر: فید کوتاه ───
        spinner.animate().alpha(1f)
            .setStartDelay(600)
            .setDuration(250)
            .start()
    }

    /** لغو امن همهٔ انیمیشن‌های اسپلش — پیش از GONE (بدون NPE/کرش/نشت حافظه) */

    // ═══════════ v1.17.0 — ویدیوی خوش‌آمد تمام‌صفحه (دیرکتیو مالک) ═══════════
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

    /** محتوای اسپلش (لوگو/برند/شعار/اسپینر) — پیش از ویدیو مخفی، بعد از آن برگردانده می‌شود */
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
            // v1.19.0 (v224 — دیرکتیو مالک: «اولین چیزی که کاربر می‌بینه باید شروع ویدیو باشه»)
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
                    // v1.19.0 — برداشتن پوستر ۲۵۰ms پس از شروع پخش: اولین فریم‌های
                    // واقعی ویدیو (پیکسل‌به‌پیکسل عین پوستر) از زیرش رد می‌شوند — گذر نامرئی
                    cancelPosterHide()
                    val ph = Runnable { try { binding.splashVideoPoster.visibility = View.GONE } catch (_: Throwable) {} }
                    posterHideRunnable = ph
                    splashVideoHandler.postDelayed(ph, 250)
                    // واچ‌داگ متناسب با طول واقعی ویدیو (+۵ ثانیه حاشیه) — هرگز گیر نمی‌کند
                    val dur = try { mp.duration.toLong().coerceAtLeast(3000) } catch (_: Throwable) { 4000L }
                    scheduleVideoWatchdog(dur + 5_000)
                } catch (t: Throwable) {
                    Log.w("FitUpApp", "intro prepared failed: ${t.message}")
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
            Log.w("FitUpApp", "intro video failed: ${t.message}")
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
                Log.w("FitUpApp", "intro video watchdog fired (${ms}ms)")
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
            // v1.17.1 — فیکس باگ صدا (گزارش مالک: «برگشت از پس‌زمینه → صدا بدون تصویر»):
            // ویدیو دیگر هرگز لازم نیست؛ از درخت نما جدا می‌شود تا هیچ پیاده‌سازیِ OEM
            // از VideoView (بازپخش خودکار روی surfaceCreated/openVideo) حتی به‌تصادف
            // نتواند صدا یا تصویر را دوباره بالا بیاورد. نمای جدا شده هرگز surface
            // نمی‌گیرد = تضمین قطعی سکوت مادام‌العمر.
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
        cancelSplashAnimations()
        if (this@MainActivity::splash.isInitialized && splash.visibility != View.GONE) {
            splash.visibility = View.GONE
            if (pageReady) scheduleBlankPageCheck()
        }
    }
    // ═══════════ پایان ویدیوی خوش‌آمد تمام‌صفحه ═══════════

    private fun cancelSplashAnimations() {
        if (!splashAnimated) return
        for (v in splashAnimViews) {
            try { v.animate().cancel() } catch (_: Exception) {}
        }
        splashAnimViews.clear()
        for (a in splashAnimators) {
            try { a.cancel() } catch (_: Exception) {}
        }
        splashAnimators.clear()
    }


    // ═══════════ v1.15.0 — دارایی آفلاین بذر (فونت‌ها + چالش‌ها) ═══════════
    /** پیشوندهای مسیری که نسخهٔ داخل APK برایشان سرو می‌شود */
    // v1.17.0 — + چانک‌های JS/CSS سایت (_next/static) از داخل APK — جابجایی نرم و بدون شبکه؛
    // ویدیوها هرگز بذر نمی‌شوند (استریم و زنده‌بودن محتوا حفظ می‌شود)
    // v1.17.1 — + splash/ و فایل‌های ریشهٔ برند (favicon/مانیفست/آیکون/hero) که در
    // هر شروع سرد درخواست می‌شوند — صفر رفت‌وبرگشت شبکه در بالا آمدن اولیه
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

    /** شروع با ?screen=auth — کاربر لاگین‌شده مستقیم پنل را می‌بیند */
    private fun startUrl(): String {
        val base = BuildConfig.SITE_URL.trimEnd('/')
        return if (base.contains("?")) "$base&screen=auth" else "$base?screen=auth"
    }

    /**
     * v1.2.6 — لینک عمیق ورودی (App Link یا اسکیم fitup:// یا اعلان) یا null:
     *  ۱) extra «fitup_link» از NotificationSync — مسیر/کوئری نسبی مثل
     *     "?tab=progress&section=checkup" یا "/panel" → SITE_URL + آن
     *  ۲) dataِ https روی دامنهٔ خودمان (fittup.ir) → همان URL — پارامترهای
     *     ?tab= ?ref= ?renewal= ?screen= ?article= دست‌نخورده می‌مانند
     *  ۳) v1.2.6 — اسکیم اختصاصی fitup://open?url=<encoded> از صفحهٔ /go سایت
     *     (لینک‌های هوشمند پیامک — فقط URL دامنهٔ خودمان پذیرفته می‌شود)
     *  v1.11 (زنده‌سازی پنل) — دیپ‌لینک‌های رسید پرداخت (fitup://payment یا fitup://wallet):
     *   • coldStart=true (شروع سرد) → مثل قبل URL داشبورد برمی‌گردد (رفتار v1.10)
     *   • coldStart=false (اپ باز بود) → بدون ناوبری؛ فقط toast + رفرش هدفمند
     *     بخش‌های مرتبط از طریق JS (refresh-section) — بدون رفرش کل صفحه
     * (null-امن — هرگز به‌خاطر لینک خراب کرش نمی‌کند)
     */
    private fun deepLinkUrl(from: Intent?, coldStart: Boolean): String? {
        if (from == null) return null
        try {
            val extra = from.getStringExtra("fitup_link")
            if (!extra.isNullOrBlank() && (extra.startsWith("/") || extra.startsWith("?"))) {
                return BuildConfig.SITE_URL.trimEnd('/') + extra
            }
            val data = from.data ?: return null
            val scheme = data.scheme?.lowercase()
            // ─── v1.2.6: fitup://open?url=<encoded> — از لینک هوشمند /go سایت ───
            if (scheme == "fitup") {
                // ─── v1.10 (v171): بازگشت از درگاه Custom Tabs — دیپ‌لینک رسید ───
                // fitup://payment/success?order=… | fitup://payment/failed?order=…
                // fitup://wallet/success?amount=…&tx=…
                val hostSeg = data.host?.lowercase() ?: ""
                if (hostSeg == "payment" || hostSeg == "wallet") {
                    val sub = data.path?.trimStart('/') ?: "success"
                    val msg = when {
                        hostSeg == "wallet" && sub == "success" ->
                            "کیف پول شما با موفقیت شارژ شد ✅"
                        hostSeg == "payment" && sub == "success" ->
                            "پرداخت با موفقیت انجام شد ✅ پلن شما فعال می‌شود"
                        else ->
                            "پرداخت تکمیل نشد — اگر مبلغی کسر شده باشد بانک برمی‌گرداند"
                    }
                    runOnUiThread {
                        try {
                            Toast.makeText(this, msg, Toast.LENGTH_LONG).show()
                        } catch (_: Exception) {
                        }
                    }
                    // v1.11 — زنده‌سازی پنل: وقتی اپ باز است، به‌جای ناوبری کامل به
                    // داشبورد، فقط بخش‌های مرتبط هدفمند رفرش می‌شوند (حفظ اسکرول/
                    // صفحهٔ فعلی کاربر). شروع سرد مثل قبل → داشبورد.
                    if (!coldStart) {
                        if (hostSeg == "wallet") {
                            dispatchRefreshSections(listOf("wallet", "orders", "dashboard"))
                        } else {
                            dispatchRefreshSections(listOf("orders", "wallet", "dashboard", "subscription"))
                        }
                        return null
                    }
                    // پنل را تازه کن — وضعیت کاربر (پلن/موجودی) از سرور می‌آید
                    return BuildConfig.SITE_URL.trimEnd('/') + "/?screen=panel&tab=dashboard"
                }
                val target = data.getQueryParameter("url") ?: return null
                if (target.startsWith("/")) {
                    // مسیر نسبی روی دامنهٔ خودمان
                    return BuildConfig.SITE_URL.trimEnd('/') + target
                }
                val t = android.net.Uri.parse(target)
                val tScheme = t.scheme?.lowercase()
                val tHost = t.host?.lowercase() ?: return null
                val isOurHost = tHost == "fittup.ir" || tHost.endsWith(".fittup.ir")
                if (isOurHost && (tScheme == "https")) return target
                return null
            }
            if (scheme != "https") return null
            val host = data.host?.lowercase() ?: return null
            // فقط دامنهٔ خودمان — همان منطق routeUrl (fittup.ir و زیردامنه‌ها)
            if (host == "fittup.ir" || host.endsWith(".fittup.ir")) return data.toString()
        } catch (_: Exception) {
        }
        return null
    }

    /** v1.2.5 — لینک عمیق وقتی اپ باز است (launchMode=singleTask → onNewIntent) */
    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        setIntent(intent)
        // WebView ممکن است هنوز آماده نباشد — هرگز کرش نکن
        if (!::webView.isInitialized) return
        // v1.11 — deepLinkUrl(coldStart = false): دیپ‌لینک پرداخت/کیف پول وقتی اپ
        // باز است فقط رفرش هدفمند بخش‌ها می‌کند (بدون رفرش کل صفحه)
        val url = deepLinkUrl(intent, coldStart = false) ?: return
        runOnUiThread {
            try {
                webView.loadUrl(url)
                // v1.11 — بعد از ناوبری، به JS بگو اتصال زندهٔ پنل را برقرار کند
                // (صفحهٔ جدید خودش SSE را باز می‌کند؛ این فقط تسریع است)
                dispatchReconnectSse()
            } catch (_: Exception) {
            }
        }
    }

    /* ───────────── WebView ───────────── */

    /**
     * v1.11 — زنده‌سازی پنل: به JS رویداد «fitup:reconnect-sse» می‌فرستد تا
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
     * v1.11 — زنده‌سازی پنل: رفرش هدفمند بخش‌های پنل بدون رفرش کل صفحه
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
        s.setGeolocationEnabled(true)                 // v1.3.3 — مسیریاب فیتاپ (GPS زنده)
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
                // v1.17.0 — پایان بارگذاری ≠ بستن ویدیو؛ داشبورد فقط بعد از پایان
                // کامل ویدیوی خوش‌آمد بالا می‌آید (دیرکتیو مالک)؛ در مسیر بدون ویدیو
                // مثل قبل اسپلش همین‌جا بسته می‌شود.
                pageReady = true
                swipeRefresh.isRefreshing = false
                injectBridgeHelper()
                maybeCloseSplash()
                // 🩹 v1.7 — نگهبان صفحهٔ سفید: اگر صفحه بعد از لود، عملاً خالی باشد
                // (JS مرده — چانک‌های بیلد قبلی بعد از آپدیت سایت)، خودکار پاک‌سازی
                // کش + تلاش مجدد انجام می‌شود؛ کاربر هرگز در سفیدِ بی‌صدا گیر نمی‌کند.
                scheduleBlankPageCheck()
            }

            /** v1.17.3 (v205) — اولین پینت واقعی = آماده (خیلی زودتر از onPageFinished)؛
             *  اسپلش همین‌جا بسته می‌شود — کاربر هرگز بین اسپلش و محتوا «سفید» نمی‌بیند. */
            override fun onPageCommitVisible(view: WebView, url: String) {
                super.onPageCommitVisible(view, url)
                pageReady = true
                maybeCloseSplash()
            }

            /** خطای بارگذاری فریم اصلی → صفحه خطای فارسی با دکمه تلاش مجدد */
            // v1.15.0 — دارایی‌های آفلاین «بذر»: فونت‌ها + انیمیشن/کاورهای چالش از داخل APK
            // (کش هوشمند — اگر فایل در APK نبود، همان مسیر از شبکه لود می‌شود؛
            //  پس محتوا همیشه به‌روز و استریم ویدیو دست‌نخورده — فقط بار اول سریع‌تر و آفلاین هم کار می‌کند)
            override fun shouldInterceptRequest(
                view: WebView,
                request: WebResourceRequest
            ): WebResourceResponse? = serveSeedAsset(request.url)

                        override fun onReceivedError(
                view: WebView,
                request: WebResourceRequest,
                error: WebResourceError
            ) {
                super.onReceivedError(view, request, error)
                if (request.isForMainFrame) showError()
            }

            // ═══ v1.19.1 (v225 — ریشهٔ نهایی «اتصال برقرار نیست» مالک) ═══
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
                // ─── v120 — پشتیبانی دوربین (رفع تذکر کافه‌بازار) ───
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
             * ─── v1.3.3 — موقعیت مکانی (GPS) — دقیقاً در زمان استفاده ───
             * مسیریاب فیتاپ (/activity) موقعیت را فقط وقتی کاربر دکمهٔ «شروع» را
             * می‌زند درخواست می‌کند؛ پرمیشن runtime «در زمان استفاده» اندروید.
             */
            override fun onGeolocationPermissionsShowPrompt(
                origin: String?,
                callback: android.webkit.GeolocationPermissions.Callback?
            ) {
                if (origin == null || callback == null) {
                    callback?.invoke(origin ?: "", false, false)
                    return
                }
                // v1.3.4 — تیکت مالک: «مدال اجازهٔ لوکیشن هر بار که دکمهٔ شروع رو می‌زنم میاد»
                // ریشه: retain=false → WebView مجوز را فقط برای همین فراخوان نگه می‌دارد و
                // با هر شروعِ مسیریاب، دیالوگ دوباره می‌آمد. فیکس: مجوز تأییدشده در
                // SharedPreferences ذخیره می‌شود و در پرامپت‌های بعدی بدون دیالوگ با
                // retain=true (حافظهٔ سشن WebView) grant می‌شود.
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

        // ─── دانلودها: APK → مرورگر بیرونی (v1.2.8)؛ فایل‌های معمولی → DownloadManager ───
        webView.setDownloadListener { url, _, contentDisposition, mimetype, _ ->
            try {
                // v1.2.7 — Safety-net: لینک‌های data: (PNG/PDF برنامه‌ها) را
                // DownloadManager پشتیبانی نمی‌کند (فقط http/https) — از پل
                // MediaStore ذخیره می‌شوند. مسیر اصلی از پل جاوااسکریپت
                // (FitUpNative.downloadFile) می‌گذرد؛ این برای هر مسیر جانبی است.
                if (url.startsWith("data:", ignoreCase = true)) {
                    val ext = when {
                        mimetype.contains("pdf", true) -> "pdf"
                        mimetype.contains("png", true) -> "png"
                        mimetype.contains("jpeg", true) || mimetype.contains("jpg", true) -> "jpg"
                        mimetype.contains("webp", true) -> "webp"
                        else -> "bin"
                    }
                    downloadDataUrl("fitup-${System.currentTimeMillis()}.$ext", url)
                    return@setDownloadListener
                }
                val fileName = guessFileName(contentDisposition, mimetype, url)
                // v1.2.8 — APK (آپدیت/دانلود مستقیم) → مرورگر بیرونی؛ اپ دیگر
                // مجوز نصب ندارد و APK از DownloadManager خود اپ نمی‌گذرد
                if (fileName.endsWith(".apk", true) ||
                    url.substringBefore('?').endsWith(".apk", true)
                ) {
                    openApkUpdateInBrowser(url)
                    return@setDownloadListener
                }
                startNativeDownload(url, fileName)
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

    /* ─── v1.6 — سیاست شبکه: «VPN / سوییچ شبکه = هیچ رویداد» (دیرکتیو مالک) ───
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

    /* ─── v1.17.3 (v205) — NetworkChangeMonitor: وفاق نیم‌ثانیه‌ای با اینترنت جدید ───
     *
     * ریشهٔ باگ ده‌بارهٔ «خاموش‌کردن VPN → اپ کلاً قطع می‌شد»: بعد از سوییچ،
     * استک شبکهٔ Chromium داخل WebView (سوکت‌های keep-alive مرده + پیکربندی
     * DNS دوران تونل) مسموم می‌ماند؛ مرورگرهای مستقل (کروم) تغییر شبکه را
     * خودشان می‌فهمند و استخر را می‌شویند، ولی WebView جاسازی‌شده روی بعضی
     * دستگاه‌ها/فیلترشکن‌ها این سیگنال را از دست می‌دهد → هر درخواست تازه روی
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
     *     دست‌نخورده (سیاست v1.6 حفظ و کامل شد).
     *  ۳) خبر فوری به وب (window.__fitupNativeNetworkChanged) → موتور خودترمیمی
     *     همان لحظه زامبی‌ها را آزاد و پروب بازیابی را روشن می‌کند؛ موفقیت →
     *     رویداد fitup:connection-restored → تازه‌سازی درجای داده‌ها.
     *  (آخرین حلقهٔ زنجیره — فقط قطعی ممتد ≥۶۰ ثانیه — پل netRescue است که
     *   وب با راستی‌آزمایی استکِ مستقل جاوا صدا می‌زند؛ همان ماشین فعلی.)
     */

    /**
     * v1.17.4 (v206) — پراکسی محلی WebView (درمان ریشه‌ای سناریوی FakeDNS):
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
        // ─── v1.17.4 (v206) — شست‌وی سوکت‌های بالادستی پراکسی محلی ───
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
     * v1.17.3 (v205) — گرم‌کردن مسیر شبکه در شروع سرد (کاهش صفحهٔ سفید/اسپلش طولانی):
     * یک درخواست سبک با استک جاوا (DNS در سطح netd کش می‌شود — مشترک با WebView؛
     * مسیر تونل VPN هم گرم می‌شود) در پس‌زمینه، هم‌زمان با ویدیو/اسپلش.
     */
    private fun warmNetworkForColdStart() {
        thread {
            try {
                val ok = freshProbe(BuildConfig.SITE_URL.trimEnd('/') + "/favicon.png")
                Log.i("FitUpApp", "cold-start network warmup: $ok")
            } catch (_: Throwable) {
            }
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

        // ─── v1.10 (v171 — سند بازطراحی جریان پرداخت — بخش ۳ و ۱۱) ───
        // سایت خودمان داخل WebView می‌ماند؛ به‌جز «لینک میانی پرداخت»
        // (/pay/start و /wallet/topup/start) که طبق سند باید در Chrome Custom
        // Tabs باز شود: چک VPN قبل از باز شدن + درگاه در کروم. بعد از پرداخت،
        // کال‌بک با ret=app_android برمی‌گردد و دیپ‌لینک fitup://payment/success
        // کاربر را به اپ برمی‌گرداند.
        val isOurSite = host == "fittup.ir" || host.endsWith(".fittup.ir") ||
            (siteHost != null && (host == siteHost || host.endsWith(".$siteHost")))
        if (isOurSite) {
            val path = url.path ?: ""
            if (path == "/pay/start" || path == "/wallet/topup/start") {
                if (isVpnActive()) {
                    runOnUiThread { showVpnWarningDialog() }
                    return true // بدون خاموش‌کردن VPN هیچ — در WebView هم نمی‌رویم
                }
                if (openInCustomTabs(url)) return true
                // Custom Tabs ممکن نشد → فال‌بک به رفتار قدیمی (داخل WebView)
                return false
            }
            return false
        }

        // درگاه پرداخت سایت (زرین‌پال) و بانک‌ها (شاپراک) — داخل WebView تا کاربر
        // بعد از پرداخت به پنل برگردد (payment_verify در همان WebView اجرا می‌شود)
        if (host == "zarinpal.com" || host.endsWith(".zarinpal.com")) return false
        if (host == "zarin.link" || host.endsWith(".zarin.link")) return false
        if (host == "shaparak.ir" || host.endsWith(".shaparak.ir")) return false

        // شبکه‌های اجتماعی/استورها/سایت‌های دیگر → مرورگر بیرونی
        openExternal(url)
        return true
    }

    /**
     * v1.10 (v171) — آیا VPN فعال است؟ (سند بخش ۳: بررسی VPN قبل از Custom Tabs)
     * با ConnectivityManager + TRANSPORT_VPN — بدون هیچ مجوزی.
     */
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
     * v1.10 (v171) — پیام «لطفاً VPN را خاموش کنید» (سند بخش ۹ — حالت‌های خطا).
     */
    private fun showVpnWarningDialog() {
        try {
            AlertDialog.Builder(this)
                .setTitle("VPN خاموش نیست")
                .setMessage(
                    "برای پرداخت امن، لطفاً فیلترشکن (VPN) را خاموش کنید و دوباره روی دکمهٔ پرداخت بزنید.\n\n" +
                        "اگر مبلغی کسر شده باشد حفظ می‌شود — هیچ پرداختی گم نمی‌شود."
                )
                .setPositiveButton("متوجه شدم", null)
                .show()
        } catch (_: Exception) {
        }
    }

    /**
     * v1.10 (v171) — باز کردن URL پرداخت در Chrome Custom Tabs (سند بخش ۳):
     * CustomTabsIntent با عنوان + نوار آدرس مخفی؛ اول Chrome، بعد هر مرورگر.
     */
    private fun openInCustomTabs(url: Uri): Boolean {
        return try {
            val intent = CustomTabsIntent.Builder()
                .setShowTitle(true)
                .setUrlBarHidingEnabled(true)
                .build()
            try {
                intent.intent.setPackage("com.android.chrome")
                intent.launchUrl(this, url)
            } catch (_: Exception) {
                // Chrome نبود → هر مرورگر Custom Tabs
                intent.intent.setPackage(null)
                intent.launchUrl(this, url)
            }
            true
        } catch (_: Exception) {
            false
        }
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

    // ─── v1.19.0 (v224) — شروع سرد روی شبکهٔ هنوز-وصل‌نشده ───
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

    /* ───────────── صفحه خطا ───────────── */

    private fun showError() {
        runOnUiThread {
            // ═══ v1.19.0 (v224 — دیرکتیو مالک: «به جای این صفحه همون اسپلش خود اپ‌ها رو
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
            // v1.19.0 — نمای خطا حذف شده؛ فقط حلقهٔ اتصال متوقف می‌شود (صفحه شروع به لود کرده)
            cancelAutoReconnect()
        }
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

    /* ───────────── 🩹 v1.7 — نگهبان صفحهٔ سفید ───────────── */
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
                            Log.w("FitUpApp", "blank page detected (textLen=$len) — cache clear + reload")
                            if (!blankPageReloadUsed) {
                                blankPageReloadUsed = true
                                try { webView.clearCache(true) } catch (_: Exception) {}
                                webView.reload()
                            } else if (blankRecoveryCount < 3) {
                                // v1.19.0 — به‌جای صفحهٔ خطا: اسپلش برند + حلقهٔ اتصال خودکار
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

    /* ───────────── دانلود / آپدیت APK ───────────── */

    /*
     * v1.2.8 — بازطراحی کامل مسیر آپدیت (فیکس مسدودشدن اپ توسط Play Protect):
     *
     *  ۱) ریشهٔ مسدودشدن: مجوز REQUEST_INSTALL_PACKAGES (پیش‌نیاز نصب APK
     *     داخل اپ با FileProvider/Installer) پرچم قرمز امنیتی Play Protect است
     *     و اپ روی بعضی گوشی‌ها با پیام «Block harmful app» رد می‌شد.
     *  ۲) فیکس: اپ دیگر این مجوز را ندارد و APK هرگز با DownloadManager خود اپ
     *     دانلود/نصب نمی‌شود — لینک APK در «مرورگر بیرونی» باز می‌شود؛ مرورگر
     *     (کروم و…) خودش مجوز نصب را دارد، دانلود را با نوتیف پیشرفت انجام
     *     می‌دهد و نصب را پیشنهاد می‌دهد (استانداردترین مسیر سایدلود).
     *  ۳) DownloadManager اپ فقط برای «فایل‌های معمولی» (PDF/PNG/…) می‌ماند؛
     *     شناسهٔ دانلود در SharedPreferences است تا با بازسازی اکتیویتی گم نشود.
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

    /** v1.2.8 — دانلود/آپدیت APK فقط از «مرورگر بیرونی».
     *  چرا؟ مجوز REQUEST_INSTALL_PACKAGES (پیش‌نیاز نصب داخل اپ) پرچم قرمز
     *  Play Protect بود و اپ روی بعضی گوشی‌ها مسدود می‌شد. اپ دیگر این مجوز
     *  را ندارد؛ مرورگر خودش مجوز نصب را دارد، APK را با نوتیف پیشرفت دانلود
     *  و نصب را پیشنهاد می‌دهد — استانداردترین و امن‌ترین مسیر سایدلود. */
    private fun openApkUpdateInBrowser(apkUrl: String) {
        try {
            val url = if (apkUrl.startsWith("http")) apkUrl
            else BuildConfig.SITE_URL.trimEnd('/') + (if (apkUrl.startsWith("/")) apkUrl else "/$apkUrl")
            toast("دانلود نسخه جدید در مرورگر شروع می‌شود — پس از اتمام، روی اعلان مرورگر بزنید و نصب را تأیید کنید 📥")
            startActivity(Intent(Intent.ACTION_VIEW, Uri.parse(url)))
        } catch (e: Exception) {
            Log.e("FitUpApp", "open apk in browser failed: ${e.message}")
            toast("مرورگری پیدا نشد — لطفاً لینک دانلود را در مرورگر باز کنید")
        }
    }

    /** شروع دانلود فایل معمولی با DownloadManager → پوشه Download اپ (بدون مجوز نوشتن).
     *  (APK از این مسیر نمی‌گذرد — v1.2.8)
     *  @return true = واقعاً enqueue شد؛ false = شکست */
    private fun startNativeDownload(url: String, fileName: String): Boolean {
        val safeName = fileName.replace(Regex("[^A-Za-z0-9._-]"), "_").ifBlank {
            "fitup-${System.currentTimeMillis()}"
        }
        try {
            val request = DownloadManager.Request(Uri.parse(url))
                .setTitle(safeName)
                .setDescription("دانلود فایل")
                .setNotificationVisibility(DownloadManager.Request.VISIBILITY_VISIBLE_NOTIFY_COMPLETED)
                .setDestinationInExternalFilesDir(this, Environment.DIRECTORY_DOWNLOADS, safeName)
                .setAllowedOverMetered(true)
                .setAllowedOverRoaming(true)
            val dm = getSystemService(Context.DOWNLOAD_SERVICE) as DownloadManager
            val id = dm.enqueue(request)
            savePendingDownload(id, safeName, url)
            return true
        } catch (e: Exception) {
            Log.e("FitUpApp", "download enqueue failed: ${e.message}")
            return false
        }
    }

    /** جلوی دوبار اجرای پشت‌سرهم (برادکست + onResume هم‌زمان) */
    private var handlingDownloadFinish = false

    /** پایان یک دانلود: فقط پاک‌سازی وضعیت pending.
     *  فایل‌های معمولی نوتیف خود DownloadManager را دارند؛ APK دیگر اصلاً از
     *  این مسیر نمی‌گذرد (v1.2.8 → مرورگر بیرونی). */
    private fun handleDownloadFinished(id: Long) {
        if (id <= 0 || id != pendingDownloadId()) return
        if (handlingDownloadFinish) return
        handlingDownloadFinish = true
        try {
            clearPendingDownload()
        } finally {
            handlingDownloadFinish = false
        }
    }

    /** safety-net هر onResume: پایان دانلود فایل معمولی (برادکست گم‌شده با
     *  بازسازی اکتیویتی/بستن اپ) — فقط پاک‌سازی وضعیت pending (v1.2.8). */
    private fun checkPendingDownload() {
        val id = pendingDownloadId()
        if (id > 0) handleDownloadFinished(id)
    }

    /** گیرندهٔ پایان دانلود (فایل‌های معمولی) → پاک‌سازی وضعیت pending.
     *  ⚠ RECEIVER_EXPORTED (نه NOT_EXPORTED): برادکست ACTION_DOWNLOAD_COMPLETE
     *  «protected» است و فقط دانلودمنیجر/سیستم می‌تواند بفرستد؛ در اندروید ۱۴+
     *  گیرندهٔ NOT_EXPORTED این برادکست را نمی‌گیرد (فرستنده DownloadProvider است). */
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

    /* ───────────── FCM (Task 2-d) — push در اپ کلاً بسته ───────────── */

    /**
     * راه‌اندازی دستی Firebase بدون google-services.json / بدون پلاگین:
     * مقادیر از strings.xml (fcm_app_id / fcm_api_key / fcm_project_id /
     * fcm_sender_id) خوانده می‌شوند؛ هر چهار مقدار باید پر باشند وگرنه FCM
     * کلاً بی‌صدا رد می‌شود و اپ دقیقاً مثل قبل (سینک WorkManager) کار می‌کند.
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
            Log.w("FitUpApp", "fcm token fetch failed: ${e.message}")
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

    /** کد OTP از کلیپ‌بورد — v1.2.9: هم کدِ خالص و هم «متن کامل پیامک» کپی‌شده.
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
    // مستقیم به OtpRetrieverReceiver می‌رسد؛ بدون RECEIVE_SMS و بدون هیچ دیالوگی.

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
            task.addOnSuccessListener { Log.i("FitUpApp", "SMS Retriever armed") }
            task.addOnFailureListener { Log.w("FitUpApp", "SMS Retriever unavailable: ${it.message}") }
        } catch (e: Exception) {
            // دستگاه بدون سرویس گوگل — fail-safe (ورود دستی/کلیپ‌بورد سر جایشان)
            Log.w("FitUpApp", "SMS Retriever start failed: ${e.message}")
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
                        // v1.19.0 — معادلِ «بالا نیامده»: اسپلش برند هنوز باز است و صفحه پینت نشده
                        if (!pageReady && this@MainActivity::splash.isInitialized
                            && splash.visibility == View.VISIBLE && !forceDialogShown) {
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

    /** دیالوگ آپدیت اجباری — دانلود با مرورگر بیرونی (v1.2.8) */
    private fun showForceUpdateDialog(apkUrl: String) {
        val dialog = AlertDialog.Builder(this)
            .setTitle("به‌روزرسانی لازم است")
            .setMessage("برای ادامه استفاده از فیتاپ، لطفاً نسخه جدید برنامه را دانلود و نصب کنید. دانلود در مرورگر انجام می‌شود.")
            .setCancelable(false)
            .setPositiveButton("دانلود نسخه جدید") { _, _ -> openApkUpdateInBrowser(apkUrl) }
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

        /**
         * v1.3.0 — کلید bridge ورود خودکار OTP.
         * صفحهٔ وب (auth-screen) این کلید را در هدر x-fitup-otp-bridge می‌فرستد؛
         * سرور با تطبیقش، کد را در همان پاسخ send-otp برمی‌گرداند تا کد بدون
         * تایپ/دکمه جا بیفتد و کاربر مستقیم وارد پنل شود (مثل اسنپ).
         */
        @JavascriptInterface
        fun getOtpBridgeKey(): String = BuildConfig.OTP_BRIDGE_SECRET

        /** دانلود نسخه جدید (از مودال آپدیت سایت) → مرورگر بیرونی (v1.2.8 — بدون مجوز نصب) */
        @JavascriptInterface
        fun downloadUpdate(apkUrl: String) {
            if (!bridgeAllowed()) return
            runOnUiThread { openApkUpdateInBrowser(apkUrl) }
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

        /**
         * v1.19.3 (v227) — وضعیت مجوز اعلان برای تشخیص «پوش ۲۰۰ می‌دهد ولی نوتیف نمی‌رسد».
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

        /** v1.4 (Task 2-d) — ثبت مجدد توکن FCM روی سرور (بعد از ورود/لاگین — سشن آماده است) */
        @JavascriptInterface
        fun syncDeviceToken() {
            if (!bridgeAllowed()) return
            pushFcmTokenNow()
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

        /** قفل pull-to-refresh برای اسکرول داخلی صفحه (فیکس باگ لیست‌ها) */
        @JavascriptInterface
        fun setSwipeRefreshEnabled(enabled: Boolean) {
            if (!bridgeAllowed()) return
            runOnUiThread { swipeRefresh.isEnabled = enabled }
        }

        /**
         * v1.11 — زنده‌سازی پنل (سند بخش ۲-ب): رفرش هدفمند یک بخش پنل —
         * فقط بخش مرتبط از سرور گرفته و آپدیت می‌شود (بدون رفرش کل صفحه،
         * بدون از دست رفتن اسکرول کاربر).
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
         * 🆕 v1.12 (v174 — پل native پرداخت — ضد «VPN خاموش → دکمهٔ پرداخت مرده»):
         *
         * مشکل: با خاموش‌شدن VPN سوکت‌های Chromium (WebView) می‌میرند و حتی
         * fetch تاب‌آور سایت نمی‌تواند اتصال تازه بسازد — دو درخواست AJAX
         * (checkout + bridge-token) از WebView هرگز جواب نمی‌گیرند.
         *
         * راه‌حل: این متد هر دو درخواست را با استکِ جاوا (HttpURLConnection
         * کاملاً جدا از Chromium) می‌زند و اگر موفق شد، Custom Tab را خودش
         * باز می‌کند. هیچ reload/recreate/killProcess ای انجام نمی‌شود —
         * مدال خرید کاربر سر جایش می‌ماند.
         *
         * قرارداد با سایت (تأییدشده از کدبیس):
         *  • @param planId  رشتهٔ پلن: "basic"|"standard"|"advanced"|"ultimate"
         *    (پاک‌سازی سفت [A-Za-z0-9_-] حداکثر ۳۲ کاراکتر — ضد تزریق)
         *  • checkout کلید "ok" ندارد — موفقیت = HTTP 2xx + paymentId غیرخالی
         *  • bridge-token کلید "ok":true دارد + url نسبی مثل
         *    "/pay/start?order=…&from=app_android&t=…" (توکن ۵ دقیقه‌ای)
         *  • UA باید شامل "FitUpApp/" باشد (تشخیص سرور substring-محور است)
         *  • کوکی سشن "sc_session" host-only برای fittup.ir — از CookieManager
         *    خوانده می‌شود (httpOnly مانع خواندن نیتیو نیست)
         *
         * @return true یعنی «کار را گرفتم» (سایت منتظر می‌ماند و جریان وب
         *         اجرا نمی‌شود)؛ false یعنی native پذیرش نکرد → سایت همان
         *         جریان قبلی را ادامه می‌دهد.
         *         شکستِ وسطِ کار → رویداد fitup:native-payment-failed به صفحه
         *         dispatch می‌شود تا دکمهٔ پرداخت قفل نماند و فال‌بک ممکن باشد.
         */
        @JavascriptInterface
        fun startPaymentNative(planId: String): Boolean {
            if (!bridgeAllowed()) return false
            val safePlan = planId.filter { it.isLetterOrDigit() || it == '_' || it == '-' }.take(32)
            if (safePlan.isEmpty()) return false

            Thread {
                try {
                    // ۱) چک VPN — با VPN روشن هیچ درخواستی زده نمی‌شود؛ فقط دیالوگ
                    if (isVpnActive()) {
                        runOnUiThread { showVpnWarningDialog() }
                        return@Thread
                    }

                    // ۲) کوکی‌های WebView (سشن sc_session داخلش هست)
                    val siteUrl = BuildConfig.SITE_URL
                    val cookies = try {
                        CookieManager.getInstance().getCookie(siteUrl) ?: ""
                    } catch (_: Exception) { "" }

                    // ۳) UA — همان الگوی setupWebView (سرور فقط "FitUpApp/" را چک می‌کند)
                    val ua = "Mozilla/5.0 (Linux; Android) FitUpApp/" + BuildConfig.VERSION_NAME
                    val base = siteUrl.trimEnd('/')

                    // ۴) POST /api/payment/checkout از استک native
                    val checkoutBody = JSONObject().apply {
                        put("planId", safePlan)
                        put("paymentMethod", "gateway")
                    }.toString()
                    val checkoutRes = nativeJsonPost(
                        base + "/api/payment/checkout", checkoutBody, cookies, ua
                    )
                    // ⚠️ checkout کلید "ok" ندارد — موفقیت = status 2xx
                    if (checkoutRes == null) {
                        Log.w("FitUpApp", "native checkout failed — falling back to web flow")
                        notifyNativePaymentFailed()
                        return@Thread
                    }
                    val paymentId = checkoutRes.optString("paymentId")
                    if (paymentId.isBlank()) {
                        Log.w("FitUpApp", "native checkout: paymentId blank — falling back")
                        notifyNativePaymentFailed()
                        return@Thread
                    }

                    // ۵) POST /api/payment/bridge-token از استک native
                    val bridgeBody = JSONObject().apply { put("paymentId", paymentId) }.toString()
                    val bridgeRes = nativeJsonPost(
                        base + "/api/payment/bridge-token", bridgeBody, cookies, ua
                    )
                    if (bridgeRes == null || !bridgeRes.optBoolean("ok")) {
                        Log.w("FitUpApp", "native bridge-token failed — falling back")
                        notifyNativePaymentFailed()
                        return@Thread
                    }
                    val payUrl = bridgeRes.optString("url")
                    if (payUrl.isBlank()) {
                        Log.w("FitUpApp", "native bridge-token: url blank — falling back")
                        notifyNativePaymentFailed()
                        return@Thread
                    }

                    // ۶) باز کردن Custom Tab (کروم اول — بعد هر مرورگر)
                    val absolute = if (payUrl.startsWith("http")) payUrl
                    else base + (if (payUrl.startsWith("/")) payUrl else "/$payUrl")
                    runOnUiThread {
                        if (!openInCustomTabs(Uri.parse(absolute))) {
                            openExternal(Uri.parse(absolute))
                        }
                    }
                    Log.i("FitUpApp", "native payment flow OK — Custom Tab opened")
                } catch (e: Exception) {
                    Log.e("FitUpApp", "startPaymentNative error: ${e.message}")
                    notifyNativePaymentFailed()
                    // هیچ throw نمی‌کنیم — سایت خودش fallback می‌کند
                }
            }.start()
            return true
        }

        /**
         * 🆕 v1.14 (v176 — پل native با کد تخفیف — پوشش کامل تمدید/ارتقا):
         *
         * پیش‌زمینه: پل v174 (startPaymentNative) فقط وقتی فعال می‌شد که «کد
         * تخفیف» فعال نباشد، چون فقط planId می‌فرستد. نتیجه: تمدیدِ دارای کد
         * تخفیف اختصاصی (رایج‌ترین حالت تمدید) و ارتقای دارای آفر/کد شخصی به
         * فال‌بک وب می‌رفت (fetchWithResilience — امن، ولی نه استک جاوا).
         *
         * این متد همان دو درخواست (checkout + bridge-token) را با استک جاوا
         * می‌زند و کد تخفیف را هم دقیقاً مثل فلو وب به بدنهٔ checkout اضافه
         * می‌کند. اعتبارسنجی کد ۱۰۰٪ سمت سرور است (مالکیت/استفاده/انقضا/کد
         * نمایشی 248945) — native فقط رشته را منتقل می‌کند، هیچ ارزیابی محلی
         * روی درستی کد انجام نمی‌دهد (کد نامعتبر = خطای ۴۰۰ سرور = فال‌بک وب).
         *
         * قرارداد با سایت (تأییدشده از کدبیس):
         *  • @param planId            "basic"|"standard"|"advanced"|"ultimate"
         *    (پاک‌سازی سفت [A-Za-z0-9_-] حداکثر ۳۲ کاراکتر — ضد تزریق)
         *  • @param discountCode      کد عمومی (فیلد discountCode فلو وب) یا ""
         *  • @param userDiscountCode  کد اختصاصی کاربر (فیلد userDiscountCode
         *    فلو وب — کد تمدید FITAP15-… / کد شخصی / کد نمایشی ۲۴۸۹۴۵) یا ""
         *    اگر هر دو داده شده باشند، مطابق فلو وب فقط userDiscountCode
         *    ارسال می‌شود (سرور هم همین ارجحیت را دارد). پاک‌سازی سفت هر دو:
         *    [A-Za-z0-9_-] حداکثر ۴۰ کاراکتر — ضد تزریق
         *  • checkout کلید "ok" ندارد — موفقیت = HTTP 2xx + paymentId غیرخالی
         *  • bridge-token کلید "ok":true دارد + url نسبی (توکن ۵ دقیقه‌ای)
         *  • UA باید شامل "FitUpApp/" باشد (تشخیص سرور substring-محور است)
         *  • کوکی سشن "sc_session" host-only برای fittup.ir — از CookieManager
         *    خوانده می‌شود (httpOnly مانع خواندن نیتیو نیست)
         *
         * @return true یعنی «کار را گرفتم» (سایت منتظر می‌ماند و جریان وب
         *         اجرا نمی‌شود)؛ false یعنی native پذیرش نکرد → سایت همان
         *         جریان قبلی را ادامه می‌دهد.
         *         شکستِ وسطِ کار → رویداد fitup:native-payment-failed به صفحه
         *         dispatch می‌شود تا دکمهٔ پرداخت قفل نماند و فال‌بک ممکن باشد.
         */
        @JavascriptInterface
        fun startPaymentNativeWithCode(
            planId: String,
            discountCode: String,
            userDiscountCode: String
        ): Boolean {
            if (!bridgeAllowed()) return false
            val safePlan = planId.filter { it.isLetterOrDigit() || it == '_' || it == '-' }.take(32)
            if (safePlan.isEmpty()) return false
            val safeGeneral = discountCode.filter { it.isLetterOrDigit() || it == '_' || it == '-' }.take(40)
            val safeUser = userDiscountCode.filter { it.isLetterOrDigit() || it == '_' || it == '-' }.take(40)

            Thread {
                try {
                    // ۱) چک VPN — با VPN روشن هیچ درخواستی زده نمی‌شود؛ فقط دیالوگ
                    if (isVpnActive()) {
                        runOnUiThread { showVpnWarningDialog() }
                        return@Thread
                    }

                    // ۲) کوکی‌های WebView (سشن sc_session داخلش هست)
                    val siteUrl = BuildConfig.SITE_URL
                    val cookies = try {
                        CookieManager.getInstance().getCookie(siteUrl) ?: ""
                    } catch (_: Exception) { "" }

                    // ۳) UA — همان الگوی setupWebView (سرور فقط "FitUpApp/" را چک می‌کند)
                    val ua = "Mozilla/5.0 (Linux; Android) FitUpApp/" + BuildConfig.VERSION_NAME
                    val base = siteUrl.trimEnd('/')

                    // ۴) POST /api/payment/checkout از استک native — با کد تخفیف
                    // (ارجحیت مطابق فلو وب و سرور: کد اختصاصی بر کد عمومی)
                    val checkoutBody = JSONObject().apply {
                        put("planId", safePlan)
                        put("paymentMethod", "gateway")
                        if (safeUser.isNotBlank()) {
                            put("userDiscountCode", safeUser)
                        } else if (safeGeneral.isNotBlank()) {
                            put("discountCode", safeGeneral)
                        }
                    }.toString()
                    val checkoutRes = nativeJsonPost(
                        base + "/api/payment/checkout", checkoutBody, cookies, ua
                    )
                    // ⚠️ checkout کلید "ok" ندارد — موفقیت = status 2xx
                    if (checkoutRes == null) {
                        Log.w("FitUpApp", "native checkout(code) failed — falling back to web flow")
                        notifyNativePaymentFailed()
                        return@Thread
                    }
                    val paymentId = checkoutRes.optString("paymentId")
                    if (paymentId.isBlank()) {
                        Log.w("FitUpApp", "native checkout(code): paymentId blank — falling back")
                        notifyNativePaymentFailed()
                        return@Thread
                    }

                    // ۵) POST /api/payment/bridge-token از استک native
                    val bridgeBody = JSONObject().apply { put("paymentId", paymentId) }.toString()
                    val bridgeRes = nativeJsonPost(
                        base + "/api/payment/bridge-token", bridgeBody, cookies, ua
                    )
                    if (bridgeRes == null || !bridgeRes.optBoolean("ok")) {
                        Log.w("FitUpApp", "native bridge-token(code) failed — falling back")
                        notifyNativePaymentFailed()
                        return@Thread
                    }
                    val payUrl = bridgeRes.optString("url")
                    if (payUrl.isBlank()) {
                        Log.w("FitUpApp", "native bridge-token(code): url blank — falling back")
                        notifyNativePaymentFailed()
                        return@Thread
                    }

                    // ۶) باز کردن Custom Tab (کروم اول — بعد هر مرورگر)
                    val absolute = if (payUrl.startsWith("http")) payUrl
                    else base + (if (payUrl.startsWith("/")) payUrl else "/$payUrl")
                    runOnUiThread {
                        if (!openInCustomTabs(Uri.parse(absolute))) {
                            openExternal(Uri.parse(absolute))
                        }
                    }
                    Log.i("FitUpApp", "native payment flow(code) OK — Custom Tab opened")
                } catch (e: Exception) {
                    Log.e("FitUpApp", "startPaymentNativeWithCode error: ${e.message}")
                    notifyNativePaymentFailed()
                    // هیچ throw نمی‌کنیم — سایت خودش fallback می‌کند
                }
            }.start()
            return true
        }

        /**
         * 🆕 v1.13 (v175 — پل native شارژ کیف پول — همان ضد «VPN خاموش»):
         *
         * مشکل: دقیقاً همان مشکل v174 برای خرید پلن — با خاموش‌شدن VPN
         * سوکت‌های WebView می‌میرند و POST /api/wallet از استک مرورگر
         * بی‌جواب می‌ماند → دکمهٔ «شارژ کیف پول» مرده.
         *
         * راه‌حل: این متد هر دو درخواست (‎/api/wallet + bridge-token) را با
         * استکِ جاوا (HttpURLConnection جدا از Chromium) می‌زند و Custom Tab
         * را خودش باز می‌کند. هیچ reload/recreate/killProcess ای انجام
         * نمی‌شود — مودال شارژ کاربر سر جایش می‌ماند.
         *
         * قرارداد با سایت (تأییدشده از کدبیس):
         *  • @param amount  رشتهٔ فقط-رقمی مبلغ به تومان (پاک‌سازی سفت:
         *    فقط isDigit، حداکثر ۸ رقم — ضد تزریق)
         *  • ‎/api/wallet کلید "ok":true دارد (برخلاف checkout!) — موفقیت
         *    = ok:true + paymentId غیرخالی
         *  • bridge-token کلید "ok":true دارد + url نسبی (توکن ۵ دقیقه‌ای)
         *  • rate limit سرور: wallet-topup = ۵ درخواست/۶۰ ثانیه با کلید
         *    جدا از bridge-token — دو درخواست پشت‌سرهم مشکلی ندارد
         *  • بازهٔ مجاز مبلغ: ۱۰,۰۰۰ تا ۱۰,۰۰۰,۰۰۰ تومان — بیرون از بازه
         *    native اصلاً درخواست نمی‌زند (false → فال‌بک وب → پیام ۴۰۰ سرور)
         *  • UA باید شامل "FitUpApp/" باشد (تشخیص سرور substring-محور است)
         *  • کوکی سشن "sc_session" host-only برای fittup.ir — از CookieManager
         *    خوانده می‌شود (httpOnly مانع خواندن نیتیو نیست)
         *
         * @return true یعنی «کار را گرفتم» (سایت منتظر می‌ماند و جریان وب
         *         اجرا نمی‌شود)؛ false یعنی native پذیرش نکرد → سایت همان
         *         جریان قبلی را ادامه می‌دهد.
         *         شکستِ وسطِ کار → رویداد fitup:native-payment-failed به صفحه
         *         dispatch می‌شود تا دکمهٔ شارژ قفل نماند و فال‌بک ممکن باشد.
         */
        @JavascriptInterface
        fun startWalletTopupNative(amount: String): Boolean {
            if (!bridgeAllowed()) return false
            // فقط رقم — بدون هیچ کاراکتر دیگر
            val safeAmount = amount.filter { it.isDigit() }.take(8)
            if (safeAmount.isEmpty()) return false
            val amountLong = safeAmount.toLongOrNull() ?: return false
            // بازهٔ مجاز سرور: ۱۰,۰۰۰ تا ۱۰,۰۰۰,۰۰۰ تومان
            if (amountLong < 10_000L || amountLong > 10_000_000L) return false

            Thread {
                try {
                    // ۱) چک VPN — با VPN روشن هیچ درخواستی زده نمی‌شود؛ فقط دیالوگ
                    if (isVpnActive()) {
                        runOnUiThread { showVpnWarningDialog() }
                        return@Thread
                    }

                    // ۲) کوکی‌های WebView (سشن sc_session داخلش هست)
                    val siteUrl = BuildConfig.SITE_URL
                    val cookies = try {
                        CookieManager.getInstance().getCookie(siteUrl) ?: ""
                    } catch (_: Exception) { "" }

                    // ۳) UA — همان الگوی v174 (سرور فقط "FitUpApp/" را چک می‌کند)
                    val ua = "Mozilla/5.0 (Linux; Android) FitUpApp/" + BuildConfig.VERSION_NAME
                    val base = siteUrl.trimEnd('/')

                    // ۴) POST /api/wallet از استک native
                    val walletBody = JSONObject().apply {
                        put("amount", amountLong)
                    }.toString()
                    val walletRes = nativeJsonPost(
                        base + "/api/wallet", walletBody, cookies, ua
                    )
                    // ⚠️ این endpoint کلید "ok" دارد (برخلاف checkout)
                    if (walletRes == null || !walletRes.optBoolean("ok")) {
                        Log.w("FitUpApp", "native wallet topup failed — falling back")
                        notifyNativePaymentFailed()
                        return@Thread
                    }
                    val paymentId = walletRes.optString("paymentId")
                    if (paymentId.isBlank()) {
                        Log.w("FitUpApp", "native wallet topup: paymentId blank — falling back")
                        notifyNativePaymentFailed()
                        return@Thread
                    }

                    // ۵) POST /api/payment/bridge-token از استک native
                    val bridgeBody = JSONObject().apply { put("paymentId", paymentId) }.toString()
                    val bridgeRes = nativeJsonPost(
                        base + "/api/payment/bridge-token", bridgeBody, cookies, ua
                    )
                    if (bridgeRes == null || !bridgeRes.optBoolean("ok")) {
                        Log.w("FitUpApp", "native wallet bridge-token failed — falling back")
                        notifyNativePaymentFailed()
                        return@Thread
                    }
                    val payUrl = bridgeRes.optString("url")
                    if (payUrl.isBlank()) {
                        Log.w("FitUpApp", "native wallet bridge-token: url blank — falling back")
                        notifyNativePaymentFailed()
                        return@Thread
                    }

                    // ۶) باز کردن Custom Tab (کروم اول — بعد هر مرورگر)
                    val absolute = if (payUrl.startsWith("http")) payUrl
                    else base + (if (payUrl.startsWith("/")) payUrl else "/$payUrl")
                    runOnUiThread {
                        if (!openInCustomTabs(Uri.parse(absolute))) {
                            openExternal(Uri.parse(absolute))
                        }
                    }
                    Log.i("FitUpApp", "native wallet topup OK — Custom Tab opened")
                } catch (e: Exception) {
                    Log.e("FitUpApp", "startWalletTopupNative error: ${e.message}")
                    notifyNativePaymentFailed()
                    // هیچ throw نمی‌کنیم — سایت خودش fallback می‌کند
                }
            }.start()
            return true
        }

        /**
         * 🆕 v1.12 — اعلام شکست پل native به صفحهٔ وب (تست ۶ چک‌لیست):
         * دکمهٔ پرداخت سایت به این رویداد گوش می‌دهد؛ با شنیدنش دکمه فوراً
         * آزاد می‌شود و این سشن از native صرف‌نظر می‌کند (کلیک دوباره = جریان
         * قبلی وب). سکوتِ کامل = قفل ۱۲ثانیه‌ای بی‌پیام = تجربهٔ بد.
         */
        private fun notifyNativePaymentFailed() {
            runOnUiThread {
                try {
                    webView.evaluateJavascript(
                        "window.dispatchEvent(new CustomEvent('fitup:native-payment-failed'));",
                        null
                    )
                } catch (_: Exception) {
                }
            }
        }

        /**
         * 🩹 v1.9.0 — نجات اتصال بعد از تغییر IP/VPN (ConnectionGuard — بازطراحی):
         * وب بعد از ۱۲ ثانیه قطعیِ ممتد اینجا را صدا می‌زند. پروب نیتیو
         * (HttpURLConnection با استکِ جدا از Chromium) مسیر واقعی را تأیید
         * می‌کند و در صورت سالم‌بودن، صفحه «درجا» reload می‌شود.
         * ⚠️ v1.8.0 اینجا پروسه را با killProcess می‌کشت و به AlarmManager
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
                        Log.w("FitUpApp", "netRescue: real network OK but web stack stale → in-place reload (no process kill)")
                        runOnUiThread {
                            try {
                                android.widget.Toast.makeText(
                                    this@MainActivity,
                                    "اتصال بازیابی شد — در حال تازه‌سازی صفحه…",
                                    android.widget.Toast.LENGTH_SHORT
                                ).show()
                            } catch (_: Exception) {}
                        }
                        // v1.11 — به JS اطلاع بده اتصال زندهٔ پنل را دوباره وصل کند
                        // (سند بخش ۲-د) — هم قبل از ریلود درجا (اگر ریلود نشد)،
                        // هم برای صفحهٔ تازه بعد از ریلود
                        dispatchReconnectSse()
                        Thread.sleep(600) // فرصت نمایش Toast
                        rescueReloadInPlace()
                    } else {
                        Log.i("FitUpApp", "netRescue: network truly down (VPN switching?) — no reload, web keeps probing")
                    }
                } catch (_: Exception) {
                }
            }.start()
        }

    }

    /* ───────────── 🩹 v1.9.0 — ConnectionGuard (نجات اتصال — بدون مرگ پروسه) ───────────── */

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
                setRequestProperty("User-Agent", "FitUpNetGuard/1.9")
            }
            val ok = try { conn.responseCode < 500 } catch (_: Exception) { false }
            try { conn.disconnect() } catch (_: Exception) {}
            ok
        } catch (_: Exception) {
            false
        }
    }

    /**
     * 🆕 v1.12 (v174) — POST JSON با استکِ جاوا (کاملاً جدا از Chromium/WebView):
     * سوکت keep-alive مُردهٔ WebView روی این مسیر هیچ تأثیری ندارد — هر
     * فراخوانی اتصال TCP تازه می‌سازد (مثل freshProbe).
     *
     * @return JSONObject در صورت 2xx؛ null در بقیهٔ موارد (خطا/شبکه/غیر-2xx)
     * ⚠️ checkout کلید "ok" ندارد — تشخیص موفقیت فقط با status 2xx انجام می‌شود.
     */
    private fun nativeJsonPost(url: String, body: String, cookies: String, ua: String): JSONObject? {
        return try {
            val conn = (URL(url).openConnection() as HttpURLConnection).apply {
                requestMethod = "POST"
                connectTimeout = 12_000
                readTimeout = 12_000
                doOutput = true
                instanceFollowRedirects = false
                setRequestProperty("Content-Type", "application/json; charset=utf-8")
                setRequestProperty("User-Agent", ua)
                setRequestProperty("Connection", "close") // ضد keep-alive مُرده — اتصال تازه هر بار
                if (cookies.isNotBlank()) setRequestProperty("Cookie", cookies)
            }
            conn.outputStream.use { it.write(body.toByteArray(Charsets.UTF_8)) }
            // ⚠️ موفقیت = status 2xx (checkout کلید "ok" ندارد)
            if (conn.responseCode !in 200..299) {
                try { conn.disconnect() } catch (_: Exception) {}
                return null
            }
            val text = conn.inputStream?.bufferedReader()?.use { it.readText() } ?: return null
            try { conn.disconnect() } catch (_: Exception) {}
            JSONObject(text)
        } catch (e: Exception) {
            Log.w("FitUpApp", "nativeJsonPost failed: ${e.message}")
            null
        }
    }

    /**
     * 🩹 v1.9.0 — بازیابی «درجا» بدون مرگ پروسه (بازطراحی ConnectionGuard):
     * سوییچ VPN/IP حالا فقط یک reload درجای همان صفحه است + اسپلش کوتاه تا
     * DOM کهنه دیده نشود. کاربر دقیقاً به صفحهٔ خودش برمی‌گردد (سشن/کوکی
     * دست‌نخورده) و اپ هیچ‌وقت بسته نمی‌شود.
     * (نسخهٔ 1.8.0 اینجا پروسه را killProcess می‌کرد و AlarmManager اپ را
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
                Log.w("FitUpApp", "netRescue: in-place reload done (process alive, same page)")
            } catch (e: Exception) {
                Log.e("FitUpApp", "netRescue in-place reload failed: ${e.message}")
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
        // 🩹 v1.2.6 (باگ «بک در درگاه پرداخت از برنامه خارج می‌کند»):
        // اگر کاربر روی صفحهٔ غیر از سایت خودمان است (زرین‌پال/بانک/شاپرک)،
        // پل وب (__fitupNativeBack) آنجا وجود ندارد → 'unknown' → قبلاً مستقیم
        // دیالوگ خروج! درستش: اول history وب را پس بگیریم (webView.goBack) تا
        // کاربر به سایت/مدال پرداخت برگردد؛ فقط وقتی جایی برای برگشتن نیست،
        // دیالوگ خروج. رفتار داشبورد سایت (بک دوم = مودال خروج) دست‌نخورده ماند.
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
        // ─── v1.11 — زنده‌سازی پنل (سند real-time مالک — بخش ۲-الف) ───
        // برگشت به اپ → تایمر/رندر WebView از سر گرفته می‌شود و به JS گفته
        // می‌شود اتصال زندهٔ SSE را دوباره وصل کند؛ رویدادهای ازدست‌رفتهٔ
        // حین پس‌زمینه با last-event-id ری‌پلی می‌شوند → پنل بدون رفرش دستی به‌روز است
        dispatchReconnectSse()
        // چک نسخه در هر بازگشت (اگر نسخه اجباری جدید منتشر شده باشد)
        checkAppVersion()
        // پایان دانلود APK — اگر برادکست پایان-دانلود را از دست داده‌ایم
        // (کوارک اندروید ۱۴ / بازسازی اکتیویتی / بستن و بازکردن اپ)،
        // با برگشتن به اپ دیالوگ نصب/خطا نشان داده می‌شود
        checkPendingDownload()
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
        // ─── v1.11 — زنده‌سازی پنل (سند بخش ۲-الف) ───
        // توقف تایمرها/رندر WebView در پس‌زمینه (باتری/دیتا)؛ برگشت زنده
        // می‌شود در onResume (dispatchReconnectSse + resumeTimers)
        try {
            if (::webView.isInitialized) {
                webView.onPause()
                webView.pauseTimers()
            }
        } catch (_: Exception) {}
        // سشن OTP/لاگین — کوکی‌ها را فوراً روی دیسک flush کن
        try {
            CookieManager.getInstance().flush()
        } catch (_: Exception) {}
        super.onPause()
    }

    override fun onStop() {
        // ─── v1.17.1 — فیکس باگ صدا (گزارش مالک): «اپ در پس‌زمینه → صدای ویدیو پخش
        // می‌شود» ─── ریشه: VideoView در onStop هرگز متوقف نمی‌شد؛ روی خیلی از
        // دستگاه‌ها MediaPlayer هنگام پس‌زمینه زنده می‌ماند یا موقع برگشت با
        // surfaceCreated→openVideo دوباره صدا می‌داد (صدا بدون تصویر).
        // طبق قانون مالک: خروج از پیش‌زمینه (خانه/قفل/سوییچ اپ) = پایان قطعی ویدیوی
        // ورود؛ برگشت هیچ‌وقت ویدیو/صدای ورود ندارد (اسپلش سبک → داشبورد).
        if (introActive) hideSplashVideo()
        super.onStop()
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
        // پاک‌سازی انیمیشن‌های معلق اسپلش (lifecycle-safe)
        cancelSplashAnimations()
        super.onDestroy()
    }

    override fun onSaveInstanceState(outState: Bundle) {
        super.onSaveInstanceState(outState)
        webView.saveState(outState)
    }

    companion object {
        /** کانال اعلان — برای NotificationSyncWorker هم لازم است (public const) */
        const val CHANNEL_ID = "fitup_general"

        // ═══ v1.17.0 — ویدیوی خوش‌آمد فقط در شروع سردِ پروسه ═══
        // فلگ سطح پروسه: برگشت از پس‌زمینه/چرخش هرگز ویدیو را دوباره پخش نمی‌کند؛
        // خروج واقعی کاربر (finish) در onDestroy ریستش می‌کند تا باز شدن بعدی ویدیو داشته باشد.
        @Volatile
        var introPlayedThisProcess = false

        /** کلیدهای وضعیت دانلود APK (SharedPreferences "fitup_download") */
        private const val PREF_DOWNLOAD_ID = "download_id"
        private const val PREF_DOWNLOAD_FILE = "download_file"
        private const val PREF_DOWNLOAD_URL = "download_url"
    }
}
