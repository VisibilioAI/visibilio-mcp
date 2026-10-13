# Changelog

## 0.2.2 — 2026-10-13

### Added

- **`search` and `fetch`**, the two tools ChatGPT connectors and deep research require. `search(query)` looks through the content items of every product in the active organization and returns `{results: [{id, title, url}]}`; `fetch(id)` returns one item as `{id, title, text, url, metadata}` with the body as plain text. Both answer with `structuredContent` plus the same JSON as text. Ids look like `content-item:123`; urls point at the item in the Visibilio app.

## 0.2.1 — 2026-10-13

### Fixed

- **`set_active_organization` changed nothing but the label.** Every gateway call ran in the organization the credential was created in, so `list_products` and every other tool showed the same products whichever organization was active. The server now sends `X-Organization-Id` with every request. Requires the gateway hotfix `jwtAuth honours X-Organization-Id for vsk_/vat_ credentials`; the gateway verifies membership and answers 403 for any other organization.

## 0.2.0 — 2026-10-13

Rebirth: the server now mirrors today's Visibilio and actually connects.

### Fixed

- **Every session failed at startup.** Identity was resolved through the backend `/api/v2/auth/resolve-key`, which has returned 500 (`column organizations.subscription_tier does not exist`) for every key. Identity now comes from the gateway `GET /api/v2/auth/me` with the caller's own credential.
- **claude.ai could not connect.** The hosted server only spoke legacy SSE; claude.ai probes with a Streamable HTTP `POST`, got 404 and never started OAuth. `POST|GET|DELETE /mcp` (and `/sse`) now implement Streamable HTTP with proper `401` + `WWW-Authenticate` challenges; legacy SSE stays available.
- **Gateway-backed tools answered 401.** Requires gateway hotfix `jwtAuth accepts vsk_/vat_ bearer credentials`; the server no longer sends `X-API-Key` or tenant headers.

### Changed

- The gateway is the only upstream. `VISIBILIO_BACKEND_URL`, `VISIBILIO_INTERNAL_API_KEY`, `VISIBILIO_OAUTH_CLIENT_ID/SECRET` are gone; `VISIBILIO_GATEWAY_URL` defaults to the production gateway.
- The tool surface is rewritten against the current platform (products instead of projects, content items, briefs, content plans, audiences, knowledge, brand voice, publishing, signals, review, measurement, AI visibility): 89 tools with typed input schemas and read/write annotations, 10 resources. The 2026-05 bytecode-derived spec and its 20 `NotImplementedError` stubs are removed.
- Sessions are bound to the credential hash; `set_active_organization` validates membership; every product-scoped tool accepts a `product_id` override.
- `@modelcontextprotocol/sdk` 1.32.

### Removed

- Backend-direct writer tools (`write_linkedin_post` …): use `start_workflow` / `generate_from_brief` / `generate_from_signal`, then `create_content_item(source_execution_id)`.
- `spec/mcp-tools.json`.

## 0.1.1 — 2026-05-05

License correction. The npm metadata for `0.1.0` shipped as `UNLICENSED` because the artifact was built minutes before the proprietary → MIT switch. No code changes between `0.1.0` and `0.1.1` — bump exists only so the published tarball carries the correct `MIT` license string.

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
