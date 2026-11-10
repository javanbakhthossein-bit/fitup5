/**
 * v241 — «عکس زیبای مسیر» — دیرکتیو مالک:
 * «کاربر بعد از اتمام پیاده‌روی بتونه مسیری که در نقشه طی کرده رو مثل یک عکس
 * زیبا ببینه که روی نقشه چه مسیری رو رفته و همیشه در قسمت جزئیات اون جلسه بمونه.»
 *
 * این ماژول صفر وابستگی دارد (حتی Leaflet) و یک پوستر ۱۰۸۰×۱۳۵۰ PNG می‌سازد:
 *  • پس‌زمینه = تایل‌های واقعی OSM (Web Mercator) با فیلتر ملایم + اسکریم برند
 *  • مسیر = خط نارنجی درخشان فیتاپ با بدنهٔ سفید + مارکر شروع (سبز) و پایان (قرمز)
 *  • نوار آمار: مسافت/زمان/کالری/ریتم + تاریخ فارسی
 *  • اگر تایل‌ها بارگذاری نشد (آفلاین/فیلترینگ) → پوستر گرادیانی برند با همان مسیر
 * خروجی Blob PNG برای آپلود با همان مسیر /api/activity/photo — همیشه در DB می‌ماند.
 */

export interface RouteSnapshotMeta {
  label: string; // «پیاده‌روی»
  emoji: string; // 🚶
  dateFa: string; // «شنبه ۲۴ مهر ۱۴۰۵»
  timeFa: string; // «۱۰:۲۱ تا ۱۱:۴۵»
  distanceKmFa: string; // «۳٫۴۲»
  durationFa: string; // «۰:۵۲:۱۰»
  caloriesFa: string; // «۲۱۰»
  paceFa: string; // «۱۵:۱۳»
}

const W = 1080;
const H = 1350;

/** Web Mercator — x,y نرمال [0..1] */
function mercX(lng: number): number {
  return (lng + 180) / 360;
}
function mercY(lat: number): number {
  const s = Math.sin((lat * Math.PI) / 180);
  return 0.5 - Math.log((1 + s) / (1 - s)) / (4 * Math.PI);
}

/** تبدیل x,y نرمال مرکاتور به پیکسل کانواس (پنجرهٔ رسم routeWin) */
function projToCanvas(
  nx: number,
  ny: number,
  win: { x: number; y: number; w: number; h: number }
): [number, number] {
  return [(nx - win.x) / win.w * W, (ny - win.y) / win.h * W * (H / W)];
}

/** رسم مسیر + مارکرها روی کانتکست (در پنجرهٔ مرکاتوری داده‌شده) */
function drawRoute(
  ctx: CanvasRenderingContext2D,
  pts: [number, number][], // [mercX, mercY]
  win: { x: number; y: number; w: number; h: number }
) {
  const px = pts.map(([nx, ny]) => projToCanvas(nx, ny, win));
  if (px.length < 2) return;

  // بدنهٔ سفید
  ctx.save();
  ctx.lineJoin = "round";
  ctx.lineCap = "round";
  ctx.strokeStyle = "rgba(255,255,255,0.95)";
  ctx.lineWidth = 13;
  ctx.beginPath();
  ctx.moveTo(px[0][0], px[0][1]);
  for (let i = 1; i < px.length; i++) ctx.lineTo(px[i][0], px[i][1]);
  ctx.stroke();

  // خط نارنجی درخشان فیتاپ
  ctx.shadowColor = "rgba(249,115,22,0.85)";
  ctx.shadowBlur = 18;
  ctx.strokeStyle = "#f97316";
  ctx.lineWidth = 7;
  ctx.stroke();
  ctx.restore();

  // مارکر شروع (سبز) و پایان (قرمز)
  const dot = (p: [number, number], fill: string) => {
    ctx.save();
    ctx.beginPath();
    ctx.arc(p[0], p[1], 11, 0, Math.PI * 2);
    ctx.fillStyle = fill;
    ctx.fill();
    ctx.lineWidth = 4;
    ctx.strokeStyle = "#ffffff";
    ctx.stroke();
    ctx.restore();
  };
  dot(px[0], "#10b981");
  dot(px[px.length - 1], "#f43f5e");
}

/** محاسبهٔ پنجرهٔ مرکاتوری که مسیر را با حاشیه مناسب و نسبت درست می‌پوشاند */
function routeWindow(pts: [number, number][]) {
  const xs = pts.map((p) => p[0]);
  const ys = pts.map((p) => p[1]);
  const minX = Math.min(...xs), maxX = Math.max(...xs);
  const minY = Math.min(...ys), maxY = Math.max(...ys);
  const pad = 0.12; // حاشیه ۱۲٪
  let w = maxX - minX;
  let h = maxY - minY;
  if (w <= 0) w = 0.0005;
  if (h <= 0) h = 0.0005;
  // پنجره باید نسبت ۱:(H/W) داشته باشد (پهنای کامل W، ارتفاع متناظر)
  const targetRatio = H / W / 1; // mercY نسبت واقعی ندارد — تقریب: نسبت پیکسلی
  // نسبت واقعی در مرکاتور: w در برابر h — ما پنجره را بزرگ می‌کنیم تا نسبت پیکسل برقرار شود
  const drawRatio = targetRatio; // ارتفاع/عرض کانواس
  let cw = w * (1 + pad * 2);
  let ch = h * (1 + pad * 2);
  if (ch / cw < drawRatio) ch = cw * drawRatio;
  else cw = ch / drawRatio;
  const cx = (minX + maxX) / 2;
  const cy = (minY + maxY) / 2;
  return { x: cx - cw / 2, y: cy - ch / 2, w: cw, h: ch };
}

/** تلاش برای بارگذاری تایل‌های OSM در محدودهٔ پنجره — تعداد موفق برمی‌گرداند */
async function drawTiles(
  ctx: CanvasRenderingContext2D,
  win: { x: number; y: number; w: number; h: number }
): Promise<number> {
  // زوم مناسب: تایل‌های محدوده بین ۳ تا ۷ عدد در هر بعد
  let z = 17;
  for (; z >= 10; z--) {
    const n = Math.pow(2, z);
    const tx0 = win.x * n, tx1 = (win.x + win.w) * n;
    const ty0 = win.y * n, ty1 = (win.y + win.h) * n;
    if (tx1 - tx0 <= 7 && ty1 - ty0 <= 9) break;
  }
  z = Math.max(10, Math.min(19, z));
  const n = Math.pow(2, z);
  const tx0 = Math.floor(win.x * n);
  const tx1 = Math.floor((win.x + win.w) * n);
  const ty0 = Math.floor(Math.max(0, win.y * n));
  const ty1 = Math.floor(Math.min(n - 1, (win.y + win.h) * n));
  const size = 256;
  // v242 — FIX (وارونگی مقیاس): فرمول قبلی `(n*size)/(win.w*W)` دقیقاً معکوس بود.
  // پنجرهٔ مسیر به عرض win.w واحد مرکاتور هم‌زمان W پیکسل کانواس و win.w*n*size
  // پیکسل تایل را می‌پوشاند ⇒ «پیکسل کانواس به‌ازای هر پیکسل تایل» = W/(win.w*n*size).
  // اثبات عددی (win.w=3e-5، z=17، n=131072): قدیم ds=256*scale≈2.65e11px
  // (یک تایل تا ۲۶۵ میلیارد پیکسل کش می‌آمد → لکهٔ یکدست pale روی کل پوستر؛
  // میانگین رنگ تولیدشده ≈ 165,166,161 = میانگین رنگ تایل OSM)؛
  // جدید ds=256*scale≈274.7px = W/پهنای کسری پنجره بر حسب تایل (1080/3.93) ✓
  const scale = W / (win.w * n * size); // پیکسل کانواس به‌ازای هر پیکسل تایل
  const originPx = win.x * n * size;
  const originPy = win.y * n * size;
  const ds = size * scale; // اندازهٔ رسم هر تایل ۲۵۶px روی کانواس

  // v242 — Sanity clamp: اگر اندازهٔ رسم تایل بیرون بازهٔ منطقی [64, 4096] پیکسل
  // است (پنجرهٔ خراب / NaN / Infinity)، کل رسم تایل را رها کن (حتی fetch نشود)
  // تا پس‌زمینهٔ فال‌بک تیرهٔ برند (drawFallbackBackground) نمایش داده شود،
  // نه یک شست‌وی رنگی شکسته. برای پنجره‌های سالم ds ≈ W/span ∈ [~154..~310].
  if (!(ds >= 64 && ds <= 4096)) return 0;

  // v242 — ترتیب push تایل‌ها: tx حلقهٔ بیرونی، ty درونی ⇒ i = (tx-tx0)*numTy + (ty-ty0)
  const numTy = ty1 - ty0 + 1;

  const loads: Promise<HTMLImageElement | null>[] = [];
  for (let tx = tx0; tx <= tx1; tx++) {
    for (let ty = ty0; ty <= ty1; ty++) {
      loads.push(
        new Promise<HTMLImageElement | null>((resolve) => {
          const img = new Image();
          img.crossOrigin = "anonymous";
          const timer = setTimeout(() => resolve(null), 6500);
          img.onload = () => { clearTimeout(timer); resolve(img); };
          img.onerror = () => { clearTimeout(timer); resolve(null); };
          const wrappedX = ((tx % n) + n) % n;
          img.src = `https://tile.openstreetmap.org/${z}/${wrappedX}/${ty}.png`;
        })
      );
    }
  }
  const imgs = await Promise.all(loads);
  let ok = 0;
  ctx.save();
  ctx.filter = "saturate(0.72) brightness(0.98) contrast(0.98)";
  for (let i = 0; i < imgs.length; i++) {
    const img = imgs[i];
    if (!img) continue;
    // v242 — FIX (جابه‌جایی ایندکس): خواندن قبلی `i % numTx` / `floor(i/numTx)`
    // ترتیب push را ستونی می‌خواند و در گریدهای M×N تایل‌ها در خانهٔ اشتباه
    // (ترانهاده) رسم می‌شدند. حالا دقیقاً وارونِ ترتیب push (tx بیرونی، ty درونی):
    const tx = tx0 + Math.floor(i / numTy);
    const ty = ty0 + (i % numTy);
    const dx = (tx * size - originPx) * scale;
    const dy = (ty * size - originPy) * scale;
    try {
      ctx.drawImage(img, dx, dy, ds + 1, ds + 1);
      ok++;
    } catch {
      // تایل tainted — رد
    }
  }
  ctx.restore();
  return ok;
}

/** پس‌زمینهٔ فال‌بک (بدون تایل) — گرادیان برند + شبکهٔ نقطه‌ای */
function drawFallbackBackground(ctx: CanvasRenderingContext2D) {
  const g = ctx.createLinearGradient(0, 0, W, H);
  g.addColorStop(0, "#0f172a");
  g.addColorStop(0.55, "#1e293b");
  g.addColorStop(1, "#0f172a");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, W, H);
  ctx.fillStyle = "rgba(148,163,184,0.14)";
  for (let x = 40; x < W; x += 56) {
    for (let y = 40; y < H; y += 56) {
      ctx.beginPath();
      ctx.arc(x, y, 2.2, 0, Math.PI * 2);
      ctx.fill();
    }
  }
}

/** نوارهای برند و آمار روی پوستر */
function drawChrome(ctx: CanvasRenderingContext2D, meta: RouteSnapshotMeta) {
  const FONT = "'Vazirmatn', 'Segoe UI', Tahoma, sans-serif";

  // اسکریم بالا
  const topG = ctx.createLinearGradient(0, 0, 0, 300);
  topG.addColorStop(0, "rgba(15,23,42,0.88)");
  topG.addColorStop(1, "rgba(15,23,42,0)");
  ctx.fillStyle = topG;
  ctx.fillRect(0, 0, W, 300);

  // اسکریم پایین + نوار آمار
  const barH = 236;
  const botG = ctx.createLinearGradient(0, H - barH - 120, 0, H);
  botG.addColorStop(0, "rgba(15,23,42,0)");
  botG.addColorStop(0.35, "rgba(15,23,42,0.9)");
  botG.addColorStop(1, "rgba(15,23,42,0.97)");
  ctx.fillStyle = botG;
  ctx.fillRect(0, H - barH - 120, W, barH + 120);

  ctx.textBaseline = "alphabetic";
  ctx.direction = "rtl";
  ctx.textAlign = "right";

  // برند + نوع فعالیت
  ctx.font = `900 46px ${FONT}`;
  ctx.fillStyle = "#f97316";
  ctx.fillText(`${meta.emoji} ${meta.label}`, W - 48, 96);
  ctx.font = `700 30px ${FONT}`;
  ctx.fillStyle = "rgba(226,232,240,0.85)";
  ctx.fillText(`${meta.dateFa} • ${meta.timeFa}`, W - 48, 148);

  // لوگوی متنی فیتاپ (چپ‌بالا)
  ctx.textAlign = "left";
  ctx.font = `900 40px ${FONT}`;
  ctx.fillStyle = "#ffffff";
  ctx.fillText("FitUp", 48, 96);
  ctx.font = `700 22px ${FONT}`;
  ctx.fillStyle = "rgba(249,115,22,0.9)";
  ctx.fillText("مسیریاب فیتاپ", 48, 130);

  // آمار پایین
  ctx.textAlign = "right";
  const stats: Array<[string, string]> = [
    ["کیلومتر", meta.distanceKmFa],
    ["زمان", meta.durationFa],
    ["کالری", meta.caloriesFa],
    ["ریتم min/km", meta.paceFa],
  ];
  const colW = (W - 96) / 4;
  stats.forEach(([lbl, val], i) => {
    const x = W - 48 - i * colW;
    ctx.font = `900 52px ${FONT}`;
    ctx.fillStyle = "#ffffff";
    ctx.fillText(val, x, H - 108);
    ctx.font = `700 24px ${FONT}`;
    ctx.fillStyle = "rgba(249,115,22,0.95)";
    ctx.fillText(lbl, x, H - 64);
  });
}

/**
 * رندر پوستر مسیر — Blob PNG یا null (در صورت شکست کامل؛ هرگز خطا نمی‌اندازد).
 * points: [[lat,lng],…] حداقل ۲ نقطه.
 */
export async function renderRouteSnapshot(
  points: number[][],
  meta: RouteSnapshotMeta
): Promise<Blob | null> {
  try {
    const pts = (points || [])
      .filter((p) => Array.isArray(p) && p.length >= 2 && Number.isFinite(p[0]) && Number.isFinite(p[1]))
      .map((p) => [mercX(Number(p[1])), mercY(Number(p[0]))] as [number, number]);
    if (pts.length < 2) return null;

    try { await (document as any).fonts?.ready; } catch {}

    const canvas = document.createElement("canvas");
    canvas.width = W;
    canvas.height = H;
    const ctx = canvas.getContext("2d");
    if (!ctx) return null;

    const win = routeWindow(pts);
    let tiles = 0;
    try {
      tiles = await drawTiles(ctx, win);
    } catch {
      tiles = 0;
    }
    if (tiles === 0) drawFallbackBackground(ctx);
    else {
      // وینیت ملایم روی نقشه
      const vg = ctx.createLinearGradient(0, 0, 0, H);
      vg.addColorStop(0, "rgba(15,23,42,0.18)");
      vg.addColorStop(0.5, "rgba(15,23,42,0)");
      vg.addColorStop(1, "rgba(15,23,42,0.3)");
      ctx.fillStyle = vg;
      ctx.fillRect(0, 0, W, H);
    }

    drawRoute(ctx, pts, win);
    drawChrome(ctx, meta);

    return await new Promise<Blob | null>((resolve) => {
      try {
        canvas.toBlob((b) => resolve(b), "image/png", 0.92);
      } catch {
        resolve(null);
      }
    });
  } catch {
    return null;
  }
}
