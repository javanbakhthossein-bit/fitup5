/**
 * v242 — پردازش تصاویر پست مهمان با پایپ‌لاین برند فیتاپ
 * cover 1200x675 + thumb + full — همه webp + واترمارک FitUp + کش آینه‌ای
 * اجرا: bun run scripts/tmp/guest-post-assets.ts (از ریشهٔ پروژه)
 */
import { readFile, writeFile } from "fs/promises";
import {
  processAndSaveArticleImage,
  processAndSaveInlineImage,
} from "../../src/lib/fitness/image-processing";

const DIR = "scripts/tmp/guest-post";
const SLUG = "why-generic-workout-plans-fail";

async function main() {
  const coverBuf = await readFile(`${DIR}/cover.png`);
  const coverSet = await processAndSaveArticleImage({
    buffer: coverBuf,
    articleSlug: SLUG,
    descriptiveName: "personalized-training",
  });
  console.log("COVER:", coverSet.cover.url, coverSet.cover.width + "x" + coverSet.cover.height, coverSet.cover.bytes, "bytes");

  const i1 = await readFile(`${DIR}/inline-1.png`);
  const r1 = await processAndSaveInlineImage({
    buffer: i1,
    articleSlug: SLUG,
    descriptiveName: "generic-plan-vs-personalized-app",
    index: 1,
  });
  console.log("INLINE1:", r1.url, r1.width + "x" + r1.height, r1.bytes, "bytes");

  const i2 = await readFile(`${DIR}/inline-2.png`);
  const r2 = await processAndSaveInlineImage({
    buffer: i2,
    articleSlug: SLUG,
    descriptiveName: "personal-coaching-smart-analysis",
    index: 2,
  });
  console.log("INLINE2:", r2.url, r2.width + "x" + r2.height, r2.bytes, "bytes");

  await writeFile(
    `${DIR}/assets.json`,
    JSON.stringify({ cover: coverSet.cover.url, thumb: coverSet.thumbnail.url, inline1: r1.url, inline2: r2.url }, null, 2)
  );
  console.log("ASSETS_JSON_WRITTEN");
}

main().catch((e) => {
  console.error("FAILED:", e);
  process.exit(1);
});
