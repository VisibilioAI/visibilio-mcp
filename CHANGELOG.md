# Changelog

## 0.1.0 — 2026-05-04

Initial public release on npm.

### What's in this release

- **Stdio transport** (`visibilio-mcp` binary) for Claude Desktop, Cursor, and any MCP client that spawns subprocesses.
- **HTTP/SSE transport** (`dist/http.js`) for hosted-LLM clients — disabled by default; runs when started with `node dist/http.js` and `PORT=8787`.
- **43 tools** across 11 categories: content writers (LinkedIn, blog, X, Facebook, newsletter, press, email, Instagram, YouTube, TikTok, web, ad), content plans, workflows, knowledge, strategy, audience, intelligence, organization, onboarding, image generation, daily briefing.
- **9 resources**: current organization + project context, plus 7 knowledge domains (`company_profile`, `market_intelligence`, `audience_data`, `content_strategy`, `historical_outputs`, `scoring_profile`, `hub_config`).
- **Authentication**: `vsk_*` API keys resolved through the Visibilio backend `/api/v2/auth/resolve-key` endpoint. Per-session caching, RLS isolation across organizations.
- **Resilience**: 429 / 502 / 503 / 504 retried with exponential backoff up to 3 attempts; `Retry-After` honored.

### Phase 1 (recovery) and Phase 2 (E2E coverage) status

The 8 most-used tools and 4 resources are wired through to live backend endpoints. The remaining 35 tools and 5 resources expose the correct schema but throw `NotImplementedError` when called — they will be wired in subsequent point releases without any contract change.

Implemented today:

- Tools: `list_projects`, `get_project`, `set_active_project`, `list_audiences`, `get_knowledge`, `list_content_plans`, `create_content_plan`, `get_briefing`
- Resources: `current_organization`, `current_project`, `company_profile`, `scoring_profile`

### Compatibility

- Node `>=18.0.0`
- MCP SDK `^1.0.0`
- Backend Phase 3.1+ (scopes, expiration, rate limit) — required for production keys; older backends still accept the requests but skip those guarantees.
