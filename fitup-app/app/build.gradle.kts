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
        // ⚠️ نسخهٔ نصب‌شدهٔ کاربران باید ≥ این بیلد باشد تا ورود خودکار OTP کار کند.
        versionCode = 14
        versionName = "1.3.1"

        // ⚙️ آدرس سایت (پنل کاربری) — اپ فقط این دامنه را باز می‌کند
        // (به‌علاوهٔ درگاه پرداخت زرین‌پال/شاپرک که در WebView مجازند)
        buildConfigField("String", "SITE_URL", "\"https://fittup.ir\"")
        // v1.3.0 — کلید bridge ورود خودکار OTP: سرور با تطبیق این کلید (که صفحهٔ
        // وب از FitUpNative.getOtpBridgeKey می‌گیرد) کد را در پاسخ send-otp
        // برمی‌گرداند → کد بدون تایپ/دکمه جا می‌افتد و کاربر مستقیم وارد پنل می‌شود.
        // ⚠️ مقدار باید دقیقاً با OTP_BRIDGE_SECRET در .env سرور یکی باشد.
        buildConfigField(
            "String",
            "OTP_BRIDGE_SECRET",
            "\"qQF51iWFt1rF6ZsacFQJqigxvfiJJ5sg6I3e_vGu2d4\""
        )
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
    // ⚠️ پولکی/IAB بازار ندارد — پرداخت از درگاه خود سایت (زرین‌پال) داخل WebView
}
