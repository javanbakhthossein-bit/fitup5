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
import androidx.work.Constraints
import androidx.work.ExistingPeriodicWorkPolicy
import androidx.work.ExistingWorkPolicy
import androidx.work.NetworkType
import androidx.work.OneTimeWorkRequestBuilder
import androidx.work.PeriodicWorkRequestBuilder
import androidx.work.WorkManager
import androidx.work.Worker
import androidx.work.WorkerParameters
import org.json.JSONObject
import java.net.HttpURLConnection
import java.net.URL
import java.net.URLEncoder
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale
import java.util.TimeZone
import java.util.concurrent.TimeUnit

/**
 * NotificationSync (v31) — «اعلان‌ها حتی وقتی برنامه بسته است»
 *
 * معماری کم‌مصرف و بازار-پسند (بدون سرویس خارجی اجباری):
 *  - WorkManager هر ۱۵ دقیقه (v1.4 / Task 2-d — قبلاً ۱ ساعت) + هر بار
 *    باز شدن اپ (syncNow از onCreate و پل وب) با کوکی سشن کاربر
 *    /api/app/notifications/sync را صدا می‌زند. فاصلهٔ ۱۵ دقیقه‌ای (حداقلِ
 *    مجاز PeriodicWork) فال‌بک سریع‌تر برای وقتی است که FCM هنوز تنظیم
 *    نشده است؛ با FCM فعال، این سینک فقط نقش safety-net دارد (پیام همان
 *    لحظه از مسیر گوگل می‌رسد — حتی وقتی پروسهٔ اپ کلاً بسته است).
 *  - اعلان‌های جدیدِ بعد از «since» که قبلاً نشان داده نشده‌اند، به‌صورت
 *    نوتیف محلی روی کانال «fitup_general» نمایش داده می‌شوند.
 *  - وب/PWA مثل قبل از VAPID push استفاده می‌کند؛ این مسیر فقط برای اپ نیتیو است.
 */
object NotificationSync {

    private const val PERIODIC_NAME = "fitup_notif_sync"
    private const val ONESHOT_NAME = "fitup_notif_sync_now"

    const val PREFS = "fitup_notif_sync"
    const val KEY_SHOWN = "shown_ids"
    const val KEY_SINCE = "last_since"

    /** زمان‌بندی دوره‌ای هر ۱۵ دقیقه (v1.4 / Task 2-d — idempotent با UPDATE تا فاصلهٔ جدید اعمال شود) */
    fun schedulePeriodic(context: Context) {
        try {
            val constraints = Constraints.Builder()
                .setRequiredNetworkType(NetworkType.CONNECTED)
                .build()
            // ۱۵ دقیقه = حداقل فاصلهٔ مجاز PeriodicWorkRequest (مقدار کمتر → خطا)
            val req = PeriodicWorkRequestBuilder<NotificationSyncWorker>(15, TimeUnit.MINUTES)
                .setConstraints(constraints)
                .build()
            // v65 — UPDATE (نه KEEP): اگر نسخهٔ قبلی اپ با فاصلهٔ قدیمی کار را
            // ثبت کرده بود، نصب آپدیت باید فاصلهٔ جدید (۱۵ دقیقه) را جایگزین کند.
            WorkManager.getInstance(context)
                .enqueueUniquePeriodicWork(PERIODIC_NAME, ExistingPeriodicWorkPolicy.UPDATE, req)
        } catch (e: Exception) {
            Log.w("FitUpApp", "notif schedule failed: ${e.message}")
        }
    }

    /** همگام‌سازی فوری (در باز شدن اپ / از پل وب) */
    fun syncNow(context: Context) {
        try {
            val req = OneTimeWorkRequestBuilder<NotificationSyncWorker>().build()
            WorkManager.getInstance(context)
                .enqueueUniqueWork(ONESHOT_NAME, ExistingWorkPolicy.REPLACE, req)
        } catch (e: Exception) {
            Log.w("FitUpApp", "notif syncNow failed: ${e.message}")
        }
    }

    /** ISO-UTC فعلی (minSdk 24 — بدون java.time) */
    fun nowIso(): String {
        val fmt = SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss'Z'", Locale.US)
        fmt.timeZone = TimeZone.getTimeZone("UTC")
        return fmt.format(Date())
    }
}

class NotificationSyncWorker(appContext: Context, params: WorkerParameters) :
    Worker(appContext, params) {

    override fun doWork(): Result {
        return try {
            val site = BuildConfig.SITE_URL.trimEnd('/')
            val prefs = applicationContext.getSharedPreferences(NotificationSync.PREFS, Context.MODE_PRIVATE)
            val since = prefs.getString(NotificationSync.KEY_SINCE, null)
            val url = site + "/api/app/notifications/sync" +
                (if (!since.isNullOrBlank()) "?since=" + URLEncoder.encode(since, "UTF-8") else "")

            val conn = (URL(url).openConnection() as HttpURLConnection).apply {
                connectTimeout = 10_000
                readTimeout = 15_000
                setRequestProperty("Accept", "application/json")
                setRequestProperty("User-Agent", "FitUpApp/${BuildConfig.VERSION_NAME}")
                try {
                    val cookie = android.webkit.CookieManager.getInstance().getCookie(site)
                    if (!cookie.isNullOrBlank()) setRequestProperty("Cookie", cookie)
                } catch (_: Exception) {}
            }
            val status = conn.responseCode
            if (status != 200) {
                conn.disconnect()
                return Result.retry()
            }
            val body = conn.inputStream.bufferedReader().use { it.readText() }
            conn.disconnect()

            val root = JSONObject(body)
            val arr = root.optJSONArray("notifications")
            val serverTime = root.optString("serverTime", NotificationSync.nowIso())

            if (arr != null && arr.length() > 0) {
                val shown = prefs.getStringSet(NotificationSync.KEY_SHOWN, mutableSetOf())?.toMutableSet()
                    ?: mutableSetOf()
                var delivered = 0
                for (i in 0 until arr.length()) {
                    val n = arr.optJSONObject(i) ?: continue
                    val id = n.optString("id")
                    if (id.isNullOrEmpty() || shown.contains(id)) continue
                    // چت مربی فقط داخل اپ — همان فیلتر پل live وب
                    if (n.optString("type") == "coach") continue
                    if (showNotification(
                            n.optString("title", "فیتاپ"),
                            n.optString("body", ""),
                            n.optString("link", "")
                        )
                    ) {
                        shown.add(id)
                        delivered++
                    }
                    // سقف ضداسپم در هر سینک
                    if (delivered >= 10) break
                }
                // نگه‌داشتن حداکثر ۲۰۰ شناسه آخر
                val toStore = if (shown.size > 200) shown.toList().takeLast(200).toSet() else shown
                prefs.edit()
                    .putStringSet(NotificationSync.KEY_SHOWN, toStore)
                    .putString(NotificationSync.KEY_SINCE, serverTime)
                    .apply()
            } else {
                prefs.edit().putString(NotificationSync.KEY_SINCE, serverTime).apply()
            }
            Result.success()
        } catch (e: Exception) {
            Log.w("FitUpApp", "notif sync failed: ${e.message}")
            Result.retry()
        }
    }

    private fun showNotification(title: String, body: String, link: String): Boolean {
        try {
            val ctx = applicationContext
            if (Build.VERSION.SDK_INT >= 33 &&
                ContextCompat.checkSelfPermission(ctx, android.Manifest.permission.POST_NOTIFICATIONS) !=
                PackageManager.PERMISSION_GRANTED
            ) {
                return false // بدون مجوز، بی‌صدا — مثل پل live
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
            return true
        } catch (e: Exception) {
            Log.w("FitUpApp", "local notif failed: ${e.message}")
            return false
        }
    }
}
