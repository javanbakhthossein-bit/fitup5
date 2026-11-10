// sc-analyze-v261.ts — تحلیل کامل فایل Performance سرچ‌کنسول فیتاپ (۲۰۲۶-۱۱-۰۹)
// خروجی: گزارش ریشه‌یابی نزول کلیک‌ها
import * as XLSX from "xlsx";
import { writeFileSync } from "fs";

const FILE = "/home/z/my-project/upload/https___fittup.ir_-Performance-on-Search-2026-11-09.xlsx";
const wb = XLSX.readFile(FILE, { type: "file" });

console.log("=== Sheets ===");
for (const name of wb.SheetNames) console.log(" -", name);

function sheetRows(name: string): any[] {
  const ws = wb.Sheets[name];
  return XLSX.utils.sheet_to_json(ws, { header: 1, raw: true, defval: null });
}

// ساختار استاندارد اکسپورت GSC: [Topic, Clicks, PrevClicks, Impr, PrevImpr, CTR, PrevCTR, Pos, PrevPos]
type Row = { topic: string; clicks: number; prevClicks: number; impr: number; prevImpr: number; ctr: number; prevCtr: number; pos: number; prevPos: number };

function parseSheet(name: string): Row[] {
  const rows = sheetRows(name);
  const out: Row[] = [];
  for (const r of rows) {
    if (!r || r.length < 5) continue;
    const topic = String(r[0] ?? "").trim();
    if (!topic || topic === "Filter" || topic === "Date" || topic === "28 days") continue;
    const nums = r.slice(1).map((v: any) => {
      if (typeof v === "number") return v;
      if (typeof v === "string") {
        const s = v.trim();
        if (s.endsWith("%")) return parseFloat(s) / 100;
        const f = parseFloat(s.replace(/,/g, ""));
        return isNaN(f) ? null : f;
      }
      return null;
    });
    // اعداد واقعی (کلیک/ایمپرشن/پوزیشن) — درصدها را جدا نگه می‌داریم
    const raw = r.slice(1).map((v: any) => {
      if (typeof v === "number") return v;
      const s = String(v ?? "").trim();
      const f = parseFloat(s.replace(/,/g, ""));
      return isNaN(f) ? 0 : f;
    });
    if (raw[0] === 0 && raw[2] === 0) continue; // ردیف‌های خالی/تزئینی
    out.push({
      topic,
      clicks: raw[0] ?? 0,
      prevClicks: raw[1] ?? 0,
      impr: raw[2] ?? 0,
      prevImpr: raw[3] ?? 0,
      ctr: raw[4] ?? 0,
      prevCtr: raw[5] ?? 0,
      pos: raw[6] ?? 0,
      prevPos: raw[7] ?? 0,
    });
  }
  return out;
}

const sheets: Record<string, Row[]> = {};
for (const n of wb.SheetNames) sheets[n] = parseSheet(n);

const fmt = (x: number) => x.toLocaleString("en-US");
const pct = (a: number, b: number) => (b === 0 ? (a > 0 ? "+NEW" : "0%") : `${a >= b ? "+" : ""}${(((a - b) / b) * 100).toFixed(1)}%`);

let report = "";
const H = (s: string) => { report += "\n\n" + s + "\n" + "=".repeat(60) + "\n"; };

H("۱) جمع‌کل کلی و روند");
for (const [name, rows] of Object.entries(sheets)) {
  if (name.toLowerCase().includes("filter") || name.toLowerCase().includes("appearance")) continue;
  const c = rows.reduce((s, r) => s + r.clicks, 0);
  const pc = rows.reduce((s, r) => s + r.prevClicks, 0);
  const i = rows.reduce((s, r) => s + r.impr, 0);
  const pi = rows.reduce((s, r) => s + r.prevImpr, 0);
  const ctr = i ? (c / i) * 100 : 0;
  const pctr = pi ? (pc / pi) * 100 : 0;
  const avgPos = rows.length ? rows.reduce((s, r) => s + r.pos, 0) / rows.length : 0;
  const pavgPos = rows.length ? rows.reduce((s, r) => s + r.prevPos, 0) / rows.length : 0;
  report += `${name}: کلیک ${fmt(c)} (قبلی ${fmt(pc)}, ${pct(c, pc)}) | ایمپرشن ${fmt(i)} (قبلی ${fmt(pi)}, ${pct(i, pi)}) | CTR ${ctr.toFixed(2)}% (قبلی ${pctr.toFixed(2)}%) | میانگین پوزیشن ${avgPos.toFixed(2)} (قبلی ${pavgPos.toFixed(2)})\n`;
}

// برندها
const BRAND = ["فیت آپ", "فیتاپ", "fitup", "fit up", "fittup", "fitt up", "fit-up", "برنامه فیت", "قالب فیت"];
const isBrand = (t: string) => BRAND.some((b) => t.toLowerCase().includes(b.toLowerCase()) || t.includes(b));

for (const [name, rows] of Object.entries(sheets)) {
  if (name.toLowerCase().includes("quer")) {
    H(`۲) ${name}: برند در برابر غیربرند`);
    const brand = rows.filter((r) => isBrand(r.topic));
    const non = rows.filter((r) => !isBrand(r.topic));
    const sum = (arr: Row[]) => arr.reduce((a, r) => ({ c: a.c + r.clicks, pc: a.pc + r.prevClicks, i: a.i + r.impr, pi: a.pi + r.prevImpr }), { c: 0, pc: 0, i: 0, pi: 0 });
    const b = sum(brand), n = sum(non);
    report += `برند: کلیک ${fmt(b.c)} (قبلی ${fmt(b.pc)}, ${pct(b.c, b.pc)}) — کوئری‌ها: ${brand.length}\n`;
    report += `غیربرند: کلیک ${fmt(n.c)} (قبلی ${fmt(n.pc)}, ${pct(n.c, n.pc)}) — کوئری‌ها: ${non.length}\n`;

    H(`۳) ${name}: بزرگ‌ترین ریزش‌های کلیک`);
    const declines = rows.filter((r) => r.clicks < r.prevClicks).sort((a, b) => (a.clicks - a.prevClicks) - (b.clicks - b.prevClicks)).slice(0, 25);
    for (const r of declines) report += `  «${r.topic}» ${r.clicks} ← قبلی ${r.prevClicks} (${pct(r.clicks, r.prevClicks)}) | پوزیشن ${r.pos.toFixed(1)} ← ${r.prevPos.toFixed(1)} | CTR ${(r.ctr * 100).toFixed(1)}% ← ${(r.prevCtr * 100).toFixed(1)}%\n`;

    H(`۴) ${name}: بزرگ‌ترین رشدها`);
    const gains = rows.filter((r) => r.clicks > r.prevClicks).sort((a, b) => (b.clicks - b.prevClicks) - (a.clicks - a.prevClicks)).slice(0, 20);
    for (const r of gains) report += `  «${r.topic}» ${r.clicks} ← قبلی ${r.prevClicks} (+${r.clicks - r.prevClicks}) | پوزیشن ${r.pos.toFixed(1)} ← ${r.prevPos.toFixed(1)}\n`;

    H(`۵) ${name}: کوئری‌های با پوزیشن بدترشده (که پتانسیل از دست رفته دارند)`);
    const worse = rows.filter((r) => r.prevPos > 0 && r.prevPos <= 12 && r.pos > r.prevPos + 3).sort((a, b) => (b.prevPos - b.pos) - (a.prevPos - a.pos)).slice(0, 25);
    for (const r of worse) report += `  «${r.topic}» پوزیشن ${r.pos.toFixed(1)} ← قبلی ${r.prevPos.toFixed(1)} (بدتر) | کلیک ${r.clicks} ← ${r.prevClicks}\n`;

    H(`۶) ${name}: کوئری‌های با ایمپرشن بالا و CTR صفر/خیلی کم (فرصت فوری)`);
    const noCTR = rows.filter((r) => r.impr >= 100 && r.ctr < 0.02).sort((a, b) => b.impr - a.impr).slice(0, 20);
    for (const r of noCTR) report += `  «${r.topic}» ایمپرشن ${fmt(r.impr)} | CTR ${(r.ctr * 100).toFixed(2)}% | پوزیشن ${r.pos.toFixed(1)} | کلیک ${r.clicks}\n`;

    H(`۷) ${name}: کوئری‌های ناپدیدشده/جدید`);
    const lost = rows.filter((r) => r.clicks === 0 && r.prevClicks >= 3).sort((a, b) => b.prevClicks - a.prevClicks).slice(0, 20);
    for (const r of lost) report += `  «${r.topic}» ۰ ← قبلی ${r.prevClicks} | ایمپرشن ${fmt(r.impr)} | پوزیشن ${r.pos.toFixed(1)} ← ${r.prevPos.toFixed(1)}\n`;
    const newQ = rows.filter((r) => r.clicks > 0 && r.prevClicks === 0 && r.impr >= 20).sort((a, b) => b.clicks - a.clicks).slice(0, 15);
    for (const r of newQ) report += `  «${r.topic}» ${r.clicks} کلیک جدید | ایمپرشن ${fmt(r.impr)} | پوزیشن ${r.pos.toFixed(1)}\n`;
  }
}

for (const [name, rows] of Object.entries(sheets)) {
  if (name.toLowerCase().includes("page")) {
    H(`۸) ${name}: صفحات با بیشترین ریزش کلیک`);
    const declines = rows.filter((r) => r.clicks < r.prevClicks).sort((a, b) => (a.clicks - a.prevClicks) - (b.clicks - b.prevClicks)).slice(0, 25);
    for (const r of declines) report += `  ${r.topic.slice(0, 110)} | ${r.clicks} ← ${r.prevClicks} (${pct(r.clicks, r.prevClicks)}) | پوزیشن ${r.pos.toFixed(1)} ← ${r.prevPos.toFixed(1)} | CTR ${(r.ctr * 100).toFixed(1)}% ← ${(r.prevCtr * 100).toFixed(1)}%\n`;
    H(`۹) ${name}: صفحات با بیشترین رشد کلیک`);
    const gains = rows.filter((r) => r.clicks > r.prevClicks).sort((a, b) => (b.clicks - b.prevClicks) - (a.clicks - a.prevClicks)).slice(0, 15);
    for (const r of gains) report += `  ${r.topic.slice(0, 110)} | ${r.clicks} ← ${r.prevClicks} (+${r.clicks - r.prevClicks})\n`;
  }
  if (name.toLowerCase().includes("countr")) {
    H(`۱۰) ${name}`);
    for (const r of rows.slice(0, 15)) report += `  ${r.topic}: ${r.clicks} ← ${r.prevClicks}\n`;
  }
  if (name.toLowerCase().includes("devic")) {
    H(`۱۱) ${name}`);
    for (const r of rows) report += `  ${r.topic}: کلیک ${r.clicks} ← ${r.prevClicks} | CTR ${(r.ctr * 100).toFixed(2)}% ← ${(r.prevCtr * 100).toFixed(2)}% | پوزیشن ${r.pos.toFixed(1)} ← ${r.prevPos.toFixed(1)}\n`;
  }
}

writeFileSync("/home/z/my-project/download/گزارش-سرچ-کنسول-v261.txt", report, "utf8");
console.log(report.slice(0, 6000));
console.log("\n...\n[فایل کامل ذخیره شد: download/گزارش-سرچ-کنسول-v261.txt]");
