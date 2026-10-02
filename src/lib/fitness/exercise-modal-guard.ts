/**
 * exercise-modal-guard.ts — گارد «بستنِ دو مرحله‌ای» مدال توضیحات حرکت (v118)
 *
 * باگ (گزارش مالک): در تب برنامه‌ها، وقتی مدال توضیحات حرکت روی مدال برنامه
 * باز است، زدن دکمهٔ «بستن» هر دو مدال را می‌بست و کاربر به لیست برنامه‌ها
 * برمی‌گشت (دو مرحله به عقب به‌جای یک مرحله).
 *
 * ریشه: هر دو مدال، Dialog های Radix و هم‌سطح‌اند (هر دو portal مستقل به body).
 * روی لمس، ردِ لایهٔ بیرونی به اولین click موکول می‌شود؛ همان click ای که
 * دکمهٔ «بستن» مدال داخلی را می‌بندد، بعد از unmount شدن مدال داخلی به
 * لایهٔ بیرونی هم می‌رسد و آن را هم می‌بندد (مسابقهٔ state — در لحظهٔ فراخوانی
 * onOpenChange بیرونی، state مدال داخلی قبلاً null شده است).
 *
 * راه‌حل: مهر زمانی ماژول‌سطح — موقع بستن عمدی مدال داخلی ثبت می‌شود و
 * onOpenChange لایهٔ بیرونی (Sheet/Dialog والد) در همان ~۲۵۰ms آن dismiss
 * را نادیده می‌گیرد. هم در programs-view (مدال برنامه) و هم در main-app
 * (Sheet حالت باشگاه) اعمال می‌شود.
 */

const GUARD_WINDOW_MS = 250;
let lastIntentionalCloseAt = 0;

/** موقع بستن عمدی مدال داخلی (دکمهٔ بستن/بک‌دراپ/Esc) صدا زده شود */
export function markExerciseModalJustClosed(): void {
  lastIntentionalCloseAt = Date.now();
}

/** true = همین الان مدال داخلی بسته شده؛ dismiss بیرونی را نادیده بگیر */
export function wasExerciseModalJustClosed(): boolean {
  return Date.now() - lastIntentionalCloseAt < GUARD_WINDOW_MS;
}
