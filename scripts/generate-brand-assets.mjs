// ─────────────────────────────────────────────────────────────────────────────
// v247-fix — تولید برند-آست‌های مفقود (فاوآیکون / آیکون PWA / اسپلش iOS / لوگوی ۶۴)
//
// باگ یافتهٔ TEST-A: layout.tsx و landing-nav.tsx به فایل‌هایی ارجاع می‌دهند که
// هرگز در public/ ساخته نشده بودند (fitup-logo-64.png، favicon-16/32، icon-192/512،
// apple-touch-icon و ۱۶ اسپلش apple-touch-startup-image) → 404 در هر لود،
// فاوآیکون/آیکون نصب PWA خراب.
//
// منبع: public/fitup-logo.png (۱۲۸×۱۲۸، پس‌زمینهٔ شفاف گوشه‌ها) — برای آیکون‌های
// سیستمی (apple-touch-icon و icon-192/512) روی سفید مسطح می‌شود (iOS شفاف را
// سیاه پر می‌کند)؛ اسپلش‌ها = پس‌زمینهٔ سفید (#ffffff — همان manifest) + لوگو وسط.
//
// اجرا: bun scripts/generate-brand-assets.mjs  (idempotent — هر بار بازنویسی)
// ─────────────────────────────────────────────────────────────────────────────
import sharp from "sharp";
import { mkdirSync } from "node:fs";
import { join } from "node:path";

const PUB = join(process.cwd(), "public");
const LOGO = join(PUB, "fitup-logo.png");
const LOGO_SRC = sharp(LOGO); // 128×128 P (پالت)

async function save(img, file) {
  await img.png({ compressionLevel: 9 }).toFile(join(PUB, file));
  console.log("✔", file);
}

async function main() {
  mkdirSync(join(PUB, "splash"), { recursive: true });

  // ۱) لوگوی ۶۴ هدر لندینگ — عین لوگو (شفاف حفظ می‌شود)
  await save(LOGO_SRC.clone().resize(64, 64), "fitup-logo-64.png");

  // ۲) فاوآیکون‌ها
  await save(LOGO_SRC.clone().resize(16, 16), "favicon-16.png");
  await save(LOGO_SRC.clone().resize(32, 32), "favicon-32.png");

  // ۳) آیکون‌های PWA + apple-touch — مسطح روی سفید (ضد سیاه‌شدن iOS)
  const flatOnWhite = (size) =>
    LOGO_SRC
      .clone()
      .resize(size, size)
      .flatten({ background: "#ffffff" });

  await save(flatOnWhite(192), "icon-192.png");
  await save(flatOnWhite(512), "icon-512.png");
  await save(flatOnWhite(180), "apple-touch-icon.png");

  // ۴) اسپلش‌های iOS — سفید + لوگو وسط (لوگو ≈ ۲۰٪ عرض، سقف ۲۴۰px)
  //    ارجاع‌ها: layout.tsx 917-932 — دقیقاً همان ۱۶ ترکیب
  const SPLASHES = [
    [1290, 2796], [2796, 1290],
    [1284, 2778], [2778, 1284],
    [1179, 2556], [2556, 1179],
    [1170, 2532], [2532, 1170],
    [1242, 2688], [2688, 1242],
    [828, 1792],  [1792, 828],
    [1125, 2436], [2436, 1125],
    [750, 1334],  [1334, 750],
  ];

  for (const [w, h] of SPLASHES) {
    const logoSize = Math.min(Math.round(Math.min(w, h) * 0.2), 240);
    const logoBuf = await LOGO_SRC.clone().resize(logoSize, logoSize).png().toBuffer();
    await sharp({
      create: {
        width: w,
        height: h,
        channels: 4,
        background: "#ffffff",
      },
    })
      .composite([{ input: logoBuf, gravity: "centre" }])
      .png({ compressionLevel: 9 })
      .toFile(join(PUB, "splash", `${w}x${h}.png`));
    console.log("✔", `splash/${w}x${h}.png`);
  }

  console.log("— انجام شد: ۲۱ فایل برند ساخته شد —");
}

main().catch((e) => {
  console.error("FAILED:", e);
  process.exit(1);
});
