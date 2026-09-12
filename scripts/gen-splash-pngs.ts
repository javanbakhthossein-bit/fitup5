/**
 * Task 4-c — one-off generator: 16 iOS apple-touch-startup-image splash PNGs.
 * White bg + FitUp logo (icon-512.png resized to target, transparent bg)
 * centered at ~42-44% height + Persian slogan «هر بدنی فیتاپ میخواد!» below
 * (Vazirmatn-Bold via librsvg+pango → proper RTL shaping, verified).
 */
import sharp from "sharp";

async function main() {
const SIZES = [
  [1290, 2796], [2796, 1290], [1284, 2778], [2778, 1284],
  [1179, 2556], [2556, 1179], [1170, 2532], [2532, 1170],
  [1242, 2688], [2688, 1242], [828, 1792], [1792, 828],
  [1125, 2436], [2436, 1125], [750, 1334], [1334, 750],
];

const SLOGAN = "هر بدنی فیتاپ میخواد!";
const BRAND = "/home/z/my-project";
const icon = sharp(`${BRAND}/public/icon-512.png`);
const logoCache = new Map<number, Buffer>();

async function logoAt(size: number): Promise<Buffer> {
  let b = logoCache.get(size);
  if (!b) { b = await icon.clone().resize(size, size).png().toBuffer(); logoCache.set(size, b); }
  return b;
}

for (const [W, H] of SIZES) {
  const min = Math.min(W, H);
  const portrait = H >= W;
  const logoSize = Math.round(min * 0.29);
  const cx = Math.round(W / 2);
  const logoCy = Math.round(H * (portrait ? 0.42 : 0.44));
  const logoX = Math.round(cx - logoSize / 2);
  const logoY = Math.round(logoCy - logoSize / 2);
  const fontSize = Math.round(min * 0.052);
  const gap = Math.round(logoSize * 0.17);
  const textY = Math.round(logoCy + logoSize / 2 + gap + fontSize * 0.8);

  const svg = `<svg width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" xmlns="http://www.w3.org/2000/svg">
  <rect width="${W}" height="${H}" fill="#ffffff"/>
  <text x="${cx}" y="${textY}" text-anchor="middle" font-family="Vazirmatn" font-weight="700" font-size="${fontSize}" fill="#ea580c" direction="rtl">${SLOGAN}</text>
</svg>`;

  await sharp(Buffer.from(svg))
    .composite([{ input: await logoAt(logoSize), left: logoX, top: logoY }])
    .png({ compressionLevel: 9 })
    .toFile(`${BRAND}/public/splash/${W}x${H}.png`);
  console.log(`OK ${W}x${H} logo=${logoSize}px logoBox y=${logoY}..${logoY + logoSize} textBaseline=${textY}`);
}
console.log("done: 16 splash pngs regenerated");
}
main();
