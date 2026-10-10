plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
}

android {
    namespace = "ir.fittup.app"
    compileSdk = 34

    defaultConfig {
        applicationId = "ir.fittup.app"
        minSdk = 24
        targetSdk = 34
        // v1.5.4 — App Links (باز شدن https://fittup.ir داخل اپ) + لینک اعلان‌ها
        // (تپ اعلان به صفحهٔ مقصد می‌رود) + پرمیشن صریح RECEIVE_BOOT_COMPLETED +
        // سخت‌سازی ضد intent-redirection در handleExternalScheme (هم‌تراز اپ اختصاصی).
        // v1.5.3 — فیکس ریجکشن کافه‌بازار: کل جریان چک نسخه/آپدیت حذف شده بود — اپِ بازار
        // هرگز هیچ پیام/دیالوگ/توست به‌روزرسانی نشان نمی‌دهد (به‌روزرسانی فقط از طریق
        // خود بازار انجام می‌شود) + دیالوگ تأیید خروج برندشدهٔ سفارشی.
        // v1.5.6 — دانلود فایل‌های data: (PNG/PDF برنامه‌ها) از پل MediaStore؛
        // لینک‌های http(s)/APK عمداً گرفته نمی‌شوند (سیاست آپدیت بازار).
        // v1.5.8 (کد ۱۴) — کلید bridge ورود خودکار OTP (FitUpNative.getOtpBridgeKey)
        // + v63 سمت وب: کلید هم در هدر و هم در body می‌رود؛ سرور لاگ عیب‌یابی دارد.
        // v1.5.9 (کد ۱۵) — v65: سینک نوتیف در اپ بسته از هر ۶ ساعت به هر ۱ ساعت
        // (WorkManager با ExistingPeriodicWorkPolicy.UPDATE) — باگ «نوتیف در اپ
        // بسته نمی‌رسد».
        // v120 (کد ۱۶) — رفع تذکر کافه‌بازار (روی کد ۱۵): «دوربین در همه‌جا» —
        // شیت «دوربین/گالری» در همهٔ نقاط آپلود سایت + پشتیبانی
        // isCaptureEnabled/ACTION_IMAGE_CAPTURE (FileProvider) در MainActivity →
        // مجوز CAMERA حالا واقعاً استفاده می‌شود و سایت هم گالری دارد هم دوربین.
        // ⚠️ نسخهٔ منتشرشده در بازار باید ≥ این بیلد باشد تا ورود خودکار OTP کار کند.
        // v1.6.1 (versionCode 17) — مجوز GPS مسیریاب + خودترمیمی شبکه (تغییر IP)
        // v1.6.2 (versionCode 18) — ریشه‌درمانی «VPN خاموش → اپ کلاً قطع می‌شد و باید
        //           خارج/وارد می‌شدی»: registerDefaultNetworkCallback + هند‌آف بی‌سکوت
        //           (۲.۵ ثانیه بعد از onLost اگر شبکه فعال بود → reload) + debounce ۴s.
        // v1.7.0 (versionCode 19) — خودترمیمی «سخت» شبکه (بار سوم، ریشه‌ای):
        //           reload کافی نبود چون استخر سوکت/کش DNS کرومیوم همان تونل مرده را
        //           دور می‌زد. حالا: پروب واقعی HTTP (۳ تلاش) → در صورت سالم‌بودن
        //           شبکه از بیرون → recreate() (معادل بستن/بازکردن اپ، بدون خروج
        //           کاربر؛ کوکی/سشن می‌ماند) + گارد onResume + پل netDied() از وب.
        // v1.8.0 (versionCode 20) — دیرکتیو مالک: «VPN/سوییچ شبکه = هیچ رویداد»:
        //           منطق خودترمیمی v1.7 کامل حذف شد — recreate صفحه را رفرش می‌کرد
        //           و کاربر از مدال خرید/تحلیل بیرون می‌افتاد (OTP/گیر اسپلش).
        //           حالا با سوییچ شبکه هیچ کاری انجام نمی‌شود + نگهبان اسپلش
        //           ۱۵ثانیه‌ای + بازگشت دقیق به تحلیل/مدال خرید در سمت وب.
        // v1.9.0 (versionCode 21) — فیکس P0 «صفحهٔ سفید ابدی» (گزارش مالک + کاربران):
        //           بعد از آپدیت سایت، اپ صفحهٔ سفید می‌شد و حتی با بستن/بازکردن
        //           بالا نمی‌آمد. ریشه: HTML کش‌شده به چانک‌های JS حذف‌شدهٔ بیلد
        //           قبلی اشاره می‌کرد → هیچ JSی اجرا نمی‌شد. سمت سایت حالا HTML
        //           همیشه no-store است (هرگز کش نمی‌شود) + نگهبان صفحهٔ سفید:
        //           ۸ ثانیه بعد از لود اگر صفحه عملاً خالی بود → پاک‌سازی کش
        //           (کوکی‌ها دست‌نخورده) + reload؛ باز هم خالی → صفحهٔ خطای فارسی.
        // v1.12.0 (code 24) — v172 سند زنده‌سازی پنل کاربری (Real-Time Panel):
        //   • SSE /api/panel/stream — پنل همیشه زنده بدون رفرش دستی (< ۲ ثانیه)
        //   • onResume/onPause: webView.onResume/Pause + resume/pauseTimers
        //   • پل JS جدید: FitUpNative.refreshSection(section) — رفرش هدفمند بخش
        //   • netRescue: اطلاع به JS برای وصل دوبارهٔ اتصال زنده
        //   • ⛔ جریان پرداخت درون‌برنامه‌ای بازار: صفر تغییر (دکمه/مسیر/callback)
        // v1.15.2 (code 29) — چرخش امنیتی کلید bridge ورود خودکار OTP (ممیزی v202-H1):
        //           بیلدهای جدید با کلید جدید؛ سرور موقتاً هر دو کلید را می‌پذیرد
        //           (OTP_BRIDGE_LEGACY_SECRETS). صفر تغییر کاربردی — پرداخت درون‌برنامه‌ای
        //           بازار و همهٔ امکانات دست‌نخورده.
        // v1.15.4 (code 31) — درمان ریشه‌ای سناریوی FakeDNS: LoopbackProxy — همهٔ
        //           ترافیک WebView از پراکسی داخلی ۱۲۷.۰.۰.۱ رد می‌شود؛ WebView هرگز
        //           خودش DNS حل نمی‌کند + شست‌وی سوکت‌های بالادستی در لحظهٔ تغییر شبکه.
        //           با هر VPN — حتی FakeDNS روشن — برگشت ۱-۲ ثانیه‌ای. صفر تغییر ظاهری.
        // v1.15.5 (code 32) — v207 درمان ریشه‌ای «تخفیف‌ها در درگاه بازار اعمال نشد»:
        //           تغییرات فقط سمت سرور/وب است (این اپ فقط شمارهٔ نسخه بالا می‌رود):
        //           توکن تخفیف صفحهٔ تحلیل به مسیر قیمت پویا وصل شد + هر خطای ثبت
        //           قیمت تخفیف‌دار حالا خرید را متوقف می‌کند (هرگز قیمت کامل بی‌صدا)
        //           + زمان‌بندی شروع کدهای پیامکی (validFrom) رعایت می‌شود.
        // v1.15.6 (code 33) — v211 درمان ریشه‌ای «اطلاعات ارسالی برنامه برای پرداخت
        //           نامعتبر است» (رد JWT تخفیف پویا توسط بازار):
        //           ① پل JS جدید fitupBazaarSkuPrice(sku) — قیمت نمایشی واقعی SKU
        //             از خودِ بازار (Poolakey getInAppSkuDetails) → مودال سایت همان
        //             مبلغی را نشان می‌دهد که پنجرهٔ پرداخت بازار نشان می‌دهد و
        //             سرور مبلغ JWT را از سقف واقعی پیشخان می‌سازد (ضد خطای ۱۰).
        //           ② پل getBazaarVersion() — گیت نسخهٔ بازار (تخفیف پویا فقط
        //             در بازار ۱۳.۳.۰+ پشتیبانی می‌شود؛ پایین‌تر درگاه رد می‌کند).
        //           ③ صفر تغییر در جریان خود پرداخت (startBazaarPurchase/consume
        //             دست‌نخورده) — فقط خواندنی‌های جدید برای سایت.
        // v1.15.7 (v222) — اتصال خودکار بدون صفحهٔ خطا (همسان با own 1.17.6):
        //           «اتصال برقرار نیست» حذف شد؛ نمای «در حال اتصال…» + پروب مستقل
        //           + reload خودکار + بیداری شبکه در onResume.
        // v1.16.0 (versionCode 35) — FCM واقعی فعال شد (هم‌پروژهٔ Firebase مالک
        //           fittup-71d6d — اپ اندروید دوم با پکیج ir.fittup.app):
        //           «اعلان‌ها حتی وقتی اپ کلاً بسته است» از مسیر گوگل؛ روی
        //           گوشی‌های بدون سرویس گوگل کاملاً بی‌صدا رد می‌شود و اپ
        //           دقیقاً مثل قبل با سینک WorkManager کار می‌کند (graceful).
        versionCode = 39 // v1.17.3 (v227) — تشخیص پوش: پل وضعیت مجوز اعلان (notificationPermissionStatus) + seed تازه با فیکس بک مودال برنامه‌ها
        versionName = "1.17.3"

        // ⚙️ تنظیمات FitUp — قبل از ساخت نهایی این مقادیر را بررسی/تغییر دهید:
        // آدرس سایت (پنل کاربری) — اپ فقط این دامنه را باز می‌کند
        buildConfigField("String", "SITE_URL", "\"https://fittup.ir\"")
        // 🔑 کلید bridge ورود خودکار OTP (v1.5.8) — مقدار = OTP_BRIDGE_SECRET سرور.
        // سرور با سخت‌سازی‌های ۵گانه (UA نیتیو + سقف روزانه + غیرادمین) کد را در
        // پاسخ send-otp برمی‌گرداند تا کاربر اپ بدون تایپ وارد شود — با تأیید مالک.
        buildConfigField("String", "OTP_BRIDGE_SECRET", "\"A38Y83RBNvvCzBbQeLmaBKinMKWC7NS4ViMTRLqZ\"")
        // کلید عمومی RSA پرداخت درون‌برنامه‌ای — از پیشخان توسعه‌دهندگان بازار (قرار داده شده ✓)
        // بعد از تعویض کلید، versionCode را یکی بالا ببرید و دوباره بیلد/امضا کنید.
        buildConfigField(
            "String",
            "BAZAAR_RSA_PUBLIC_KEY",
            "\"MIHNMA0GCSqGSIb3DQEBAQUAA4G7ADCBtwKBrwDI6I3QKZLtAOura5/Ij4MTPlNJ7v9J0znWW1bMcRG54abj/V/FM7pj9F058QhNGcx6qu0moEegqZRvO8er08CWCdgklkdGbzaYLziKrKHql5Os4MAtAjM26juZ+o6F8WvnnoI3g6wG7HBagV73YaNS3eDTatWBoAkMzjchVKSZj/6rRGaRv5d+cfNyyzCCmASD/sk9dQkxH1g+dVFVzUqTdtey+uOxqbONGBJiHdUCAwEAAQ==\""
        )
    }

    signingConfigs {
        create("release") {
            // keystore و رمزها — برای بیلد release الزامی است.
            // مسیر/رمز را مطابق راهنمای PUBLISH-GUIDE.md تنظیم کنید.
            storeFile = file("../keystore/fitup-release.keystore")
            storePassword = System.getenv("FITUP_KEYSTORE_PASSWORD") ?: "FitUpBazaar2026!"
            keyAlias = System.getenv("FITUP_KEY_ALIAS") ?: "fitup"
            keyPassword = System.getenv("FITUP_KEY_PASSWORD") ?: "FitUpBazaar2026!"
        }
    }

    buildTypes {
        release {
            isMinifyEnabled = true          // کوچک‌تر و بهینه‌تر — مطابق توصیه بازار
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
    // v31 — اعلان‌های پس‌زمینه کم‌مصرف (Doze-safe) — فال‌بک بدون Firebase
    implementation("androidx.work:work-runtime-ktx:2.9.1")
    // v1.16.0 (v223) — FCM: «اعلان‌ها حتی وقتی اپ کلاً بسته است» (هم‌الگوی اپ
    // اختصاصی). عمداً بدون google-services plugin و بدون google-services.json —
    // FirebaseApp به‌صورت دستی در MainActivity با مقادیر strings.xml
    // (fcm_app_id/fcm_api_key/fcm_project_id/fcm_sender_id) راه‌اندازی می‌شود؛
    // اگر آن مقادیر خالی باشند یا گوشی سرویس گوگل نداشته باشد، FCM کلاً
    // بی‌صدا رد می‌شود (graceful skip) و WorkManager فال‌بک می‌ماند.
    implementation("com.google.firebase:firebase-messaging:24.0.0")
    // v31 — SMS Retriever رسمی گوگل (فقط کلاینت — بدون پرمیشن)
    implementation("com.google.android.gms:play-services-auth:21.2.0")
    // پولکی — کتابخانه رسمی پرداخت درون‌برنامه‌ای کافه‌بازار
    implementation("com.github.cafebazaar.Poolakey:poolakey:2.2.0")
}
