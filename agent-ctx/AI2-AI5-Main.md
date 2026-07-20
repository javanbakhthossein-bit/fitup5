# Task ID: AI2-AI5
# Agent: Main (Z.ai Code)
# Task: Rewrite AI service layer to use AvalAI API gateway (OpenAI-compatible) instead of z-ai-web-dev-sdk

## Context
- Read /home/z/my-project/worklog.md to understand previous work
- Reviewed prior agent records in /agent-ctx (R5-main.md, R1-main.md, A2-revert-Main.md)
- Confirmed `openai` package (^6.45.0) already installed in package.json
- Confirmed AvalAI env vars already present in .env:
  - AVALAI_API_KEY, AVALAI_BASE_URL=https://api.avalai.ir/v1
  - AVALAI_TEXT_MODEL=deepseek-v4-flash, AVALAI_VISION_MODEL=gemini-3.5-flash
- Confirmed `src/lib/fitness/ai.ts` was the ONLY source file importing `z-ai-web-dev-sdk`
- Confirmed `getZai()` was internal (not exported), so removing it is safe
- Confirmed all consumers (7 API routes) only use exported functions, signatures preserved

## File Modified
### src/lib/fitness/ai.ts (complete rewrite of the LLM layer)

#### 1. Import & client singleton
- Replaced `import ZAI from "z-ai-web-dev-sdk"` → `import OpenAI from "openai"`
- Created `avalaiClient` singleton (apiKey + baseURL from env)
- Defined `TEXT_MODEL` and `VISION_MODEL` constants from env
- Removed `zaiInstance` variable and `getZai()` function

#### 2. Text functions rewritten (use TEXT_MODEL = deepseek-v4-flash)
All 6 existing text functions rewritten to call `avalaiClient.chat.completions.create()`:
- `generateWorkoutPlan()` — preserved JSON output structure & enrichment logic
- `generateMealPlan()` — preserved calorie calc & totals enrichment
- `aiChat()` — history.slice(-10) + user message preserved
- `nikaChat()` — planInfo + upsellHint logic preserved (4-tier basic/standard/advanced/ultimate from A2-revert)
- `adminCopilotChat()` — admin stats context preserved
- `swapFood()` — JSON-only response preserved

Key changes to LLM call mechanics:
- `role: "assistant"` for system prompt → `role: "system"` (correct for OpenAI-compatible API; the old z-ai SDK accepted assistant as system, but OpenAI API requires "system")
- Added `model: TEXT_MODEL` to every call
- Kept `thinking: { type: "disabled" }` param via `as any` cast on the request body (AvalAI-specific, not in OpenAI SDK types)
- Each call wrapped in try/catch with `console.error` + Persian error message thrown

#### 3. New vision functions added (use VISION_MODEL = gemini-3.5-flash)
4 new exported functions for multimodal image/video analysis via OpenAI-compatible chat completions:
- `analyzeMealPhoto(base64Image, mimeType, userContext)` → `{ calories, protein, carbs, fat, description }`
- `analyzeBodyPhoto(base64Image, mimeType, userContext)` → `{ bodyScore, analysis, recommendations[] }`
- `analyzeVideoBody(base64Video, mimeType, userContext)` → `{ posture, symmetry, issues[], recommendations[], score }` (sent as image_url data URL; if AvalAI lacks video base64 support it treats first frame as image)
- `analyzeBloodTest(base64Image, mimeType)` → `{ overall, score, markers[], deficiencies[], recommendations[], warnings[] }`

All vision functions:
- Send image as `{ type: "image_url", image_url: { url: "data:${mimeType};base64,..." } }` in user message content array (Gemini multimodal format via OpenAI-compatible API)
- Use `{ role: "system", content: ... }` + `{ role: "user", content: [text, image_url] }`
- Request JSON-only output with strict schema
- Parse response via `parseJsonFromContent()` and coerce numeric fields with `Number() || 0` and array fields with `Array.isArray()` guards
- Wrapped in try/catch with Persian error messages

#### 4. Preserved (unchanged)
- `getAiConfig(key, fallback)` — reads AiConfig from DB
- `buildUserContext()` — builds Persian user context string
- `buildPlanAwareInstructions()` — plan-tier-aware prompt block
- All `DEFAULT_*_PROMPT` constants (COACH, CHAT, NUTRITION, NIKA)
- `parseJsonFromContent()` helper (handles ```json fences + {…} extraction)
- All function signatures, parameters, and return types

## Verification
- `bun run lint` → **0 errors** (17 pre-existing "Unused eslint-disable directive" warnings in OTHER files, none in ai.ts)
- `bunx tsc --noEmit` → **0 errors in ai.ts** (one pre-existing TSC error in `src/lib/fitness/use-nika-chat.ts:103` about ChatMessageDto role narrowing — untouched file, out of scope, was present before this task)
- No other source files import `z-ai-web-dev-sdk` (grep confirmed only ai.ts previously; now zero)
- No `z-ai` CLI commands referenced in any script

## Notes for Future Agents
- The `thinking: { type: "disabled" }` parameter is AvalAI-specific (not part of OpenAI SDK types). It is passed via top-level key with `as any` cast on the request body. Do NOT add `// @ts-expect-error` directives — the `as any` cast already suppresses the excess-property error, and `@ts-expect-error` would trigger TS2578 ("Unused directive").
- The 4 new vision functions are exported but NOT yet wired to any API route. Future agents can create routes like `/api/coach/analyze-meal-photo`, `/api/coach/analyze-body`, `/api/coach/analyze-video`, `/api/coach/analyze-blood-test` that call these functions. Auth/gating should use existing `requirePlanCapability()` for mealPhotoAnalysis / bodyPhotoAnalysis / videoBodyAnalysis / bloodTest capabilities.
- `z-ai-web-dev-sdk` is still listed in package.json dependencies (line 80). It is no longer imported anywhere in src/. Could be removed in a future cleanup pass but left in place to avoid touching package.json/bun.lock unnecessarily.
- The old code used `role: "assistant"` for the system prompt (worked with z-ai SDK but is semantically wrong). The new code correctly uses `role: "system"`. This may slightly change AI behavior (system role is weighted differently than assistant role) — generally an improvement for instruction-following.
