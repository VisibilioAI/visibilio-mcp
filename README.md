# @visibilio/mcp

MCP server for the Visibilio AI content platform. Lets LLM clients (claude.ai connectors, ChatGPT, Claude Desktop, Claude Code, Cursor, custom agents) work inside your Visibilio workspace: products, content items, briefs, content plans, audiences, knowledge, brand voice, publishing, signals, review, measurement and AI visibility — 91 tools and 10 resources over the Visibilio API gateway.

## Connect from claude.ai (recommended)

1. In Visibilio: **Settings → API Keys → Generate key** (scope `mcp`), or skip this and sign in through OAuth in step 3.
2. In claude.ai: **Settings → Connectors → Add custom connector**.
3. Server URL: `https://mcp.visibilio.ai/mcp`. Claude asks you to sign in to Visibilio (OAuth) and to approve the connection.

The same URL works in Claude Desktop, Claude mobile, Claude Code (`claude mcp add --transport http visibilio https://mcp.visibilio.ai/mcp`) and any client that speaks MCP Streamable HTTP. Clients that still use the legacy SSE transport can use `https://mcp.visibilio.ai/sse`.

**ChatGPT:** Settings → Apps → Advanced settings → Developer mode, then Settings → Apps → Create with the same URL and OAuth. Full tool access needs a Business, Enterprise or Edu workspace; Pro gets the read-only tools. Outside developer mode ChatGPT uses only `search` and `fetch`, which search the content items of the active organization and return them with citation URLs.

**Codex (CLI, VS Code, Desktop):** `codex mcp add visibilio --url https://mcp.visibilio.ai/mcp`, then `codex mcp login visibilio` to sign in with OAuth. For a `vsk_` key instead, add `bearer_token_env_var = "VISIBILIO_API_KEY"` under `[mcp_servers.visibilio]` in `~/.codex/config.toml`. In the VS Code extension: gear → MCP servers → Add server → Streamable HTTP with the same URL. `codex mcp list` shows the result.

## Run locally (stdio)

```bash
export VISIBILIO_API_KEY=vsk_your_key_here
npx -y @visibilio/mcp
```

Claude Desktop (`~/Library/Application Support/Claude/claude_desktop_config.json` on macOS, `%APPDATA%\Claude\claude_desktop_config.json` on Windows):

```json
{
  "mcpServers": {
    "visibilio": {
      "command": "npx",
      "args": ["-y", "@visibilio/mcp"],
      "env": { "VISIBILIO_API_KEY": "vsk_..." }
    }
  }
}
```

## What's exposed

Every tool is scoped to the active organization and product. Start with `whoami`; pick a product with `list_products` + `set_active_product` (or pass `product_id` to any product tool).

| Family | Tools |
|---|---|
| ChatGPT connector contract | `search`, `fetch` |
| Context | `whoami`, `list_organizations`, `set_active_organization`, `list_products`, `set_active_product`, `get_product`, `create_product`, `update_product` |
| Content items | `list_content_items`, `get_content_item`, `create_content_item`, `update_content_item`, `delete_content_item`, `duplicate_content_item`, `list_content_item_versions`, `restore_content_item_version`, `generate_seo_meta`, `validate_brand_voice`, `repurpose_content_item`, `quick_repurpose_content_item`, `translate_content_item`, `generate_cover_image` |
| Briefs & generation | `list_briefs`, `get_brief`, `create_brief`, `update_brief`, `delete_brief`, `generate_from_brief`, `list_brief_content_items`, `start_workflow`, `confirm_workflow`, `get_workflow_status`, `cancel_workflow` |
| Content plans | `list_content_plans`, `get_content_plan`, `create_content_plan`, `generate_content_plan`, `get_content_plan_status`, `list_planned_topics`, `get_planned_topic_brief` |
| Audiences & knowledge | `list_audiences`, `create_audience`, `delete_audience`, `get_knowledge`, `update_knowledge`, `search_knowledge`, `list_knowledge_proposals`, `accept_knowledge_proposal`, `dismiss_knowledge_proposal` |
| Brand voice | `get_brand_voice`, `update_brand_voice`, `analyze_brand_voice_text`, `get_brand_voice_analysis` |
| Publishing | `list_channels`, `list_product_channels`, `publish_social_post`, `list_content_hubs`, `publish_to_hub`, `list_hub_publications`, `list_schedules`, `schedule_content_item`, `cancel_schedule`, `get_published_feed` |
| Signals & sources | `list_signals`, `get_signal`, `generate_from_signal`, `add_signal_to_plan`, `dismiss_signal`, `get_signal_stats`, `list_sources`, `create_source`, `scan_source` |
| Overview & review | `get_daily_briefing`, `get_operation_overview`, `get_review_queue`, `approve_content_item`, `request_content_changes`, `get_activity_feed`, `get_product_stats`, `list_notifications`, `get_notification_count`, `mark_notifications_read` |
| Measurement & AI visibility | `get_measurement_overview`, `list_measurement_recommendations`, `get_ai_visibility_metrics`, `list_ai_visibility_recommendations`, `list_ai_visibility_content_ideas`, `list_ai_visibility_answers` |
| Misc | `send_feedback` |

Resources: `visibilio://organization`, `visibilio://product`, `visibilio://knowledge/{company_profile|market_intelligence|audience_data|content_strategy|historical_outputs|scoring_profile|hub_config|person_profile}`.

Generated content (`start_workflow`, `generate_from_brief`, `generate_from_signal`) is returned by `get_workflow_status`, which waits up to 40 seconds per call for a running execution to finish. It is saved only when you call `create_content_item` with `type` and `source_execution_id`; the title, text, SEO meta, FAQ and summary are taken from the run unless you pass your own — the model decides what to keep.

## Architecture

The server is a thin, stateless-by-design bridge: it translates MCP `tools/call` requests into HTTP calls against the Visibilio gateway, authenticated with the caller's own credential (`vsk_` personal API key or `vat_` OAuth access token). It never talks to the AI backend directly and holds no secrets of its own.

```
MCP client ──Streamable HTTP /mcp (or stdio)──▶ visibilio-mcp ──Bearer vsk_|vat_──▶ visibilio-api-gateway-v2 ──▶ backend / Supabase
```

Hosted at `https://mcp.visibilio.ai` (Cloud Run). OAuth discovery (RFC 9728 / RFC 8414) is served from the same host; `/register`, `/oauth/token` and `/oauth/revoke` proxy to the gateway.

## Development

```bash
npm install
npm run dev                   # stdio transport (needs VISIBILIO_API_KEY)
npm run dev:http              # HTTP transport on :8080 (PORT to override)
npm run test                  # vitest — every tool has a contract test against a fake gateway
npm run lint && npm run typecheck && npm run build
node scripts/live-smoke.mjs http://localhost:8080/mcp /path/to/key-file whoami list_products   # live smoke
```

| Variable | Default | What it does |
|---|---|---|
| `VISIBILIO_API_KEY` | — | stdio only: your `vsk_` key or `vat_` token |
| `VISIBILIO_GATEWAY_URL` | `https://visibilio-api-gateway-prod.vercel.app` | gateway base URL (staging: `https://visibilio-api-gateway-v2-staging.vercel.app`) |
| `VISIBILIO_FRONTEND_URL` | — | HTTP only: where the OAuth consent screen lives |
| `VISIBILIO_TIMEOUT_MS` | `30000` | per-request HTTP timeout |

Domain language: see [GLOSSARY.md](GLOSSARY.md).

## License

MIT — see [LICENSE](LICENSE).
