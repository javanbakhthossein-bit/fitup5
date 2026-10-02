/**
 * check-imports.ts — بررسی کامل resolution همهٔ importهای src/ (v55)
 *
 * چرا؟ خطای بیلد سرور «Module not found: Can't resolve '@/lib/fitness/video-thumbnail'»
 * به‌خاطر جاافتادن دو فایل در زیپ دیپلوی بود. این اسکریپت همان کلاس خطا را
 * قبل از بسته‌بندی می‌گیرد: همهٔ import/export-from/require های src/** را
 * می‌خواند و مسیر @/ و نسبی را resolve می‌کند — اگر فایلی موجود نباشد،
 * خروجی non-zero و لیست کامل می‌دهد. (tsc خطاهای تایپی را هم می‌گیرد؛
 * این اسکریپت مکمل resolution است و بدون OOM اجرا می‌شود.)
 */
import { readdirSync, statSync, readFileSync, existsSync } from "fs";
import { join, dirname, resolve, relative } from "path";

const ROOT = process.cwd();
const SRC = join(ROOT, "src");
const EXTS = [".ts", ".tsx", ".js", ".jsx", ".mjs", ".css", ".json"];

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    const st = statSync(p);
    if (st.isDirectory()) walk(p, out);
    else if (/\.(ts|tsx|js|jsx|mjs)$/.test(name)) out.push(p);
  }
  return out;
}

function tryResolve(base: string, spec: string): string | null {
  // @/ → src/
  const baseDir = base.startsWith(specRootCheck(base)) ? dirname(base) : dirname(base);
  const candidates: string[] = [];
  if (spec.startsWith("@/")) {
    const target = join(SRC, spec.slice(2));
    candidates.push(target);
  } else if (spec.startsWith("./") || spec.startsWith("../")) {
    candidates.push(resolve(baseDir, spec));
  } else {
    return null; // پکیج node_modules — خارج از scope
  }
  for (const c of candidates) {
    if (existsSync(c) && statSync(c).isFile()) return c;
    for (const ext of EXTS) {
      if (existsSync(c + ext) && statSync(c + ext).isFile()) return c + ext;
    }
    for (const ext of EXTS) {
      const idx = join(c, "index" + ext);
      if (existsSync(idx)) return idx;
    }
  }
  return null;
}

function specRootCheck(_b: string): string {
  return ""; // کمکی — resolve با src مطلق انجام می‌شود
}

const files = walk(SRC);
const errors: string[] = [];
let checked = 0;

const IMPORT_RE =
  /(?:import|export)\s[^"'`]*?from\s*["']([^"']+)["']|import\s*\(\s*["']([^"']+)["']\s*\)|require\s*\(\s*["']([^"']+)["']\s*\)|import\s*["']([^"']+)["']/g;

/** حذف کامنت‌ها — مثال‌های داخل JSDoc (مثل ./agents/my-agent) import نیستند */
function stripComments(text: string): string {
  return text
    .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, " "))
    .replace(/(^|[^:])\/\/[^\n]*/g, (m, p1) => `${p1}${" ".repeat(m.length - p1.length)}`);
}

for (const file of files) {
  const text = stripComments(readFileSync(file, "utf8"));
  let m: RegExpExecArray | null;
  IMPORT_RE.lastIndex = 0;
  while ((m = IMPORT_RE.exec(text))) {
    const spec = m[1] || m[2] || m[3] || m[4] || "";
    if (!spec) continue;
    if (spec.startsWith("data:")) continue;
    checked++;
    const resolved = tryResolve(file, spec);
    if (!resolved) {
      // برون‌سپاری به node_modules — فقط alias و نسبی جاافتاده خطاست
      if (spec.startsWith("@/") || spec.startsWith("./") || spec.startsWith("../")) {
        errors.push(`${relative(ROOT, file)} → ${spec}`);
      }
    }
  }
}

console.log(`checked ${checked} import specifiers across ${files.length} files`);
if (errors.length) {
  console.error("UNRESOLVED IMPORTS:");
  for (const e of errors) console.error("  " + e);
  process.exit(1);
}
console.log("ALL IMPORTS RESOLVED ✓");
