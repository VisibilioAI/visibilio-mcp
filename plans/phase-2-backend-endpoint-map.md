# Phase 2 — backend endpoint map

Output of pre-flight read of `visibilio-ai-backend-v2/src/infrastructure/api/v2/`. Locks the contract for PRs 14a–16d. Source: routers + DTOs in the v2 backend repo.

## Writers (12 tools, single endpoint)

All 12 writer tools route through one endpoint. The workflow engine selects the writer agent from the natural-language `user_request` body field.

| Tool | Method + Path | Sync/Async |
|---|---|---|
| All writers (write_linkedin_post, write_blog_article, write_tweet, write_facebook_post, write_newsletter, write_press_release, write_email_campaign, write_instagram_caption, write_youtube_description, write_tiktok_script, write_website_copy, write_ad_copy) | `POST /api/v2/workflow/start` | `async_mode=true` returns `execution_id` for polling; `false` blocks until done |

Request body (`WorkflowStartRequest` from `workflow_router.py:246`):
```ts
{
  user_request: string,            // natural-language brief; writer agent chooses content type from this
  source_url?: string,
  source_content?: string,
  repurpose_targets?: string[],    // when present, forces specific writer agents
  auto_confirm?: boolean,          // default false; true skips plan-confirmation gate
  async_mode?: boolean             // default true; we set true and poll
}
```

Response:
```ts
{ execution_id: string, state: string, plan?: ..., requires_confirmation: boolean, final_output?: ... }
```

Tenant headers required: `X-User-Id`, `X-Organization-Id`, `X-Project-Id` (when active).

**Implementation note for `runWorkflow` helper:** ⚠️ Original plan assumption was wrong. `repurpose_targets` is `list[RepurposeTargetRequest]` — objects of shape `{platform, content_type, remix_strategy}` — and is for **cross-posting after primary generation**, not writer selection. Sending strings like `['linkedin_post']` triggers a Pydantic 422. Writer routing happens via the **workflow planner reading `user_request` natural language**. `runWorkflow` encodes the choice as `"Write a {humanLabel(contentType)}: {brief}"` (e.g. "Write a LinkedIn post: ..."). Discovered 2026-05-07 via Cloud Run 422 backend log after Phase 2 PR 14a went live; corrected in PR 16 (this fix lives in `_workflow.ts` `humanContentLabel` map).

## Workflow primitives

| Tool | Method + Path |
|---|---|
| start_workflow | `POST /api/v2/workflow/start` (same body as writers; pass-through) |
| confirm_workflow | `POST /api/v2/workflow/{execution_id}/confirm` body `{ confirmed: boolean, modifications?: string }` |
| get_workflow_status | `GET /api/v2/workflow/{execution_id}/status` |
| cancel_workflow | `POST /api/v2/workflow/{execution_id}/cancel?reason=...` |

Source: `workflow_router.py:246, 395, 421, 439`.

## Strategy

| Tool | Method + Path | Notes |
|---|---|---|
| generate_strategy | `POST /api/v2/strategy-regeneration/start` | Sync polling on `execution_id` |
| research_market | `POST /api/v2/strategy-regeneration/start-stream` | **SSE streaming.** PR 15c needs a streaming consumer or an alternative endpoint. |
| generate_personas | `POST /api/v2/audience-generation/generate-stream` | **SSE streaming only.** **Confirmed deferred to Phase 2.5** per locked decision #8. |

Source: `strategy_regeneration_router.py:117, 200`, `audience_generation_router.py:56`.

**Plan adjustment:** `research_market` ALSO appears to be SSE-streaming, not the JSON endpoint the original plan assumed. Either (a) ship it via the streaming consumer (same code path as personas; defer with personas) or (b) check for a `start` (non-stream) sibling endpoint. Pre-flight decision: defer `research_market` to Phase 2.5 alongside `generate_personas` unless a JSON-mode sibling exists. Verify in PR 15c first commit.

## Intelligence (5 tools — all sync)

| Tool | Method + Path |
|---|---|
| analyze_content | `POST /api/v2/intelligence/analyze` |
| score_relevance | `POST /api/v2/intelligence/score` |
| validate_voice | `POST /api/v2/intelligence/validate-voice` |
| crawl_urls | `POST /api/v2/intelligence/crawl` |
| discover_sources | `POST /api/v2/intelligence/discover` |
| get_briefing (existing real tool, mapped here for completeness) | `POST /api/v2/intelligence/briefing/generate` |

Source: `intelligence_router.py:296, 333, 363, 396, 428, 860`.

`get_source_status` — not located in v2 router; **confirmed deferred to Phase 2.5** per locked decision #7.

## Knowledge (3 tools — sync)

| Tool | Method + Path |
|---|---|
| get_knowledge | `GET /api/v2/knowledge/{org_id}/{domain}` (optional `?version=N`) |
| update_knowledge | `PUT /api/v2/knowledge/{org_id}/{domain}` body `{ content, changed_by, change_note }` |
| search_knowledge | `POST /api/v2/knowledge/{org_id}/search` body `{ query, domains?: string[] }` |

Source: `knowledge_router.py:100, 173, 229`.

Server-side serialization via `insert_knowledge_versioned` Postgres function with advisory locks (per project memory). Tool layer needs no lock awareness.

## Onboarding (3 tools)

| Tool | Method + Path | Notes |
|---|---|---|
| start_onboarding | `POST /api/v2/onboarding/start` | Long-running sync (30-90s). The one Phase 2 tool that triggers a backend-driven DB write to `knowledge_base` (legitimate per CLAUDE.md DB Write Rules). |
| get_onboarding_status | `GET /api/v2/onboarding/status` | Per-session — no execution_id needed |
| validate_onboarding | `POST /api/v2/onboarding/validate` | Returns shape-validation only |

Source: `onboarding_router.py:198, 276, 295`.

## Misc (4 tools)

| Tool | Method + Path | Notes |
|---|---|---|
| get_audience | (no v2 endpoint) | **Plan-locked: implement as filter on `list_audiences` response client-side.** No backend round-trip. |
| get_content_plan | `GET /api/v2/content-plan/{plan_id}` (path inferred; verify in PR 16d) | Sync |
| generate_content_plan | `POST /api/v2/content-plan/generate` body `ContentPlanGenerateRequest` | Async with `async_mode` flag |
| get_content_plan_status | `GET /api/v2/content-plan/status/{execution_id}` | Sync |

Source: `content_plan_router.py:208, 273` (and reverse-engineered for `get_content_plan`).

## Existing real tool (reference template)

| Tool | Method + Path |
|---|---|
| list_audiences | `GET /api/v2/knowledge/{org_id}/audience_data` |

Source: `src/tools/audience.ts:11-31`. Used as the implementation reference for new tools.

## Plan adjustments locked by this map

1. **`runWorkflow` helper sets `repurpose_targets: [contentType]`** to deterministically route the writer. `user_request` carries the brief.
2. **`generate_personas` confirmed deferred** to Phase 2.5 — SSE-only.
3. **`research_market` likely SSE-only too** — PR 15c first commit verifies; defers to 2.5 if confirmed.
4. **`get_audience` is client-side filter** on cached `list_audiences` response — no new backend call.
5. **`get_briefing`** has both an existing reader and the `intelligence/briefing/generate` write endpoint; the existing tool already wraps the read path. PR 15a confirms.
6. **All onboarding tools** in PR 16c flow through the documented backend-write exception per CLAUDE.md DB Write Rules.

## Out of scope of this map

- Endpoint discovery for `generate_image` (deferred Phase 2.5)
- Endpoint discovery for `get_source_status` (deferred Phase 2.5)
- The streaming consumer pattern for SSE endpoints (deferred to Phase 2.5 alongside personas/research_market unless a non-stream endpoint exists)
