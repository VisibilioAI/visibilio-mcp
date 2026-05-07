# Phase 2 plan — critical review

Inputs: original plan from chat session (35 stub tools → fully wired), `CLAUDE.md` at workspace root, `visibilio-mcp/GLOSSARY.md`, `visibilio-mcp/src/{tools,session,client}.ts`, project memory `project_visibilio_ai_backend_v2.md` (2026-04-11 snapshot, age-flagged).

The plan is mostly right on shape but **breaches several non-negotiable rules from `CLAUDE.md`** and silently introduces concepts that already have authoritative names in `GLOSSARY.md`. It also under-specifies a few load-bearing architectural decisions. Specifics below.

---

## 1. `CLAUDE.md` non-compliance

### 1.1 The plan was produced in chat, not as a file

`CLAUDE.md` → Output Guardrails: *"Write to files, not chat — When asked to produce a plan, document, or artifact, always persist it to a file."* and *"Plans live in `plans/` directory at repo root."*

`visibilio-mcp/plans/` does not exist. The plan must live at `visibilio-mcp/plans/phase-2-tools-implementation.md`. This critique itself sits at `phase-2-tools-implementation-critique.md` next to it.

### 1.2 No skill loading discipline

`CLAUDE.md` lists `tdd`, `testing`, `planning`, `domain-driven-design`, `expectations`, `refactoring` as skills to load on demand. The plan promised "TDD discipline" without committing to load any of them. For a 35-tool implementation, the plan should explicitly load:

- `planning` while drafting
- `tdd` for every RED→GREEN cycle
- `testing` for behavior-driven assertions and factory-based fixtures
- `domain-driven-design` before introducing any new term
- `expectations` after each PR to capture gotchas (the backend is full of them — see §4)

### 1.3 Wait-for-approval-before-every-commit

`CLAUDE.md` → *"Wait for approval before every commit."* The plan implicitly assumed long autonomous coding stretches inside each PR. For 12 writers + 9 strategy/intelligence + 11 misc tools that's roughly 30+ commits. The plan must flag this and either (a) carve PRs at commit boundaries or (b) state that user approves a batch of commits per PR-merge cadence.

### 1.4 No mention of `frontend-check` / `backend-check` (and there is no MCP-check)

The plan says "lint + typecheck + tests". `CLAUDE.md` formalizes these as quality-gate skills for backend Python and frontend TS. The MCP repo has a similar gate (`npm run lint && tsc --noEmit && vitest run && tsup`). The plan should commit to running this combined gate on every PR before opening, not just before merging.

### 1.5 Comments rule

`CLAUDE.md` → *"No comments — code should be self-documenting through naming."* The plan does not mention this. Every helper introduced in the plan (`runContentWorkflow`, `parseToolArgs`) must ship with zero comments. Existing `audience.ts` already complies; the new files must hold the line.

---

## 2. `GLOSSARY.md` drift

`CLAUDE.md` → *"Update `GLOSSARY.md` whenever a new domain term is introduced in code"* and *"use the exact terms defined there"*.

The plan invented terms that collide with or duplicate already-authoritative ones:

| Plan invented | GLOSSARY canonical | Action |
|---|---|---|
| `runContentWorkflow` (helper) | The flow itself is `WorkflowExecution` driven by `execution_id`. The helper should be named after the responsibility (`awaitWorkflowResult`, `runWorkflow`) | Rename, document in GLOSSARY if it survives refactor |
| `parseToolArgs` (helper) | Argument validation is unspecified in glossary; existing tools rely on `argsToJsonSchema` from spec entries | Either drop (unnecessary new abstraction) or define `ToolInput` in GLOSSARY |
| `ContentWorkflowKind` (suggested) | No precedent. Backend likely names this `content_type` (e.g. `linkedin_post`, `blog_article`) | Use backend's vocabulary verbatim; do not coin a new type name |
| Filter "stubs" from `tools/list` | GLOSSARY's `Scope` already specifies the dispatcher behavior: *"Read-only sessions can `tools/list` write tools but cannot `tools/call` them — the dispatcher rejects with `ScopeError`."* | The plan must not invent a different filter axis. Stubs are filtered, scopes are filtered — these are two orthogonal filters and must be named distinctly. |

### 2.1 `ScopeError` is already in the GLOSSARY but not in code

Quoting GLOSSARY: *"`ScopeError` ... rejects with ScopeError before reaching the backend."* — there is **no `ScopeError` class in `src/`** today (verified by inspection of `auth.ts` and `_define.ts`). It's a planned-but-unimplemented term. **Phase 2 is the right moment to introduce it**, because tools like `write_*` are write operations and need scope-gating that doesn't yet exist. The original plan does not mention this; that's a gap.

### 2.2 `RetryableError` is already wired

`src/client.ts` already implements `RETRYABLE_STATUSES` + retry loop in `request()`. The plan must NOT add ad-hoc retries inside tool handlers (would duplicate). Tools call `session.client.backendPost(...)`, the client retries on 429/502/503/504, and the tool only handles non-retryable 4xx semantics.

---

## 3. Architecture compliance — DB Write Rules and statelessness

`CLAUDE.md` → DB Write Rules: *"Default: Gateway writes to DB. The API Gateway is the primary DB writer for all user-facing flows. The AI Backend is stateless for content flows — it generates via LLM and returns results only."*

Cross-checked against the project memory snapshot (`project_visibilio_ai_backend_v2.md`): confirmed. Backend's content flows return generated text; they do not persist. So `write_linkedin_post` calling `POST /workflow/start` fits the rule — backend generates, backend returns text, MCP relays to Claude, Claude shows to user. No DB write triggered by the tool itself.

But the plan **silently underspecifies persistence**. There are three plausible designs and the plan picked none:

| Option | Tool returns | DB write side-effect |
|---|---|---|
| A — Transient (mirror backend statelessness) | Generated text only | None |
| B — Auto-persist (frontend's current behavior) | content_item id + text | Gateway-write to `content_items` triggered by MCP via a NEW gateway endpoint |
| C — Two-tool split | `write_*` returns text; `save_content_item` persists | Gateway-write only on explicit `save_content_item` |

**Recommendation: Option C.** Reasons:
1. Matches the principle "MCP server is a programmatic surface for Claude" — Claude decides when to persist, like a human user clicking Save.
2. Fits the existing GLOSSARY (`ToolDescriptor`s are independent atoms; introducing `save_content_item` is just one more atom).
3. Avoids the "Claude generates 12 LinkedIn posts in a brainstorm and we accidentally persisted all 12" footgun.
4. Keeps writers idempotent and pure — no DB side-effects, easier to test, easier to retry.

**Implication**: Option C adds one tool to the spec (`save_content_item`) that doesn't exist today. That's a backend spec addition the plan didn't budget for. Out of scope of Phase 2 if we ship Option A and defer Option C to Phase 2.5; both are acceptable.

---

## 4. Backend reality vs research-agent claims

The Explore agent inferred backend endpoints from text. Cross-referenced with the project memory:

| Plan claim | Reality check | Risk |
|---|---|---|
| `POST /workflow/start` is the universal hub for writers, strategy, research_market | Memory confirms there is a workflow orchestrator (`Orchestrator._get_knowledge_context`); confirms `execution_id`. Does NOT confirm a single `/workflow/start` accepts a discriminator parameter for content type. | **Verify with curl + a real `vat_` token before writing helper.** This is the load-bearing assumption of PR #14. |
| `/intelligence/*` endpoints exist for analyze/score/validate/crawl/discover | Plausible per `intelligence_router.py` reference in memory. | Verify each endpoint independently. Each has its own request/response shape. |
| `generate_personas` streams over SSE | Memory mentions audience-generation but not transport. | Plan must not depend on this until verified. If true, **streaming SSE consumer in Node MCP is non-trivial** — undici has streaming `Response.body` but the MCP tool surface (handler returns `Promise<string>`) needs to collect-and-buffer. **Punt to Phase 2.5 if streaming.** |
| `/onboarding/start-async` and `/onboarding/execution/{id}` | Memory mentions onboarding but not these specific paths. | Verify. |

**Plan correction**: PR #14 must start with a "endpoint smoke test" step. Curl each candidate endpoint with the prod `vat_` flow we already validated. Document actual request/response shapes in the plan as we go. THEN write tools. Without this, half the tests will fail at integration time and we'll backtrack.

---

## 5. Knowledge snapshot semantics and concurrent writers

From project memory: *"`Orchestrator._get_knowledge_context` builds a `knowledge_snapshot` ONCE per `execution_order` level... Sequential `agent.execute` calls within one workflow level will all read the same stale `scene_recency`."*

This means: if Claude calls `write_linkedin_post` twice in quick succession (same workflow level), the second call sees the same knowledge state as the first. For most content types (one-off posts) this is fine — they don't read scene_recency. For tools that DO depend on freshness (anything that learns from prior outputs in the same session), this is a known trap.

**Plan correction**: every writer's brief must say "calls a stateless content generator" so we don't accidentally rely on side-effects between calls. Put this in the tool description (`docstring` in `spec/mcp-tools.json`) so Claude correctly understands the tool boundary.

---

## 6. Scope enforcement (`mcp:read` / `mcp:write` / `mcp:admin`)

GLOSSARY says scope-gating already happens at the dispatcher. **Code says it doesn't.**

`src/auth.ts` resolves the AuthContext including `scopes: string[]`. But `_define.ts` doesn't tag tools with required scopes. The dispatcher in `src/server.ts` (or wherever `tools/call` is registered) doesn't check scopes against the tool. So today, a `vat_*` token with only `mcp:read` could call `write_linkedin_post` and the backend would do the work.

**Phase 2 must close this gap.** Two pieces:
1. `defineTool()` accepts a `requiredScopes: readonly Scope[]` argument (default `['mcp:read']`).
2. `tools/call` dispatcher checks `session.auth.scopes ⊇ tool.requiredScopes`; throws `ScopeError` (new class) → returned as JSON-RPC error with `code=403` semantically.

Tests for this:
- Read-only Bearer + write tool → ScopeError, no backend call recorded
- Write Bearer + read tool → succeeds
- `tools/list` includes write tools regardless of scope (per GLOSSARY)

Add ScopeError to GLOSSARY when it lands in code.

---

## 7. PR sizing and TDD cadence

Original plan: 3 mega-PRs (#14 12 writers, #15 9 strategy/intelligence, #16 11 misc). Average ~4 hours / 25 commits each. Conflicts with `CLAUDE.md` "wait for approval before every commit".

**Revised PR cadence (one batch per merge, but each batch is ≤ ~6 commits):**

| PR | Scope | Commits | Effort |
|---|---|---|---|
| 14a | `_workflow.ts` helper + `write_linkedin_post` | 2 (RED + GREEN) | 1.5h |
| 14b | Endpoint smoke test results documented in plans/ + spec docstring updates for all writers | 1 | 0.5h |
| 14c | Remaining 11 writers (template applied, 1 commit per writer) + 11 behavior tests | ~12 | 3h |
| 14d | Scope enforcement: `requiredScopes` field, `ScopeError`, dispatcher check, tests | 3 | 1.5h |
| 15a | Intelligence: `analyze_content`, `score_relevance`, `validate_voice` | 3 | 2h |
| 15b | Intelligence: `crawl_urls`, `discover_sources` (`get_source_status` deferred) | 2 | 1.5h |
| 15c | Strategy: `generate_strategy`, `research_market`. Defer `generate_personas` if streaming. | 2 | 1.5h |
| 16a | Workflow primitives: `start_workflow`, `get_workflow_status`, `cancel_workflow`, `confirm_workflow` | 4 | 2h |
| 16b | Knowledge: `get_knowledge`, `update_knowledge`, `search_knowledge` | 3 | 1.5h |
| 16c | Onboarding: `start_onboarding`, `get_onboarding_status`, `validate_onboarding` | 3 | 1.5h |
| 16d | Misc: `get_audience` (filter on list_audiences), `get_content_plan` family, tool annotations spec entry | 4 | 2h |

Total: ~11 PRs, ~40 commits, ~18 hours work. Slower than 1-2 days but **each PR is independently mergeable, independently retest-able in claude.ai, and respects the "wait for approval per commit" rule**. User can pause anytime.

---

## 8. `KnownOAuthClient` for Anthropic Claude

GLOSSARY: *"`KnownOAuthClient` ... pre-approved (no DCR). Used for branding the consent screen ('Visibilio for Claude' vs generic). Anthropic Claude is pre-configured."*

But — Anthropic Claude actually self-registered via DCR earlier in this session (you saw `vco_aaebf1ff...` and other DCR-issued client_ids in the DB during testing). The "pre-configured" claim in GLOSSARY is ambitious vs real state. Phase 2 should not depend on this. **Branding the consent screen for Claude is out of scope of Phase 2** — it's a polish item, separate concern, separate PR.

Plan correction: remove any mention of branding/known-clients. List as a follow-up.

---

## 9. Existing user-flow regressions to guard against

The 8 currently-real tools (`list_audiences`, `get_briefing`, `list_projects`, `get_project`, `set_active_project`, etc.) have working tests. Phase 2 must not regress them. Concrete risks:

| Risk | How it appears | Test gate |
|---|---|---|
| `_define.ts` interface change (adding `requiredScopes` field) | Existing tools missing new field → typecheck fail at compile time | tsc strict already covers this |
| Scope dispatcher addition rejects existing tools | If existing tools default to `['mcp:read', 'mcp:write']` but test fixture has only `['mcp:read']`, regression | Default `requiredScopes` must be `['mcp:read']`; write-flavored existing tools (none today) must explicitly opt in |
| New error format from `formatHttpError` updates | Tools cascading messages diverge from existing test snapshots | Don't touch `_format.ts` in this phase unless necessary |
| Spec file `spec/mcp-tools.json` gets new fields → existing tests assert exact spec shape | Existing test fixtures break | Add fields as optional in spec schema; existing entries unchanged |

**Mandatory gate before each PR opens**: full repo `vitest run` must show all existing 151 tests pass, BEFORE adding new tests. Do NOT allow new failures in the existing suite.

---

## 10. Tool exposure decisions

Original plan: ship all real tools, leave `generate_image` and `get_source_status` as stubs.

**Better plan**: stubs should be FILTERED OUT of `tools/list`, not just throw at call time.

Rationale: `CLAUDE.md` doesn't speak to this directly, but Claude.ai will see whatever `tools/list` returns. Showing tools that always throw "not implemented" is poor UX and was exactly the bug that triggered this whole work item. Phase 2's job is to bring the surface to "everything visible works".

**Concrete change**: `_define.ts` exports `defineTool()` (registers) and `stubTool()` (does NOT register — returns `null`). The aggregator `allTools` filters nulls. Only tools backed by a real handler reach the MCP `Server`.

Tests:
- `tools/list` does not contain any stub names
- A removed stub doesn't break tools/call (returns proper "method not found" JSON-RPC error)

---

## 11. Decisions still required from the user

The original plan asked 5 questions; here is the revised set after this critique:

| # | Question | Recommended answer |
|---|---|---|
| 1 | Sync poll vs async return for writers (≤120s timeout) | **Sync poll, 120s default, configurable per call.** Claude tool calls have generous timeouts. |
| 2 | `auto_confirm` default | **`true`. Auto-confirm by default**, expose explicit `start_workflow + confirm_workflow` primitives for power users. |
| 3 | Persistence of generated content (Option A/B/C from §3) | **Option A in Phase 2** (transient generation; no MCP-triggered DB writes). **Defer Option C** (`save_content_item` tool) to a separate plan. |
| 4 | PR cadence — single mega-PRs vs ~11 small PRs | **11 small PRs as in §7.** Slower but compliant with "approval per commit" and easier to roll back. |
| 5 | Scope enforcement in this phase | **Yes — implement `requiredScopes` + `ScopeError` in PR 14d.** GLOSSARY already promises this; we close the gap. |
| 6 | Filter stubs out of `tools/list` (NEW) | **Yes** per §10. |
| 7 | `generate_image` and `get_source_status` deferral | **Yes**, list as Phase 2.5 follow-ups. Filtered from `tools/list` per #6. |
| 8 | Streaming `generate_personas` | **Verify endpoint shape first.** If streaming-only, defer to Phase 2.5. If JSON-poll-able, ship in PR 15c. |
| 9 | Tool annotations for Anthropic submission | **Out of Phase 2 scope.** Separate PR after Phase 2 lands. |
| 10 | `KnownOAuthClient` / Claude consent branding | **Out of Phase 2 scope.** Separate PR. |

---

## 12. Risk register (revised)

| Risk | Severity | Mitigation |
|---|---|---|
| Backend endpoints differ from research-agent's inferred shapes | **High** | PR 14a opens with manual curl smoke tests against staging+prod with real `vat_`. Document actual shapes inline in the plan before writing helper. |
| Scope enforcement regressing existing tools | **Medium** | Default `requiredScopes: ['mcp:read']`; explicit `mcp:write` only on write tools |
| `tools/list` shrinks (43→8+real-count) — visible UX change in claude.ai | **Low** | Acceptable. Phase 2's whole point is that `tools/list` reflects what works. |
| Streaming `generate_personas` breaks Node `fetch` consumption pattern | **Medium** | Verify shape first; defer if streaming-only. |
| Backend rate-limiting (`MAX_CONCURRENT_LLM_CALLS=4`) causes long polls when Claude calls 12 writers in parallel | **Low** | Document in tool descriptions; user-perceptible but not breaking. |
| Long-poll tools time out at network layer (Cloud Run 60s default? — actually 300s per workflow `--timeout` flag in CI) | **Low** | We confirmed 300s timeout in `deploy-cloud-run.yml`. 120s tool timeout is well under. |
| Each new commit triggers Cloud Run auto-deploy (after PR #13 lands) → time spent waiting | **Low** | Ship locally with full test gate, only push to merge. Auto-deploy is ~3-5 min per memory. |

---

## 13. Recommended next step

1. **User approves this critique** (this file). Or rejects with corrections.
2. After approval, I write the **revised plan v2** at `visibilio-mcp/plans/phase-2-tools-implementation.md` reflecting all decisions in §11.
3. **Only then** start PR 14a with TDD.

No code is written until v2 plan is approved. Plan-only mode per `CLAUDE.md`.
