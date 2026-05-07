# Phase 2 — MCP tool implementation plan (v2)

Replaces the original chat-only plan after the critique at [`phase-2-tools-implementation-critique.md`](./phase-2-tools-implementation-critique.md). User approved all 10 recommendations; this document encodes them.

## Context

`tools/list` currently exposes 43 tools, of which **35 throw `NotImplementedError` on call**. The most prominent gap surfaced this session: claude.ai connected, listed tools, picked `write_linkedin_post`, hit the stub. Phase 2 brings the surface to **only-real-tools** (filtered + implemented).

## Authoritative inputs

- `CLAUDE.md` at workspace root (TDD non-negotiable, write-to-file, GLOSSARY primacy, DB Write Rules)
- `visibilio-mcp/GLOSSARY.md` (`Session`, `AuthContext`, `Scope`, `ToolDescriptor`, `VisibilioClient`, `RetryableError`, `TenantHeaders`, `IntrospectionResult`, `KnownOAuthClient` — and `ScopeError` declared but not yet in code)
- Existing functional tools as reference patterns: `audience.ts:listAudiences`, `briefing.ts`, `organization.ts`, `content-plans.ts:listContentPlans`
- Project memory `project_visibilio_ai_backend_v2.md` (workflow snapshot semantics, knowledge versioning, `KnowledgeBaseManager` indirections, `--timeout=300` Cloud Run flag)

## Locked decisions

| # | Decision | Outcome |
|---|---|---|
| 1 | Writers run sync poll, **120s default**, configurable via tool arg `timeout_seconds` | One unified `runWorkflow` helper |
| 2 | `auto_confirm = true` by default for writers | Explicit `start_workflow` + `confirm_workflow` primitives stay for power users |
| 3 | **Persistence: Option A (transient)** — writers return text; no MCP-triggered DB writes | `save_content_item` deferred to a separate Phase 2.5 plan |
| 4 | **11 small PRs** in order (14a … 16d) | Each independently testable in claude.ai; one batch per merge |
| 5 | **Scope enforcement implemented in PR 14d** | New `ScopeError` class lands in code matching GLOSSARY; `defineTool({ requiredScopes })` |
| 6 | **Stubs filtered out of `tools/list`** | `stubTool()` returns `null`; aggregator filters; `tools/call` for unknown name → standard JSON-RPC method-not-found |
| 7 | `generate_image` and `get_source_status` deferred (Phase 2.5) | Filtered like other stubs |
| 8 | `generate_personas` shape verified before PR 15c starts | If SSE-only → defer to Phase 2.5 |
| 9 | Tool annotations for Anthropic submission | **Out of Phase 2 scope** |
| 10 | `KnownOAuthClient` / Claude consent branding | **Out of Phase 2 scope** |

## Skills loaded for execution

Each PR loads, on entry:
- `tdd` — strict RED→GREEN→REFACTOR cycle on every commit
- `testing` — behavior-driven assertions, factory fixtures, no shared state
- `expectations` — captures gotchas after each PR (see "Expectations log" below)
- `domain-driven-design` — consult GLOSSARY before any new term

## Pre-flight (one-off, before PR 14a)

**COMPLETED.** See [`phase-2-backend-endpoint-map.md`](./phase-2-backend-endpoint-map.md). Key findings:
- All 12 writers route through `POST /api/v2/workflow/start` with `repurpose_targets: [contentType]` for deterministic routing
- `generate_personas` confirmed SSE-only → **deferred to Phase 2.5**
- `research_market` likely SSE-only → **PR 15c first commit verifies**, defer if confirmed
- `get_audience` has no backend endpoint → **client-side filter on `list_audiences`**
- All other endpoints sync + already-shaped per the map

The pre-flight was a planning artifact, not a PR. PRs 14a–16d now have explicit endpoint contracts.

---

## PR sequence

Each PR follows the same shell:
1. RED — failing test(s) committed first.
2. GREEN — minimum code to pass, committed.
3. REFACTOR — only if it adds value, separate commit.
4. Quality gate before push: `npm run lint && npx tsc --noEmit && npx vitest run && npm run build`. All green, no regressions in the 151 existing tests.
5. PR opened with body referencing this plan + the specific section.
6. After CI green, **wait for explicit user approval** before merge.
7. Merge → auto-deploy via `deploy-cloud-run.yml` (~3-5 min) → user retests in claude.ai → next PR.

### PR 14a — `runWorkflow` helper + `write_linkedin_post`

**Scope:** introduce the shared workflow-poll helper and wire one writer end-to-end, proving the pattern.

**Files:**
- `src/tools/_workflow.ts` (NEW)
- `src/tools/content.ts` (modify: replace `stubTool('write_linkedin_post')` with real handler)
- `tests/integration/tools/content.test.ts` (NEW)
- `tests/integration/tools/_workflow.test.ts` (NEW)

**Behaviors covered (each its own test, factory-built fixtures):**
- `runWorkflow` — start request hits `${backendUrl}/workflow/start` with the spec body; returns `execution_id` from response
- `runWorkflow` — polls `/workflow/{id}/status` at configurable interval until `status='completed'`, returns final output
- `runWorkflow` — returns last-known status with `execution_id` when timeout exceeds `timeout_seconds`
- `runWorkflow` — surfaces non-retryable backend errors via `formatHttpError` (transient ones are already retried by `VisibilioClient`)
- `write_linkedin_post` — happy path: brief in → backend `/workflow/start` with `content_type=linkedin_post` → text out
- `write_linkedin_post` — long execution: returns timeout-explanatory string with `execution_id` and instruction to call `get_workflow_status`
- `write_linkedin_post` — backend 404 / 500 — formatted error string

**Out of file scope:** other 11 writers (PR 14c), scope enforcement (14d).

**Exit criteria:** all 8 behaviors green, 151 prior tests still green, manual verification — `tools/call` of `write_linkedin_post` from a real `vat_*` Bearer returns LinkedIn-shaped text.

### PR 14b — backend endpoint map + spec docstring updates

**Scope:** lock the mapping that PR 14c depends on. No production code changes — only `spec/mcp-tools.json` and `plans/phase-2-backend-endpoint-map.md`.

**Files:**
- `plans/phase-2-backend-endpoint-map.md` (created from pre-flight, finalized here)
- `spec/mcp-tools.json` (writer entries get `docstring` updates noting "calls a stateless content generator; does not persist; brief should describe audience + tone + key points; expect 30-90s")

**No tests.** This is a documentation PR. Reviewer checks: docstrings render correctly through `defineTool`, no schema drift in spec.

### PR 14c — remaining 11 writers

**Scope:** `write_blog_article`, `write_tweet`, `write_facebook_post`, `write_newsletter`, `write_press_release`, `write_email_campaign`, `write_instagram_caption`, `write_youtube_description`, `write_tiktok_script`, `write_website_copy`, `write_ad_copy`.

**Pattern:** each is a one-liner around `runWorkflow`. The whole file `src/tools/content.ts` becomes:

```ts
import { defineTool, type ToolDescriptor } from './_define.js';
import { runWorkflow } from './_workflow.js';

const writer = (name: string, contentType: string): ToolDescriptor =>
  defineTool(name, async (args, session) =>
    runWorkflow(session, { contentType, brief: String(args.brief ?? ''), timeoutSeconds: Number(args.timeout_seconds ?? 120) }),
  );

export const contentTools = [
  writer('write_linkedin_post', 'linkedin_post'),
  writer('write_blog_article', 'blog_article'),
  // ... 10 more
];
```

**Behaviors covered:** 1 representative happy-path + 1 timeout test per writer = 22 tests. Reusing the same `runWorkflow` test infrastructure from PR 14a; no per-writer custom logic.

**Exit criteria:** 22 new tests green; 151 + 8 + 22 = 181 total green.

### PR 14d — scope enforcement

**Scope:** introduce `ScopeError` (matches GLOSSARY definition); `defineTool({ requiredScopes })`; dispatcher check in `src/server.ts` (`tools/call` handler).

**Files:**
- `src/auth.ts` — export `ScopeError extends Error`
- `src/tools/_define.ts` — `ToolDescriptor` gains `requiredScopes: readonly Scope[]`; `defineTool` accepts it (default `['mcp:read']`)
- `src/server.ts` — `tools/call` checks scope before dispatch; throws `ScopeError`; MCP server handler returns proper JSON-RPC error
- All 12 writers in `content.ts` — explicitly tagged `requiredScopes: ['mcp:write']`
- `tests/integration/server.scope-enforcement.test.ts` (NEW)
- `GLOSSARY.md` — confirm/update `ScopeError` entry

**Behaviors covered:**
- Read-only Bearer + write tool → `ScopeError`, no backend call recorded (mock fetch never called)
- Write Bearer + write tool → succeeds
- Read-only Bearer + read tool → succeeds
- Tool with default `requiredScopes` (no explicit value) treated as `['mcp:read']`
- `tools/list` returns ALL registered tools regardless of session scope (per GLOSSARY)

**Exit criteria:** existing flow (vsk_ keys with implicit `[mcp:read, mcp:write]` scopes from `resolveApiKey`) continues to work — explicit assertion in tests.

### PR 15a — Intelligence trio (analyze/score/validate)

**Tools:** `analyze_content`, `score_relevance`, `validate_voice`. Each is a direct POST to `/api/v2/intelligence/<endpoint>` per the backend map; no workflow polling.

**Files:** `src/tools/intelligence.ts`, `tests/integration/tools/intelligence.test.ts`

**Behaviors:** 1 happy + 1 error per tool = 6 tests. Output formatting via existing `formatHttpError` for failures.

### PR 15b — Intelligence pair (crawl/discover)

**Tools:** `crawl_urls`, `discover_sources`. `get_source_status` deferred per decision #7.

**Files:** same as 15a.

**Behaviors:** 1 happy + 1 error per tool = 4 tests. Long-running flag: `crawl_urls` may need workflow-style polling — verify in pre-flight; if so, reuse `runWorkflow`.

### PR 15c — Strategy + market

**Tools:** `generate_strategy`, `research_market`. `generate_personas` deferred-or-shipped depending on pre-flight verdict (decision #8).

**Files:** `src/tools/strategy.ts`.

**Behaviors:** 1 happy + 1 timeout per tool. Shape mirrors writers since these are workflow-driven.

### PR 16a — Workflow primitives

**Tools:** `start_workflow`, `confirm_workflow`, `get_workflow_status`, `cancel_workflow`. These are explicit primitives that power users invoke directly (writers wrap them auto-confirmed).

**Files:** `src/tools/workflow.ts`.

**Behaviors:** each tool gets happy + 404 + invalid-state error tests = 12 tests.

### PR 16b — Knowledge

**Tools:** `get_knowledge`, `update_knowledge`, `search_knowledge` (existing `get_knowledge` is partially real — verify scope; `search_knowledge` and `update_knowledge` are stubs).

**Files:** `src/tools/knowledge.ts`.

**Behaviors:** 1 happy + 1 error per tool = 6 tests. `update_knowledge` is `requiredScopes: ['mcp:write']`; the others stay `mcp:read`.

**Note:** `KnowledgeBaseManager` server-side serialization (project memory: `insert_knowledge_versioned` Postgres function with advisory locks) means concurrent `update_knowledge` from different sessions is safe at the DB layer. Tool layer doesn't need lock awareness.

### PR 16c — Onboarding

**Tools:** `start_onboarding`, `get_onboarding_status`, `validate_onboarding`. Onboarding is one of two backend flows that DO write to DB (per CLAUDE.md DB Write Rules: "Backend writes for long-running background jobs (onboarding → `knowledge_base`)").

**Files:** `src/tools/onboarding.ts`.

**Behaviors:** 1 happy + 1 error per tool = 6 tests. Tool writes through to backend; backend persists; tool returns execution_id + status.

### PR 16d — Misc + content plans

**Tools:** `get_audience` (filter on `list_audiences`), `get_content_plan`, `generate_content_plan`, `get_content_plan_status`. `generate_image` deferred per decision #7.

**Files:** `src/tools/audience.ts`, `src/tools/content-plans.ts`.

**Behaviors:**
- `get_audience(persona_id)` happy + not-found = 2 tests; uses cached `list_audiences` response under the hood
- 3 content-plan tools — happy + error each = 6 tests

---

## Cross-cutting concerns

### Argument validation

`spec/mcp-tools.json` defines `args: string[]` for each tool. The current `argsToJsonSchema` produces a permissive schema (`type: string`, no required, additionalProperties false). Phase 2 keeps this — no Zod-based runtime parser added. Tools coerce inputs as needed at the call site (`String(args.brief ?? '')` pattern). Adding a typed validator would help; deferred to Phase 3.

### Error propagation

All tool handlers return `Promise<string>` (existing convention). Errors come back as formatted strings via `formatHttpError`. **Two new exit codes** can come from a tool now:
- `ScopeError` → JSON-RPC error code (numeric, conventional MCP), NOT a tool result string
- Backend non-retryable 4xx → string starting with `Error ...` per existing pattern

The MCP `Server.setRequestHandler('tools/call', ...)` at `src/server.ts` translates `ScopeError` to JSON-RPC `code: -32603` (or whatever convention MCP uses for authorization failures — verified during PR 14d).

### DB Write Rules compliance

Per CLAUDE.md table: only `start_onboarding` (PR 16c) triggers a backend-driven DB write (legitimate exception per the rule). Every other tool either:
- READS via backend (`list_audiences`, `get_briefing`, `search_knowledge`, …)
- READS via gateway (none in Phase 2 currently)
- generates transient content via backend (`write_*`, `generate_strategy`)

No tool writes to DB through Gateway in Phase 2. `save_content_item` (the would-be Gateway-write tool) is explicitly deferred (Phase 2.5).

### Skipped tool visibility

`stubTool()` returns `null`. Aggregator (`src/tools/index.ts`) filters `nulls` before exposing `allTools`. Result: `tools/list` lists only what works. Specifically removed from current public surface in Phase 2:
- `generate_image` — endpoint TBD (Phase 2.5)
- `get_source_status` — endpoint TBD (Phase 2.5)
- `generate_personas` — IF streaming-only (TBD pre-flight)

These tools' `defineTool` calls are removed from their respective `*.ts` aggregators; their spec entries in `spec/mcp-tools.json` stay (so the metadata is documented; just not exposed). The `_define.ts` `stubTool()` factory is kept for future tools that should be discoverable but not callable yet (e.g., during incremental phase rollouts).

### Knowledge snapshot semantics warning

Project memory: backend's `Orchestrator._get_knowledge_context` builds knowledge_snapshot once per execution_order level. Phase 2 tools call backend stateless flows; this snapshot semantics doesn't bleed into our tool layer. Documented in writer docstrings (PR 14b) so Claude and human readers understand the boundary.

### Test isolation

All new tests follow CLAUDE.md testing rules:
- Factory functions for fixtures, no `let` / `beforeEach` shared state
- Mock `fetch` per-test (existing `buildOkAuthFetch` / `buildFailAuthFetch` patterns extended for backend POST/GET)
- Tests assert behavior (return values, side-effects, error shapes), not implementation details (function names, internal state)
- No 1:1 file mapping forced — `_workflow.test.ts` covers a helper used by 12 tools; that's intentional

---

## Out of scope (explicit list)

| Item | Why deferred | Owner |
|---|---|---|
| `save_content_item` tool (Option C persistence) | Separate use case; needs new gateway endpoint | Phase 2.5 |
| `generate_image` | Backend endpoint location unverified | Phase 2.5 |
| `get_source_status` | Endpoint mapping unclear | Phase 2.5 |
| `generate_personas` if streaming | SSE consumer in Node MCP non-trivial | Phase 2.5 if needed |
| Tool annotations (`title`, `readOnlyHint`, `destructiveHint`) | Anthropic submission requirement; bundling here would dilute focus | Pre-submission PR |
| `KnownOAuthClient` / Claude consent branding | UX polish; functionally unaffected | Pre-submission PR |
| Streamable HTTP transport migration | Anthropic accepts legacy SSE per current behavior; only required if submission demands | Phase 7.6 if needed |
| Logo, screenshots, privacy policy, ToS | Anthropic submission package | Pre-submission |
| Slack OAuth integration | Separate plan: [`phase-8-slack-integration.md`](./phase-8-slack-integration.md) — independent workstream, can run in parallel | Phase 8 |
| `*.visibilio.ai` DNS provisioning | Operational; not blocking | Ops backlog |

---

## Risks (revised after critique)

| Risk | Severity | Mitigation |
|---|---|---|
| Backend endpoints differ from inferred shapes | **High** | Pre-flight PR-less appendix locks shapes BEFORE writing helper code |
| Scope enforcement regressions on existing flows | Medium | Default `requiredScopes: ['mcp:read']`; vsk_ keys grant both read+write per `resolveApiKey`; explicit test of existing flow in PR 14d |
| `tools/list` surface shrinks visibly in claude.ai | Low | Acceptable; UX improvement |
| `generate_personas` SSE-only blocks PR 15c | Medium | Pre-flight reveals; defer cleanly with documentation |
| Backend `MAX_CONCURRENT_LLM_CALLS=4` causes slow polls under parallel tool calls | Low | Documented in writer docstrings |
| `--update-env-vars` regression on Cloud Run via deploy workflow | Already mitigated (PR #13 in this repo, awaiting merge) | Verify env vars survive PR 14a's auto-deploy as a smoke gate |
| 11 PRs × auto-deploy = 11 × 5min Cloud Run rebuilds | Low | Acceptable; gives natural pause for manual retests |

---

## Expectations log

After each PR, capture in [`plans/phase-2-expectations.md`](./phase-2-expectations.md) (created at PR 14a):
- What was unexpected vs the plan
- Backend gotchas discovered
- Test-design choices that surprised
- "What I wish I'd known before starting"

This is the `expectations` skill artifact CLAUDE.md prescribes. Read at the start of every subsequent PR.

---

## Related plans

- [`phase-8-slack-integration.md`](./phase-8-slack-integration.md) — Slack bot as OAuth client of our MCP. **Independent workstream.** Depends on Phase 7 OAuth (done), not on Phase 2. Can ship with the 8 currently-real tools and expand surface as Phase 2 PRs land.
- [`phase-2-tools-implementation-critique.md`](./phase-2-tools-implementation-critique.md) — rationale for the locked decisions in this plan.

## Approval gate

This v2 plan supersedes the original chat plan. **No code is written until user explicitly approves this file.** Once approved, next step is **PR 14a pre-flight**: I curl backend `/workflow/start` with a real `vat_*` token, write `plans/phase-2-backend-endpoint-map.md`, then start the RED→GREEN cycle.
