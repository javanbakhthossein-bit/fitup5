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
        // ⚠️ نسخهٔ منتشرشده در بازار باید ≥ این بیلد باشد تا ورود خودکار OTP کار کند.
        versionCode = 15
        versionName = "1.5.9"

        // ⚙️ تنظیمات FitUp — قبل از ساخت نهایی این مقادیر را بررسی/تغییر دهید:
        // آدرس سایت (پنل کاربری) — اپ فقط این دامنه را باز می‌کند
        buildConfigField("String", "SITE_URL", "\"https://fittup.ir\"")
        // v1.5.8 — کلید bridge ورود خودکار OTP: سرور با تطبیق این کلید (که صفحهٔ
        // وب از FitUpNative.getOtpBridgeKey می‌گیرد) کد را در پاسخ send-otp
        // برمی‌گرداند → کد بدون تایپ/دکمه جا می‌افتد و کاربر مستقیم وارد پنل می‌شود.
        // ⚠️ مقدار باید دقیقاً با OTP_BRIDGE_SECRET در .env سرور یکی باشد.
        buildConfigField(
            "String",
            "OTP_BRIDGE_SECRET",
            "\"qQF51iWFt1rF6ZsacFQJqigxvfiJJ5sg6I3e_vGu2d4\""
        )
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
    // v31 — اعلان‌های پس‌زمینه کم‌مصرف (Doze-safe) — بدون Firebase/سرویس خارجی
    implementation("androidx.work:work-runtime-ktx:2.9.1")
    // v31 — SMS Retriever رسمی گوگل (فقط کلاینت — بدون پرمیشن)
    implementation("com.google.android.gms:play-services-auth:21.2.0")
    // پولکی — کتابخانه رسمی پرداخت درون‌برنامه‌ای کافه‌بازار
    implementation("com.github.cafebazaar.Poolakey:poolakey:2.2.0")
}
