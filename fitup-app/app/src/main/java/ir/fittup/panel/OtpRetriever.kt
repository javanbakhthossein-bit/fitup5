package ir.fittup.panel

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.util.Log
import com.google.android.gms.auth.api.phone.SmsRetriever
import com.google.android.gms.common.api.CommonStatusCodes
import com.google.android.gms.common.api.Status

/**
 * OtpRetriever (v31) — ورود خودکار کد پیامک «بدون هیچ پرمیشنی»
 *
 * SMS Retriever رسمی Google (Play Services): پیامکی که متنش با هش ۱۱-کاراکتری
 * اپ امضا شده باشد (سمت سرور — ارسال خام sms.ir با SMSIR_USE_RAW_SEND=true)
 * مستقیم به همین BroadcastReceiver تحویل می‌شود؛ بدون RECEIVE_SMS، بدون
 * خواندن صندوق پیام، بدون دیالوگ رضایت — دقیقاً همان مسیر امنی که واتساپ/
 * تلگرام استفاده می‌کنند. روی دستگاه‌های بدون سرویس گوگل هم fail-safe است
 * (فقط فعال نمی‌شود؛ ورود دستی/کلیپ‌بورد/پیشنهاد کیبورد سر جایشان هستند).
 */
object OtpRetriever {

    private const val PREFS = "fitup_otp"
    private const val KEY_PENDING = "pending_code"

    /** زنده وقتی MainActivity در حافظه است — تزریق مستقیم کد به WebView */
    @Volatile
    var dispatcher: ((String) -> Unit)? = null

    /** کد رسیده را تحویل بده (فوراً اگر اکتیویتی زنده است، وگرنه در prefs برای onResume) */
    fun deliver(context: Context?, code: String) {
        val activity = dispatcher
        if (activity != null) {
            activity(code)
        } else {
            // اکتیویتی در حافظه نیست (پردازش زنده است) — برای onResume نگه دار
            try {
                context?.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
                    ?.edit()?.putString(KEY_PENDING, code)?.apply()
            } catch (_: Exception) {}
        }
    }

    /** در onResume اکتیویتی — کد منتظرِ مانده از زمان بسته‌بودن اکتیویتی */
    fun takePending(context: Context): String? {
        return try {
            val prefs = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
            val code = prefs.getString(KEY_PENDING, null)
            if (code != null) prefs.edit().remove(KEY_PENDING).apply()
            code
        } catch (_: Exception) {
            null
        }
    }
}

class OtpRetrieverReceiver : BroadcastReceiver() {

    override fun onReceive(context: Context, intent: Intent) {
        if (SmsRetriever.SMS_RETRIEVED_ACTION != intent.action) return
        try {
            val extras = intent.extras ?: return
            @Suppress("DEPRECATION")
            val status = extras.get(SmsRetriever.EXTRA_STATUS) as? Status ?: return
            when (status.statusCode) {
                CommonStatusCodes.SUCCESS -> {
                    val message = extras.getString(SmsRetriever.EXTRA_SMS_MESSAGE)
                    if (message.isNullOrBlank()) return
                    // اولین عدد ۴-رقمی مستقل در متن پیامک = کد (متن سرور: «کد ورود فیتاپ: 1234 …»)
                    val code = Regex("(?<!\\d)\\d{4}(?!\\d)").find(message)?.value ?: return
                    Log.i("FitUpApp", "OTP received via SMS Retriever")
                    OtpRetriever.deliver(context, code)
                }
                CommonStatusCodes.TIMEOUT -> {
                    // ۵ دقیقه بدون پیامک امضاشده — طبیعی؛ صفحه بعدی دوباره فعال می‌کند
                    Log.i("FitUpApp", "SMS Retriever timeout")
                }
            }
        } catch (e: Exception) {
            Log.w("FitUpApp", "otp receiver failed: ${e.message}")
        }
    }
}
