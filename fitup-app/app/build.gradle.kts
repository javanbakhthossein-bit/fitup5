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
        // v1.2.2 — ریشه‌یابی باگ «دانلود نسخه جدید کار نمی‌کند»:
        // گیرندهٔ پایان-دانلود با RECEIVER_EXPORTED (باگ اندروید ۱۴+)،
        // وضعیت دانلود در SharedPreferences + safety-net در onResume،
        // دیالوگ شکست با «تلاش دوباره / دانلود با مرورگر»، توست دقیق.
        versionCode = 5
        versionName = "1.2.2"

        // ⚙️ آدرس سایت (پنل کاربری) — اپ فقط این دامنه را باز می‌کند
        // (به‌علاوهٔ درگاه پرداخت زرین‌پال/شاپرک که در WebView مجازند)
        buildConfigField("String", "SITE_URL", "\"https://fittup.ir\"")
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
    // ⚠️ پولکی/IAB بازار ندارد — پرداخت از درگاه خود سایت (زرین‌پال) داخل WebView
}
