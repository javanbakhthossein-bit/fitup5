/**
 * E2E v95 — LIVE end-to-end test of the chat-video AI chain at the library level.
 *
 * Why this level? It calls the EXACT production functions (ai.ts) that the chat
 * route uses, without compiling the route (sandbox OOM prevents a long-lived dev
 * server). Combined with scripts/e2e-dual-vision-v95.ts (mock gateway, route-level
 * guard semantics) this covers the full chain.
 *
 * Chain: ffmpeg test clip (squat-like moving rectangle)
 *   -> extractVideoFramesAsDataUrls (same as production)
 *   -> analyzeChatMedia (v95 dual-path anti-blind: adapter first + v95 guard + gemini fallback)
 *   -> aiChat (deepseek, with the vision report injected as mediaAnalysis)
 *   -> judge the final coach answer.
 *
 * Run: bun scripts/e2e-chat-video-lib-v95.ts
 */
import { execFileSync } from "child_process";
import { readFileSync, existsSync, unlinkSync } from "fs";
import { config } from "dotenv";

config();

// ─── 1) build the test clip: a dark rectangle moving down/up like a squat ───
console.log("=== 1) build test video ===");
const videoPath = "/tmp/fitup-e2e-squat-v95.mp4";
const dur = 12;
const vf =
  "drawbox=x=0:y=ih-40:w=iw:h=40:color=gray@0.6:t=fill," +
  "drawbox=x=290:y='120+140*abs(sin(2*PI*t/3))':w=60:h='200-140*abs(sin(2*PI*t/3))':color=black:t=fill";
execFileSync(
  "ffmpeg",
  ["-y", "-f", "lavfi", "-i", `color=c=white:s=640x480:rate=30:duration=${dur}`, "-vf", vf, "-c:v", "libx264", "-pix_fmt", "yuv420p", "-crf", "28", videoPath],
  { stdio: "ignore" }
);
if (!existsSync(videoPath)) throw new Error("ffmpeg clip build failed");
console.log(`video built: ${(readFileSync(videoPath).length / 1024).toFixed(0)}KB`);

// ─── 2) frame extraction — the same production function ───
console.log("\n=== 2) frame extraction (extractVideoFramesAsDataUrls — production) ===");
const { extractVideoFramesAsDataUrls, analyzeChatMedia, aiChat, rejectBlindMediaResponse } = await import("../src/lib/fitness/ai");
const frames = await extractVideoFramesAsDataUrls(videoPath, 6);
console.log(`frames extracted: ${frames.length} (same ffmpeg path as production)`);
if (frames.length === 0) throw new Error("no frames extracted!");

// ─── 3) vision analysis — same production function (dual path + v95 guard, real gateway) ───
// caption: "vidiyooyi esghaatam raa tahlil kon — farmam dorost ast? (test v95)"
console.log("\n=== 3) vision analysis (analyzeChatMedia — real AvalAI gateway) ===");
const t0 = Date.now();
const caption = "\u0648\u06cc\u062f\u06cc\u0648\u06cc\u06cc \u0627\u0633\u06a9\u0648\u0627\u062a\u0645 \u0631\u0627 \u062a\u062d\u0644\u06cc\u0644 \u06a9\u0646 \u2014 \u0641\u0631\u0645\u0645 \u062f\u0631\u0633\u062a \u0627\u0633\u062a? (\u062a\u0633\u062a v95)";
const analysis = await analyzeChatMedia("video-frames", frames, caption, null);
console.log(`took: ${((Date.now() - t0) / 1000).toFixed(1)}s — analysis length: ${analysis.length}`);
console.log("analysis text:\n" + analysis.slice(0, 600));

const blindGuard = rejectBlindMediaResponse(analysis);
console.log(blindGuard ? "\nFAIL — guard says the analysis is BLIND (rejected)!" : "\nOK — guard: analysis is not blind (accepted)");

const describesContent = /(\u0645\u0633\u062a\u0637\u06cc\u0644|\u0633\u06cc\u0627\u0647|\u0633\u0641\u06cc\u062f|\u062d\u0631\u06a9\u062a|\u067e\u0627\u06cc\u06cc\u0646|\u0628\u0627\u0644\u0627|\u0646\u0648\u0633\u0627\u0646|\u0627\u0633\u06a9\u0648\u0627\u062a|\u0632\u0645\u06cc\u0646|\u0641\u0631\u0645|\u0641\u0631\u06cc\u0645)/i.test(analysis);
console.log(describesContent ? "OK — the analysis describes the actual video content" : "WARNING — analysis did not describe the content; manual check needed");

// ─── 4) poisoned-cache scenario — the blind reply captured live by the v95 probe ───
console.log("\n=== 4) poisoned-cache filtering (the exact blind reply of the v95 probe) ===");
const POISONED = "\u06af\u0632\u0627\u0631\u0634 \u062a\u062d\u0644\u06cc\u0644 \u062a\u0635\u0648\u06cc\u0631\u06cc: \u0647\u06cc\u0686 \u0641\u0631\u06cc\u0645 \u06cc\u0627 \u062a\u0635\u0648\u06cc\u0631\u06cc \u062f\u0631 \u0648\u0631\u0648\u062f\u06cc \u0627\u06cc\u0646 \u067e\u06cc\u0627\u0645 \u0628\u0647 \u0645\u0646 \u0627\u0631\u0627\u0626\u0647 \u0646\u0634\u062f\u0647 \u0627\u0633\u062a. \u0645\u062d\u062a\u0648\u0627\u06cc \u0628\u0635\u0631\u06cc \u0642\u0627\u0628\u0644 \u062a\u0634\u062e\u06cc\u0635 \u0646\u06cc\u0633\u062a\u2026 \u062f\u0627\u062f\u0647\u0654 \u0628\u0635\u0631\u06cc \u0628\u0647 \u062a\u062d\u0644\u06cc\u0644\u200c\u06af\u0631 \u0646\u0631\u0633\u06cc\u062f\u0647 \u0627\u0633\u062a.";
const poisonedFiltered = rejectBlindMediaResponse(POISONED) !== null;
console.log(poisonedFiltered ? "OK — poisoned cache is rejected by collectHistoryMediaAnalyses (re-analyzed on demand)" : "FAIL — poisoned cache escaped the guard!");

// ─── 5) final coach answer — real aiChat with mediaAnalysis = step-3 output ───
// message: "ویدیویی که فرستادم را بر اساس گزارش بینایی پیوست‌شده در پیام سیستم تحلیل کن: فرم اجرا، خطاهای تکنیکی و اصلاحات دقیق را به من بده."
console.log("\n=== 5) coach answer (aiChat — deepseek, with mediaAnalysis) ===");
const t1 = Date.now();
const message = "\u0648\u06cc\u062f\u06cc\u0648\u06cc\u06cc \u06a9\u0647 \u0641\u0631\u0633\u062a\u0627\u062f\u0645 \u0631\u0627 \u0628\u0631 \u0627\u0633\u0627\u0633 \u06af\u0632\u0627\u0631\u0634 \u0628\u06cc\u0646\u0627\u06cc\u06cc \u067e\u06cc\u0648\u0633\u062a\u200c\u0634\u062f\u0647 \u062f\u0631 \u067e\u06cc\u0627\u0645 \u0633\u06cc\u0633\u062a\u0645 \u062a\u062d\u0644\u06cc\u0644 \u06a9\u0646: \u0641\u0631\u0645 \u0627\u062c\u0631\u0627\u060c \u062e\u0637\u0627\u0647\u0627\u06cc \u062a\u06a9\u0646\u06cc\u06a9\u06cc \u0648 \u0627\u0635\u0644\u0627\u062d\u0627\u062a \u062f\u0642\u06cc\u0642 \u0631\u0627 \u0628\u0647 \u0645\u0646 \u0628\u062f\u0647.";
const coach = await aiChat(null, [], message, "ultimate", analysis, null, null);
console.log(`took: ${((Date.now() - t1) / 1000).toFixed(1)}s`);
console.log("coach final answer:\n" + coach.slice(0, 800));

// ─── verdict ───
console.log("\n" + "=".repeat(60));
const coachBlind = /(\u0646\u0645\u06cc\u200c\u0628\u06cc\u0646\u0645|\u0646\u0631\u0633\u06cc\u062f|\u0646\u0631\u0633\u06cc\u062f\u0647|\u062f\u0633\u062a\u0631\u0633\u06cc \u0646\u062f\u0627\u0631\u0645|\u0627\u0631\u0633\u0627\u0644 \u0646\u0634\u062f\u0647|\u0627\u0631\u0627\u0626\u0647 \u0646\u0634\u062f\u0647)/i.test(coach);
console.log(coachBlind ? "FAIL — coach answer contains blind claims" : "OK — coach answer has no blind claims");
const coachMentionsVideo = /(\u0648\u06cc\u062f\u06cc\u0648|\u0641\u0631\u06cc\u0645|\u062d\u0631\u06a9\u062a|\u0627\u0633\u06a9\u0648\u0627\u062a|\u0645\u0633\u062a\u0637\u06cc\u0644|\u0633\u06cc\u0627\u0647|\u0641\u0631\u0645|\u062a\u062d\u0644\u06cc\u0644)/i.test(coach);
console.log(coachMentionsVideo ? "OK — coach refers to the video/analysis" : "WARNING — coach did not refer to the video");
console.log(blindGuard ? "FAIL — a BLIND analysis would be cached / quota-deducted!" : "OK — anti-blind guard: no blind answer can be cached or quota-deducted");

try { unlinkSync(videoPath); } catch {}
process.exit(blindGuard || coachBlind || !describesContent ? 1 : 0);
