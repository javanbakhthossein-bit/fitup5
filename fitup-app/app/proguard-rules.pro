# پل جاوااسکریپت — کلاس داخلی MainActivity$NativeBridge از JS صدا زده می‌شود
# ⚠️ پکیج اپ «اختصاصی» ir.fittup.panel است (این فایل قبلاً از پروژهٔ بازار
# کپی شده بود و ir.fittup.app نگه داشته بود — برای R8 بی‌اثر بود!)
-keep class ir.fittup.panel.MainActivity$NativeBridge { *; }
-keepclassmembers class ir.fittup.panel.MainActivity$NativeBridge {
    @android.webkit.JavascriptInterface <methods>;
}

# خطاهای benign کتابخانه‌های وب‌کیت/اندروید
-dontwarn android.webkit.**
