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
import android.net.Uri
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

        // انیمیشن ورود اسپلش — صرفاً تزئینی و غیرمسدودکننده؛
        // بستن اسپلش (onPageFinished/showError) را به هیچ وجه به‌تأخیر نمی‌اندازد
        startSplashAnimations()

        // 🩹 v1.2.6 (باگ بحرانی «دکمهٔ تلاش مجدد کار نمی‌کند» + حلقهٔ مرگ «درگاه
        // پرداخت باز نمی‌شود»): دکمهٔ تلاش مجدد صفحهٔ خطا bind شده بود ولی هیچ
        // listener نداشت! کاربری که زرین‌پال برایش باز نشده (VPN/IP/قطعی شبکه)
        // در صفحهٔ خطا گیر می‌کرد و هیچ راهی برای reload نداشت. حالا: reload
        // WebView — بعد از خاموش‌کردن VPN، درگاه در همان جای قبلی باز می‌شود؛
        // onPageStarted خودش hideError را صدا می‌زند (خطای موقت زیرصفحه‌ها هم
        // صفحهٔ خطا را نشان نمی‌دهد — فقط main frame).
        errorRetry.setOnClickListener {
            errorView.visibility = View.GONE
            swipeRefresh.isRefreshing = true
            webView.reload()
        }

        setupFileChooser()
        setupWebView()
        setupNotifications()
        setupDownloadCompleteReceiver()
        setupOtpRetrieverReceiver()

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
            // وگرنه شروع مستقیم با OTP — ?screen=auth: اگر سشن هست → پنل، وگرنه صفحه ورود
            webView.loadUrl(deepLinkUrl(intent) ?: startUrl())
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
            // ─── v1.2.6: fitup://open?url=<encoded> — از لینک هوشمند /go سایت ───
            if (scheme == "fitup") {
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
        val url = deepLinkUrl(intent) ?: return
        runOnUiThread {
            try {
                webView.loadUrl(url)
            } catch (_: Exception) {
            }
        }
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
                // پایان بارگذاری → اسپلش بسته می‌شود؛ انیمیشن‌های جاری لغو (بدون NPE)
                cancelSplashAnimations()
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
            // خطا → اسپلش بسته می‌شود؛ انیمیشن‌های جاری لغو
            cancelSplashAnimations()
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
    }

    override fun onPause() {
        // سشن OTP/لاگین — کوکی‌ها را فوراً روی دیسک flush کن
        try {
            CookieManager.getInstance().flush()
        } catch (_: Exception) {}
        super.onPause()
    }

    override fun onDestroy() {
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

        /** کلیدهای وضعیت دانلود APK (SharedPreferences "fitup_download") */
        private const val PREF_DOWNLOAD_ID = "download_id"
        private const val PREF_DOWNLOAD_FILE = "download_file"
        private const val PREF_DOWNLOAD_URL = "download_url"
    }
}
