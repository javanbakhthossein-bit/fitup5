package ir.fittup.panel

import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.os.Build
import android.util.Log
import androidx.core.app.NotificationCompat
import androidx.core.content.ContextCompat
import com.google.firebase.messaging.FirebaseMessagingService
import com.google.firebase.messaging.RemoteMessage
import org.json.JSONObject
import java.io.OutputStreamWriter
import java.net.HttpURLConnection
import java.net.URL
import kotlin.concurrent.thread

/**
 * FcmService (v1.4 / Task 2-d) — «اعلان‌ها حتی وقتی اپ کلاً بسته است»
 *
 * درخواست مکرر مالک: با WorkManager اعلان‌ها تا ۱۵ دقیقه دیر می‌رسند و در
 * Doze شدید عقب می‌افتند؛ FCM پیام را از سمت گوگل همان لحظه تحویل می‌دهد حتی
 * وقتی پروسهٔ اپ کلاً بسته است. سرور در createNotification (notifications.ts)
 * پیام را به توکن‌های ثبت‌شده در DeviceToken می‌فرستد.
 *
 * راه‌اندازی Firebase دستی است (بدون google-services.json):
 * MainActivity در onCreate با مقادیر strings.xml (fcm_app_id/…) FirebaseApp
 * را می‌سازد و این سرویس با intent-filter MESSAGING_EVENT به SDK وصل است.
 * اگر آن مقادیر خالی باشند FirebaseApp هیچ‌وقت ساخته نمی‌شود → این سرویس
 * هیچ‌وقت صدا زده نمی‌شود و اپ دقیقاً مثل قبل (WorkManager) کار می‌کند.
 *
 * رفتار پیام:
 *  - اپ بسته/پس‌زمینه + payload از نوع notification → سیستم‌عامل خودش نوتیف
 *    می‌سازد (این متد صدا زده نمی‌شود)؛ کانال از meta-data
 *    com.google.firebase.messaging.default_notification_channel_id = fitup_general
 *    و data به‌صورت extras روی launch intent می‌آید (MainActivity با کلید
 *    fitup_link لینک را باز می‌کند — سرور هر دو کلید link/fitup_link می‌فرستد).
 *  - اپ باز (foreground) یا پیام data-only → onMessageReceived صدا زده می‌شود
 *    و نوتیف را با همان الگوی MainActivity.showNativeNotification می‌سازیم.
 */
class FcmService : FirebaseMessagingService() {

    /** توکن جدید FCM (اولین اجرا یا چرخش توکن) → ثبت روی سرور با کوکی سشن */
    override fun onNewToken(token: String) {
        super.onNewToken(token)
        try {
            FcmRegistration.postDeviceToken(applicationContext, token)
        } catch (e: Exception) {
            Log.w("FitUpApp", "fcm onNewToken failed: ${e.message}")
        }
    }

    override fun onMessageReceived(remoteMessage: RemoteMessage) {
        try {
            val data = remoteMessage.data
            val n = remoteMessage.notification
            // title/body از notification payload یا در صورت نبود از data
            val title = n?.title ?: data["title"] ?: "فیتاپ"
            val body = n?.body ?: data["body"] ?: ""
            if (title.isBlank() && body.isBlank()) return
            val link = data["fitup_link"] ?: data["link"] ?: ""
            showNotification(title, body, link)
        } catch (e: Exception) {
            Log.w("FitUpApp", "fcm onMessageReceived failed: ${e.message}")
        }
    }

    /** آینهٔ showNotification در NotificationSyncWorker — همان کانال/آیکون/intent */
    private fun showNotification(title: String, body: String, link: String) {
        try {
            val ctx = applicationContext
            if (Build.VERSION.SDK_INT >= 33 &&
                ContextCompat.checkSelfPermission(ctx, android.Manifest.permission.POST_NOTIFICATIONS) !=
                PackageManager.PERMISSION_GRANTED
            ) {
                return // بدون مجوز، بی‌صدا — مثل پل live
            }
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                val nm = ctx.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
                nm.createNotificationChannel(
                    NotificationChannel(
                        MainActivity.CHANNEL_ID,
                        "اعلان‌های فیتاپ",
                        NotificationManager.IMPORTANCE_DEFAULT
                    ).apply { description = "یادآوری‌ها و خبرهای برنامه" }
                )
            }
            // v1.2.5 — لینک نسبی اعلان (مثل "?tab=progress&section=checkup") همراه intent
            // می‌رود؛ روی تپ، MainActivity آن را به URL کامل تبدیل و داخل WebView باز می‌کند
            val open = Intent(ctx, MainActivity::class.java)
                .addFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP)
            if (!link.isNullOrBlank()) open.putExtra("fitup_link", link)
            val notification = NotificationCompat.Builder(ctx, MainActivity.CHANNEL_ID)
                .setSmallIcon(R.mipmap.ic_launcher)
                .setContentTitle(title)
                .setContentText(body)
                .setStyle(NotificationCompat.BigTextStyle().bigText(body))
                .setAutoCancel(true)
                .setContentIntent(
                    PendingIntent.getActivity(
                        ctx, 0, open,
                        PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
                    )
                )
                .build()
            val nm = ctx.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
            nm.notify((System.currentTimeMillis() % 100000).toInt(), notification)
        } catch (e: Exception) {
            Log.w("FitUpApp", "fcm local notif failed: ${e.message}")
        }
    }
}

/**
 * ثبت توکن FCM روی سرور — POST {SITE_URL}/api/app/device-token با کوکی سشن
 * WebView کاربر (الگوی HTTP دقیقاً مثل NotificationSyncWorker).
 * اگر کاربر لاگین نباشد سرور 401 می‌دهد و توکن ذخیره نمی‌شود؛ فراخوانی بعدی
 * (onNewToken / باز شدن اپ / پل syncDeviceToken بعد از ورود) دوباره تلاش می‌کند.
 */
object FcmRegistration {

    /** آتش-و-فراموش (fire-and-forget) — HTTP در thread پس‌زمینه (امن از NetworkOnMainThread) */
    fun postDeviceToken(context: Context, token: String) {
        try {
            val site = BuildConfig.SITE_URL.trimEnd('/')
            val payload = JSONObject().apply {
                put("token", token)
                put("platform", "android")
            }.toString()
            thread {
                var conn: HttpURLConnection? = null
                try {
                    val c = (URL(site + "/api/app/device-token").openConnection() as HttpURLConnection).apply {
                        requestMethod = "POST"
                        connectTimeout = 10_000
                        readTimeout = 15_000
                        doOutput = true
                        setRequestProperty("Content-Type", "application/json; charset=utf-8")
                        setRequestProperty("Accept", "application/json")
                        setRequestProperty("User-Agent", "FitUpApp/${BuildConfig.VERSION_NAME}")
                        try {
                            val cookie = android.webkit.CookieManager.getInstance().getCookie(site)
                            if (!cookie.isNullOrBlank()) setRequestProperty("Cookie", cookie)
                        } catch (_: Exception) {}
                    }
                    conn = c
                    OutputStreamWriter(c.outputStream, "UTF-8").use { it.write(payload) }
                    val status = c.responseCode
                    if (status == 200) {
                        Log.i("FitUpApp", "device-token registered")
                    } else {
                        Log.w("FitUpApp", "device-token post status=$status (کاربر لاگین نیست؟ — دوباره بعد از ورود تلاش می‌شود)")
                    }
                } catch (e: Exception) {
                    Log.w("FitUpApp", "device-token post failed: ${e.message}")
                } finally {
                    try { conn?.disconnect() } catch (_: Exception) {}
                }
            }
        } catch (e: Exception) {
            Log.w("FitUpApp", "device-token error: ${e.message}")
        }
    }
}
