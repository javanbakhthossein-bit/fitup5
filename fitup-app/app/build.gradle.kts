plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
}

android {
    namespace = "ir.fittup.panel"
    compileSdk = 34

    defaultConfig {
        applicationId = "ir.fittup.panel"
        minSdk = 24
        targetSdk = 34
        // v1.2.5 — App Links (باز شدن https://fittup.ir داخل اپ) + لینک اعلان‌ها
        // (تپ اعلان به صفحهٔ مقصد می‌رود) + پرمیشن صریح RECEIVE_BOOT_COMPLETED.
        // دیالوگ تأیید خروج برندشدهٔ سفارشی (جایگزین AlertDialog ساده) و
        // جریان آپدیت اپ اختصاصی (چک نسخه + دانلود APK از سایت) دست‌نخورده ماند.
        // v1.2.7 — دانلود فایل‌های data: (PNG/PDF برنامه‌ها) از پل MediaStore در
        // DownloadListener (safety-net؛ مسیر اصلی پل FitUpNative.downloadFile است).
        // v1.2.8 — حذف REQUEST_INSTALL_PACKAGES (پرچم قرمز Play Protect و عامل
        // مسدودشدن اپ) → آپدیت با مرورگر بیرونی؛ کد نسخهٔ ۱۰ = 1.2.7
        // v1.3.0 (کد ۱۳) — کلید bridge ورود خودکار OTP (FitUpNative.getOtpBridgeKey)
        // + v63 سمت وب: کلید هم در هدر و هم در body می‌رود؛ سرور لاگ عیب‌یابی دارد.
        // v1.3.1 (کد ۱۴) — v65: سینک نوتیف در اپ بسته از هر ۶ ساعت به هر ۱ ساعت
        // (WorkManager با ExistingPeriodicWorkPolicy.UPDATE تا فاصلهٔ جدید پس از
        // آپدیت اعمال شود) — باگ «نوتیف در اپ بسته نمی‌رسد».
        // v120 (کد ۱۶) — رفع تذکر کافه‌بازار: دوربین در همهٔ نقاط آپلود — شیت
        // «دوربین/گالری» در سایت + پشتیبانی isCaptureEnabled/ACTION_IMAGE_CAPTURE
        // (FileProvider) در MainActivity → مجوز CAMERA حالا واقعاً استفاده می‌شود.
        // ⚠️ نسخهٔ نصب‌شدهٔ کاربران باید ≥ این بیلد باشد تا ورود خودکار OTP کار کند.
        // v1.3.3 (versionCode 17) — مجوز GPS مسیریاب + خودترمیمی شبکه (تغییر IP)
        // v1.3.4 (versionCode 18) — ریشه‌درمانی «VPN خاموش → اپ کلاً قطع می‌شد و باید
        //           خارج/وارد می‌شدی»: registerDefaultNetworkCallback + هند‌آف بی‌سکوت
        //           (۲.۵ ثانیه بعد از onLost اگر شبکه فعال بود → reload) + debounce ۴s.
        // v1.5.0 (versionCode 19) — خودترمیمی «سخت» شبکه (بار سوم، ریشه‌ای):
        //           reload کافی نبود چون استخر سوکت/کش DNS کرومیوم همان تونل مرده را
        //           دور می‌زد. حالا: پروب واقعی HTTP (۳ تلاش) → در صورت سالم‌بودن
        //           شبکه از بیرون → recreate() (معادل بستن/بازکردن اپ، بدون خروج
        //           کاربر؛ کوکی/سشن می‌ماند) + گارد onResume + پل netDied() از وب.
        // v1.6.0 (versionCode 20) — دیرکتیو مالک: «VPN/سوییچ شبکه = هیچ رویداد»:
        //           منطق خودترمیمی v1.5 (پروب + recreate) کامل حذف شد — خودش منبع
        //           دو باگ شده بود: recreate صفحه را از نو بارگذاری می‌کرد → کاربر
        //           وسط مدال خرید/تحلیل آنبوردینگ بیرون می‌افتاد (یک‌بار OTP،
        //           یک‌بار گیر اسپلش). حالا با سوییچ VPN/شبکه هیچ کاری انجام
        //           نمی‌شود (مثل همهٔ اپ‌های استاندارد دنیا) + نگهبان اسپلش
        //           ۱۵ثانیه‌ای (هرگز روی اسپلش گیر نمی‌کند) + بازگشت دقیق به
        //           تحلیل/مدال خرید در سمت وب (فلگ فاز تحلیل).
        // v1.7.0 (versionCode 21) — فیکس P0 «صفحهٔ سفید ابدی» (گزارش مالک + کاربران):
        //           بعد از آپدیت سایت، اپ صفحهٔ سفید می‌شد و حتی با بستن/بازکردن
        //           بالا نمی‌آمد. ریشه: HTML کش‌شده به چانک‌های JS حذف‌شدهٔ بیلد
        //           قبلی اشاره می‌کرد → هیچ JSی اجرا نمی‌شد. سمت سایت حالا HTML
        //           همیشه no-store است (هرگز کش نمی‌شود) + نگهبان صفحهٔ سفید:
        //           ۸ ثانیه بعد از لود اگر صفحه عملاً خالی بود → پاک‌سازی کش
        //           (کوکی‌ها دست‌نخورده) + reload؛ باز هم خالی → صفحهٔ خطای فارسی.
    // v1.10.0 (code 24) — v171 سند بازطراحی جریان پرداخت:
    //   • لینک میانی پرداخت (/pay/start و /wallet/topup/start) در Chrome Custom Tabs
    //   • چک VPN قبل از باز شدن درگاه (TRANSPORT_VPN) + دیالوگ فارسی
    //   • دیپ‌لینک رسید: fitup://payment/success | fitup://wallet/success
    // v1.11.0 (code 25) — v172 سند زنده‌سازی پنل کاربری (Real-Time Panel):
    //   • SSE /api/panel/stream — پنل همیشه زنده بدون رفرش دستی (< ۲ ثانیه)
    //   • onResume/onPause: webView.onResume/Pause + resume/pauseTimers
    //   • پل JS جدید: FitUpNative.refreshSection(section) — رفرش هدفمند بخش
    //   • دیپ‌لینک رسید وقتی اپ باز است: بدون رفرش کل صفحه (refresh-section)
    //   • netRescue: اطلاع به JS برای وصل دوبارهٔ اتصال زنده
    //   • دکمهٔ شارژ کیف پول اینستاگرام به حالت قبل برگشت (سمت سایت)
    // v1.12.0 (code 26) — v174 سند پل native پرداخت (ضد «VPN خاموش → دکمهٔ پرداخت مرده»):
    //   • پل JS جدید: FitUpNative.startPaymentNative(planId) — دو درخواست
    //     checkout + bridge-token با استک جاوا (جدا از Chromium) + Custom Tabs
    //   • شکست پل → رویداد fitup:native-payment-failed → فال‌بک کامل به جریان وب
    //   • اپ کافه‌بازار صفر تغییر
    // v1.13.0 (code 27) — v175 سند پل native شارژ کیف پول (هم‌الگوی v174):
    //   • پل JS جدید: FitUpNative.startWalletTopupNative(amount) — دو درخواست
    //     /api/wallet + bridge-token با استک جاوا + Custom Tabs (چک VPN + بازهٔ
    //     مبلغ ۱۰هزار تا ۱۰میلیون تومان قبل از هر درخواست)
    //   • خرید پلن (v174) و همهٔ فلوهای دیگر صفر تغییر
    versionCode = 28
    versionName = "1.14.0"

        // ⚙️ آدرس سایت (پنل کاربری) — اپ فقط این دامنه را باز می‌کند
        // (به‌علاوهٔ درگاه پرداخت زرین‌پال/شاپرک که در WebView مجازند)
        buildConfigField("String", "SITE_URL", "\"https://fittup.ir\"")
        // 🔑 کلید bridge ورود خودکار OTP — مقدار = OTP_BRIDGE_SECRET سرور (با تأیید مالک)
        buildConfigField("String", "OTP_BRIDGE_SECRET", "\"qQF51iWFt1rF6ZsacFQJqigxvfiJJ5sg6I3e_vGu2d4\"")
        // 🔒 v124 (ممیزی امنیتی F1) — کلید bridge OTP حذف شد: سرور دیگر هرگز کد
        // OTP را در پاسخ برنمی‌گرداند (الگوی bridge = راز سمت کلاینت = عمومی).
        // ورود کاربران اپ با تایپ کد پیامکی انجام می‌شود؛ مسیر استاندارد آینده:
        // SMS Retriever با هش اپ در متن پیامک.
    }

    signingConfigs {
        create("release") {
            // همان keystore اپ بازار — هویت یک توسعه‌دهنده (فیتاپ)، پکیج متفاوت
            storeFile = file("../keystore/fitup-release.keystore")
            storePassword = System.getenv("FITUP_KEYSTORE_PASSWORD") ?: "FitUpBazaar2026!"
            keyAlias = System.getenv("FITUP_KEY_ALIAS") ?: "fitup"
            keyPassword = System.getenv("FITUP_KEY_PASSWORD") ?: "FitUpBazaar2026!"
        }
    }

    buildTypes {
        release {
            isMinifyEnabled = true          // کوچک‌تر و بهینه‌تر
            isShrinkResources = true
            proguardFiles(
                getDefaultProguardFile("proguard-android-optimize.txt"),
                "proguard-rules.pro"
            )
            signingConfig = signingConfigs.getByName("release")
        }
        debug {
            applicationIdSuffix = ".debug"
        }
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
    kotlinOptions {
        jvmTarget = "17"
    }
    buildFeatures {
        buildConfig = true
        viewBinding = true
    }
}

dependencies {
    implementation("androidx.core:core-ktx:1.13.1")
    implementation("androidx.appcompat:appcompat:1.7.0")
    implementation("androidx.activity:activity-ktx:1.9.1")
    implementation("androidx.webkit:webkit:1.11.0")
    implementation("androidx.swiperefreshlayout:swiperefreshlayout:1.1.0")
    // v31 — اعلان‌های پس‌زمینه کم‌مصرف (Doze-safe) — بدون Firebase/سرویس خارجی
    implementation("androidx.work:work-runtime-ktx:2.9.1")
    // v1.4 (Task 2-d) — FCM push: «اعلان‌ها حتی وقتی اپ کلاً بسته است».
    // عمداً بدون google-services plugin و بدون google-services.json —
    // FirebaseApp به‌صورت دستی در MainActivity با مقادیر strings.xml
    // (fcm_app_id/fcm_api_key/fcm_project_id/fcm_sender_id) راه‌اندازی می‌شود؛
    // اگر آن مقادیر خالی باشند، FCM کلاً بی‌صدا رد می‌شود (graceful skip)
    implementation("com.google.firebase:firebase-messaging:24.0.0")
    // v31 — SMS Retriever رسمی گوگل (فقط کلاینت — بدون پرمیشن، بدون google-services)
    implementation("com.google.android.gms:play-services-auth:21.2.0")
    // v1.10 (v171 — سند بازطراحی جریان پرداخت) — Chrome Custom Tabs برای درگاه پرداخت
    implementation("androidx.browser:browser:1.8.0")
    // ⚠️ پولکی/IAB بازار ندارد — پرداخت از درگاه خود سایت (زرین‌پال) داخل WebView
}
