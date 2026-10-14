# Installing @visibilio/mcp

The Visibilio MCP server lets LLM clients work inside your Visibilio workspace. There are two ways to connect: the hosted server at `https://mcp.visibilio.ai` (no install, works in claude.ai, Claude Desktop, Claude mobile, Claude Code and Cursor), or the local stdio package `@visibilio/mcp` run with `npx`.

## Option A — hosted connector (recommended)

1. In claude.ai open **Settings → Connectors → Add custom connector**.
2. Name: `Visibilio`. Server URL: `https://mcp.visibilio.ai/mcp`.
3. Click **Connect**. You are sent to Visibilio to sign in and approve the connection (OAuth); afterwards the Visibilio tools appear in every conversation where the connector is enabled.

Other clients:

- **Claude Code:** `claude mcp add --transport http visibilio https://mcp.visibilio.ai/mcp`
- **Cursor / any Streamable HTTP client:** server URL `https://mcp.visibilio.ai/mcp`; when the client asks for a token, paste a `vsk_` key (see below).
- **Legacy SSE clients:** `https://mcp.visibilio.ai/sse`.
- **ChatGPT:** Settings → Apps → Advanced settings → Developer mode (Business: admins only), then Settings → Apps → Create: name `Visibilio`, server URL `https://mcp.visibilio.ai/mcp`, authentication OAuth. Full tool access needs a Business, Enterprise or Edu workspace; Pro gets read-only tools; without developer mode ChatGPT uses only `search` and `fetch`.
- **Codex (CLI, VS Code, Desktop):** `codex mcp add visibilio --url https://mcp.visibilio.ai/mcp`, then `codex mcp login visibilio` (OAuth). For a `vsk_` key, put `bearer_token_env_var = "VISIBILIO_API_KEY"` under `[mcp_servers.visibilio]` in `~/.codex/config.toml`. VS Code: gear → MCP servers → Add server → Streamable HTTP, same URL. Verify with `codex mcp list`.

## Option B — local stdio with an API key

### Get an API key

1. Sign in at https://app.visibilio.ai → **Settings → API Keys → Generate key** (scope `mcp`).
2. Pick a lifetime (30 / 90 / 365 days; default 90).
3. Copy the `vsk_*` value — it is shown once.

### Claude Desktop

Edit `~/Library/Application Support/Claude/claude_desktop_config.json` (macOS) or `%APPDATA%\Claude\claude_desktop_config.json` (Windows):

```json
{
  "mcpServers": {
    "visibilio": {
      "command": "npx",
      "args": ["-y", "@visibilio/mcp"],
      "env": { "VISIBILIO_API_KEY": "vsk_your_key_here" }
    }
  }
}
```

Restart Claude Desktop.

### Cursor

Edit `~/.cursor/mcp.json` with the same `mcpServers` block.

### CLI

```bash
npm install -g @visibilio/mcp
export VISIBILIO_API_KEY=vsk_your_key_here
visibilio-mcp
```

## Verify it works

Ask: *"Who am I in Visibilio and which products do I have?"* — the model calls `whoami` and `list_products`. Then: *"Set the active product to <name> and list the last 5 content items."*

## Environment variables (local only)

| Variable | Required | Default | What it does |
|---|---|---|---|
| `VISIBILIO_API_KEY` | yes | — | Your `vsk_*` key (or a `vat_*` OAuth access token) |
| `VISIBILIO_GATEWAY_URL` | no | `https://visibilio-api-gateway-prod.vercel.app` | Gateway base URL — override only for staging |
| `VISIBILIO_TIMEOUT_MS` | no | `30000` | HTTP timeout per request |

## Troubleshooting

### "Credential rejected by Visibilio (401)"

The key is missing, malformed, revoked or expired. Re-check the env var or generate a new key in Settings.

### "Credential lacks the mcp scope (403)"

The key was created for content ingestion only (`content:write`). Generate a key with the default `mcp` scope.

### "No active product"

Call `list_products` and `set_active_product`, or pass `product_id` to the tool.

### "… is not enabled for this organization yet"

Measurement and some AI-visibility features are rolled out per organization. Ask Visibilio support to enable them.

### Stale Python `visibilio-mcp` binary on PATH

If you installed the legacy Python implementation via `pipx`, remove it: `pipx uninstall visibilio-mcp-server`.

## Reporting issues

Open an issue at https://github.com/VisibilioAI/visibilio-mcp/issues with your client, the tool name and the exact error text. Or call the `send_feedback` tool from inside the conversation.
