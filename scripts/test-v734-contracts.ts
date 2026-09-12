/** v73.4 — تست عملیاتی قراردادهای جدید: apply-swap / analyze-video پس‌زمینه / چت مدیا دوفازی / تیکت‌ها */
import { PrismaClient } from "@prisma/client";
import { readFileSync } from "fs";
const db = new PrismaClient();
const MOBILE = "09120000075";

async function main() {
  await db.user.deleteMany({ where: { mobile: MOBILE } });
  const start = new Date(); const end = new Date(start.getTime() + 40 * 86400000);
  const u = await db.user.create({ data: { mobile: MOBILE, name: "تست ۷۳۴", onboardingDone: true, planName: "ultimate", planStartedAt: start, planExpiresAt: end } });
  await db.subscription.create({ data: { userId: u.id, plan: "ultimate", status: "active", startDate: start, endDate: end, durationDays: 45, pricePaid: 1800000 } });
  await db.onboardingProfile.create({ data: { userId: u.id, gender: "male", age: 27, height: 180, weight: 88, goal: "muscle_gain", activityLevel: "moderate", workoutDays: 4, workoutDaysList: "[]", workoutPlace: "gym", equipment: "[]" } });
  await db.workoutPlan.create({ data: { userId: u.id, content: JSON.stringify({ days: [{ day: "شنبه", title: "پا", exercises: [{ name: "اسکوات", sets: 3, reps: "10", restSec: 90 }] }, { day: "دوشنبه", title: "پا ۲", exercises: [{ name: "اسکوات جلو", sets: 3, reps: "8", restSec: 90 }, { name: "ددلیفت", sets: 3, reps: "8", restSec: 120 }] }] }), active: true } });
  await db.mealPlan.create({ data: { userId: u.id, content: JSON.stringify({ totalCalories: 2500, meals: [{ name: "صبحانه", items: [{ name: "تخم‌مرغ", servingSize: "۳ عدد", calories: 210 }, { name: "نان", servingSize: "۲ کف دست", calories: 160 }] }, { name: "ناهار", items: [{ name: "تخم‌مرغ", servingSize: "۲ عدد", calories: 140 }] }] }), totalCal: 2500, active: true } });

  const { createSessionToken } = await import("@/lib/fitness/auth");
  const cookie = `sc_session=${createSessionToken(u.id)}`;
  const { execFileSync } = await import("child_process");
  const curl = (args: string[]) => execFileSync("curl", ["-s", "--max-time", "100", ...args], { encoding: "utf8", maxBuffer: 30e6 });
  let ok = true;
  const chk = (n: string, c: boolean, d = "") => { console.log(`${c ? "✅" : "❌"} ${n}${d ? " — " + d : ""}`); if (!c) ok = false; };

  // 1) apply-swap: exercise در همهٔ روزها + food در همهٔ وعده‌ها
  const r1 = curl(["-X", "POST", "http://127.0.0.1:3000/api/coach/apply-swap", "-H", "Content-Type: application/json", "-H", `Cookie: ${cookie}`, "-d", JSON.stringify({ type: "exercise", from: "اسکوات", to: "پرس پا دستگاه", day: "" })]);
  const j1 = JSON.parse(r1 || "{}");
  chk("apply-swap حرکت: اعمال شد", j1.applied >= 2, `applied=${j1.applied}`);
  const wp = await db.workoutPlan.findFirst({ where: { userId: u.id, active: true } });
  const wc = JSON.parse(wp!.content);
  chk("حرکت در همهٔ روزها عوض شد", wc.days[0].exercises[0].name === "پرس پا دستگاه" && wc.days[1].exercises[0].name === "پرس پا دستگاه" && wc.days[1].exercises[0].reps === "8");
  const r2 = curl(["-X", "POST", "http://127.0.0.1:3000/api/coach/apply-swap", "-H", "Content-Type: application/json", "-H", `Cookie: ${cookie}`, "-d", JSON.stringify({ type: "food", from: "تخم‌مرغ", to: "سفیده تخم‌مرغ", day: "" })]);
  const j2 = JSON.parse(r2 || "{}");
  chk("apply-swap غذا: اعمال شد", j2.applied >= 2, `applied=${j2.applied}`);
  const mp = await db.mealPlan.findFirst({ where: { userId: u.id, active: true } });
  const mc = JSON.parse(mp!.content);
  chk("غذا در همهٔ وعده‌ها عوض شد", mc.meals[0].items[0].name === "سفیده تخم‌مرغ" && mc.meals[1].items[0].name === "سفیده تخم‌مرغ" && mc.meals[0].items[0].servingSize === "۳ عدد");

  // 2) analyze-video پس‌زمینه: پاسخ فوری + poll
  const t0 = Date.now();
  const boundary = "----v734";
  const vid = readFileSync("/tmp/test-vid.mp4");
  const body = Buffer.concat([
    Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="video"; filename="t.mp4"\r\nContent-Type: video/mp4\r\n\r\n`),
    vid, Buffer.from(`\r\n--${boundary}--\r\n`),
  ]);
  (await import("fs")).writeFileSync("/tmp/test-body.bin", body);
  const r3 = execFileSync("curl", ["-s", "--max-time", "100", "-X", "POST", "http://127.0.0.1:3000/api/coach/analyze-video", "-H", `Cookie: ${cookie}`, "-H", `Content-Type: multipart/form-data; boundary=${boundary}`, "--data-binary", "@/tmp/test-body.bin"], { encoding: "utf8", maxBuffer: 30e6 });
  const dt = (Date.now() - t0) / 1000;
  const j3 = JSON.parse(r3 || "{}");
  chk("analyze-video: پاسخ فوری پس‌زمینه", j3.status === "analyzing" && dt < 60, `${dt.toFixed(1)}s status=${j3.status}`);

  // 3) چت مدیا دوفازی: پاسخ فوری pending + poll تا پر شدن
  const img = readFileSync("upload/IMG_20260907_003540_799.jpg").toString("base64");
  const t1 = Date.now();
  const r4 = curl(["-X", "POST", "http://127.0.0.1:3000/api/coach/chat", "-H", "Content-Type: application/json", "-H", `Cookie: ${cookie}`, "-d", JSON.stringify({ message: "این تصویر چیست؟", clientId: "c1_1", imageBase64: `data:image/jpeg;base64,${img}` })]);
  const dt4 = (Date.now() - t1) / 1000;
  const j4 = JSON.parse(r4 || "{}");
  chk("چت مدیا: پاسخ فوری pending", j4.pending === true && dt4 < 60, `${dt4.toFixed(1)}s pending=${j4.pending}`);
  let filled = false;
  for (let i = 0; i < 30; i++) {
    await new Promise((r) => setTimeout(r, 4000));
    const g = curl(["http://127.0.0.1:3000/api/coach/chat", "-H", `Cookie: ${cookie}`]);
    const jg = JSON.parse(g || "{}");
    const ai = (jg.messages || []).find((m: any) => m.role === "assistant" && m.content && m.content.length > 50);
    if (ai) { filled = true; console.log(`   پاسخ AI (${((Date.now() - t1) / 1000).toFixed(0)}s): ${ai.content.slice(0, 90).replace(/\s+/g, " ")}`); break; }
  }
  chk("چت مدیا: پاسخ AI پس‌زمینه کامل شد", filled);

  // 4) تیکت‌ها: unread → mark_read
  const tk = JSON.parse(curl(["-X", "POST", "http://127.0.0.1:3000/api/support/tickets", "-H", "Content-Type: application/json", "-H", `Cookie: ${cookie}`, "-d", JSON.stringify({ subject: "تست بج", message: "متن تست", category: "general", priority: "normal" })]) || "{}");
  let admin = await db.user.findFirst({ where: { role: "ADMIN" } });
  if (!admin) {
    admin = await db.user.create({ data: { mobile: "09120000099", name: "ادمین تست", role: "ADMIN" } });
  }
  const adminCookie = `sc_session=${createSessionToken(admin.id)}`;
  const lst = JSON.parse(curl(["http://127.0.0.1:3000/api/support/tickets", "-H", `Cookie: ${adminCookie}`]) || "{}");
  const ticket = (lst.tickets || []).find((t: any) => t.id === tk.id || t.subject === "تست بج");
  chk("تیکت جدید unread برای ادمین", !!ticket && ticket.unread === true);
  if (ticket) {
    curl(["-X", "PATCH", `http://127.0.0.1:3000/api/support/tickets/${ticket.id}`, "-H", "Content-Type: application/json", "-H", `Cookie: ${adminCookie}`, "-d", JSON.stringify({ action: "mark_read" })]);
    const lst2 = JSON.parse(curl(["http://127.0.0.1:3000/api/support/tickets", "-H", `Cookie: ${adminCookie}`]) || "{}");
    const t2 = (lst2.tickets || []).find((x: any) => x.id === ticket.id);
    chk("mark_read → unread=false", !!t2 && t2.unread === false);
  }

  console.log(ok ? "\n🎉 قراردادهای v73.4 سبز" : "\n⛔ شکست");
  await db.user.delete({ where: { id: u.id } }).catch(() => {});
  await db.supportTicket.deleteMany({ where: { subject: "تست بج" } }).catch(() => {});
  await db.user.deleteMany({ where: { mobile: "09120000099" } }).catch(() => {});
  await db.$disconnect();
  process.exit(ok ? 0 : 1);
}
main().catch(async (e) => { console.error("err:", String(e).slice(0, 300)); await db.$disconnect(); process.exit(1); });
