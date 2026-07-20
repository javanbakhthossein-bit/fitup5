---
Task ID: ARCH-FOUNDATION
Agent: full-stack-developer
Task: Build extensible architecture foundation (AI agent registry + payment provider abstraction + feature flags)

# Work Record

## Summary

Added three new extensible architecture modules to the فیتاپ (FitUp) codebase:
1. **AI Agent Registry** (`src/lib/agents/`) — self-registering pattern for AI agents
2. **Payment Provider Abstraction** (`src/lib/payment/`) — provider-agnostic payment layer
3. **Feature Flags System** (`src/lib/features/`) — extensible feature gating

All three systems use the **self-registering pattern**: each module registers itself into a module-level array on import via a side-effect. New agents/providers/features can be added by creating a single file and adding one import line.

## Files Created

### Task 1: AI Agent Registry (7 files)
- `src/lib/agents/types.ts` — `AgentContext`, `AgentResult`, `AIAgent` interfaces + `AgentPlan` type
- `src/lib/agents/registry.ts` — `AGENT_REGISTRY` array + `registerAgent`, `getAgent`, `listAgents`, `listAgentsForPlan`, `planLabel` functions
- `src/lib/agents/agents/seo-agent.ts` — wraps existing `runSeoAgent` from `src/lib/fitness/seo-agent.ts` as a registered AIAgent (id: `seo-agent`, model: deepseek-v4-flash, requiredPlan: null = admin-only via API)
- `src/lib/agents/agents/onboarding-analyzer.ts` — wraps onboarding analysis logic (BMI/BMR/TDEE + AI prompt) as a registered AIAgent (id: `onboarding-analyzer`, requiredPlan: null = free for all). Extracted `calculateBodyMetrics()` pure helper + reusable `analyzeOnboarding(userId, log)` function.
- `src/lib/agents/index.ts` — barrel export + side-effect imports of all built-in agents
- `src/app/api/agents/route.ts` — GET endpoint that lists registered agents with metadata; admin sees all, regular users see plan-filtered, unauthenticated see only free agents

### Task 2: Payment Provider Abstraction (4 files + 1 updated)
- `src/lib/payment/types.ts` — `PaymentProvider` interface + `PaymentRequestParams`/`Result`, `PaymentVerifyParams`/`Result`
- `src/lib/payment/registry.ts` — `PROVIDERS` array + `registerProvider`, `getProvider`, `getActiveProvider`, `listProviders`, `listConfiguredProviders`
- `src/lib/payment/providers/zarinpal.ts` — `ZarinpalProvider` class implementing `PaymentProvider` + backward-compatible exports (`zarinpalRequest`, `zarinpalVerify`, `isZarinpalConfigured`, `isZarinpalSandbox`, `buildCallbackUrl` + old types). Supports sandbox mode (controlled by `PAYMENT_SANDBOX=true` env var when `ZARINPAL_MERCHANT_ID` is "TEST" or unset).
- `src/lib/payment/index.ts` — barrel export + side-effect import of zarinpal provider + re-export of backward-compat API
- `src/lib/fitness/zarinpal.ts` (updated) — now a thin re-export from `@/lib/payment/providers/zarinpal` (preserves all old exports/behavior for existing checkout/verify routes)

### Task 3: Feature Flags System (2 files + 1 updated)
- `src/lib/features/types.ts` — `Feature` interface + `FeaturePlan` type + `FEATURES` constant (12 features: 11 user-facing + 1 admin-only `seo_agent`)
- `src/lib/features/index.ts` — `canAccess`, `canAdminAccess`, `getFeature`, `listAllFeatures`, `listFeaturesForPlan`, `listFeaturesForAdmin`
- `src/lib/fitness/types.ts` (updated) — added doc comment to existing `canAccess(planId, capability)` pointing to new system (no behavior change; both systems coexist)

## Key Decisions

### 1. Self-registering pattern via side-effect imports
Each agent/provider file calls `registerAgent(...)` / `registerProvider(...)` at module load time. The barrel `index.ts` files contain `import "./agents/seo-agent";` (no named imports) — this is the side-effect that triggers registration. To add a new agent/provider, you create one file + add one import line to `index.ts`. The registry functions handle HMR deduplication (replace by id).

### 2. Separation of types and implementation
`types.ts` files contain ONLY interface/type declarations (no `const`/`function` implementations). `registry.ts` / `index.ts` files contain the actual implementations. This cleanly separates contract from implementation and avoids duplicate module instances.

### 3. Sandbox logic for Zarinpal
The sandbox mode requires BOTH conditions (per task spec):
- `ZARINPAL_MERCHANT_ID` is "TEST" or unset, AND
- `PAYMENT_SANDBOX=true` is explicitly set

If only the merchant is "TEST" (without `PAYMENT_SANDBOX=true`), the behavior falls back to the OLD behavior (`isZarinpalConfigured()` returns false → existing checkout/verify routes use their own simulated fallback). This preserves backward compatibility with the existing production environment.

### 4. Two canAccess functions coexist
- Old: `canAccess(planId: Plan, capability: keyof PlanCapabilities)` in `src/lib/fitness/types.ts` — fine-grained capability checks (e.g., `aiChatQuestions`, `chatImageUpload`). **Unchanged behavior.**
- New: `canAccess(planName: string, featureId: string)` in `src/lib/features/index.ts` — coarse-grained feature gating for marketplace (e.g., `workout_plan`, `blood_test_analysis`). Empty `plans` array = admin-only.

They have different signatures and operate on different concepts, so no name collision. Added a `@see` doc comment to the old function pointing to the new system.

### 5. SEO agent wrapper delegates to existing logic
`src/lib/agents/agents/seo-agent.ts` does NOT re-implement the SEO agent — it imports `runSeoAgent` from `src/lib/fitness/seo-agent.ts` and wraps it. The agent's `run()` method creates a `SeoAgentRun` DB record and calls `runSeoAgent()` synchronously (awaiting completion). Future API routes can call `getAgent("seo-agent")` and invoke it through the registry instead of importing the implementation directly.

### 6. Onboarding analyzer extracts reusable function
`analyzeOnboarding(userId, log?)` is a pure reusable function that does what the existing `/api/onboarding/analysis` route does (minus the profile/baseline display data, which is a UI concern). The existing API route is unchanged for now — both can coexist. A future task can refactor the route to call `analyzeOnboarding()` and just add the profile/baseline display data on top.

## Verification Results

- `bun run lint` → **0 errors, 29 warnings** (all warnings pre-existing in OTHER files — none from new code)
- Dev server compiles all new modules successfully:
  - `GET /api/agents` → 200 OK, returns `{"agents":[...2 agents...],"total":2,"viewer":{"isAdmin":false,"planName":null}}`
  - `POST /api/payment/checkout` → 401 (compiles, requires auth — confirms re-export pattern works)
  - `POST /api/payment/verify` → 401 (compiles, requires auth)
  - `GET /api/admin/seo-agent` → 401 (compiles, requires admin)
- Both registered agents visible in `/api/agents` response: `onboarding-analyzer` and `seo-agent`
- Existing imports of `@/lib/fitness/zarinpal` continue to work (verified via checkout/verify route compilation)

## How to Extend (for future AI agents / developers)

### Add a new AI agent
1. Create `src/lib/agents/agents/my-agent.ts`:
   ```typescript
   import { registerAgent } from "../registry";
   import type { AIAgent } from "../types";
   const myAgent: AIAgent<MyInput, MyOutput> = { id: "my-agent", ..., run: async (ctx, input) => {...} };
   registerAgent(myAgent);
   ```
2. Add `import "./agents/my-agent";` to `src/lib/agents/index.ts`
3. Done — the agent is now discoverable via `getAgent("my-agent")` and listed in `/api/agents`

### Add a new payment provider
1. Create `src/lib/payment/providers/my-provider.ts` implementing `PaymentProvider`
2. Call `registerProvider(provider)` at end of file
3. Add `import "./providers/my-provider";` to `src/lib/payment/index.ts`
4. Done — `getActiveProvider()` will auto-pick the first configured provider

### Add a new feature flag
1. Add a new entry to `FEATURES` array in `src/lib/features/types.ts`
2. Done — `canAccess(planName, featureId)` and `listFeaturesForPlan(planName)` will pick it up automatically
