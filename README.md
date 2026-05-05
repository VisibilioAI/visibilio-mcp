# @visibilio/mcp

MCP server for the Visibilio AI content platform. Lets LLM clients (Claude Desktop, Claude in Slack, custom agents) call 43 tools and read 9 resources from your Visibilio workspace through a single API key.

> **Status**: Phase 1 (TypeScript rewrite). Recovered from Python implementation bytecode after source files were lost. See [`spec/mcp-tools.json`](spec/mcp-tools.json) for the authoritative tool/resource inventory and [`plans/mcp-production-readiness.md`](../visibilio-ai-backend-v2/plans/mcp-production-readiness.md) in the backend repo for full roadmap.

## Quick start

```bash
npx -y @visibilio/mcp
```

Set the API key first:

```bash
export VISIBILIO_API_KEY=vsk_your_key_here
```

Generate a key in the Visibilio UI: Settings → API Keys → New Key.

## Claude Desktop config

Add to `~/Library/Application Support/Claude/claude_desktop_config.json` (macOS) or `%APPDATA%\Claude\claude_desktop_config.json` (Windows):

```json
{
  "mcpServers": {
    "visibilio": {
      "command": "npx",
      "args": ["-y", "@visibilio/mcp"],
      "env": {
        "VISIBILIO_API_KEY": "vsk_..."
      }
    }
  }
}
```

Restart Claude Desktop. The Visibilio tools appear in the tools menu.

## What's exposed

- **43 tools** across 11 categories — content writers (LinkedIn, blog, X, Facebook, newsletter, press, email, Instagram, YouTube, TikTok, web, ad), content plans, workflows, knowledge, strategy, audience, intelligence, organization, onboarding, image generation, briefings.
- **9 resources** — current organization + project context, plus 7 knowledge domains (`company_profile`, `market_intelligence`, `audience_data`, `content_strategy`, `historical_outputs`, `scoring_profile`, `hub_config`).

Full inventory: [`spec/mcp-tools.json`](spec/mcp-tools.json).

## Development

```bash
npm install
npm run dev                   # stdio transport
npm run dev:http              # HTTP/SSE transport (Phase 6)
npm run build                 # tsup → dist/cli.js + dist/http.js
npm run test                  # vitest
npm run lint                  # eslint + prettier
npm run typecheck             # tsc --noEmit
```

## Architecture

The MCP server is a thin protocol bridge. It does not run LLM inference itself — it translates MCP `tools/call` requests into HTTP calls against the Visibilio gateway and backend.

```
LLM client (Claude) ──MCP─→ visibilio-mcp ──HTTP─→ visibilio-api-gateway-v2 ──→ visibilio-ai-backend-v2 (Python)
                                                ↓
                                         Supabase (auth + RLS)
```

Domain language: see [GLOSSARY.md](GLOSSARY.md).

## License

MIT — see [LICENSE](LICENSE).
