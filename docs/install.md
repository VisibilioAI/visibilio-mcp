# Installing @visibilio/mcp

The Visibilio MCP server lets LLM clients (Claude Desktop, Cursor, custom agents) call tools and read resources from your Visibilio workspace through a single API key.

## Prerequisites

- Node.js `>=18.0.0` (Claude Desktop ships with this; if you're running on the CLI, `node --version`)
- A Visibilio account at https://visibilio.ai and an API key

## Get an API key

1. Sign in at https://visibilio.ai → **Settings → API Keys → Generate Key**
2. Pick a lifetime (30 / 90 / 365 days; default 90)
3. Copy the `vsk_*` value — it's shown once

## Install

### Claude Desktop (recommended)

Edit `~/Library/Application Support/Claude/claude_desktop_config.json` (macOS) or `%APPDATA%\Claude\claude_desktop_config.json` (Windows):

```json
{
  "mcpServers": {
    "visibilio": {
      "command": "npx",
      "args": ["-y", "@visibilio/mcp"],
      "env": {
        "VISIBILIO_API_KEY": "vsk_your_key_here"
      }
    }
  }
}
```

Restart Claude Desktop. The Visibilio tools appear in the tools menu.

### Cursor

Edit `~/.cursor/mcp.json`:

```json
{
  "mcpServers": {
    "visibilio": {
      "command": "npx",
      "args": ["-y", "@visibilio/mcp"],
      "env": {
        "VISIBILIO_API_KEY": "vsk_your_key_here"
      }
    }
  }
}
```

### Global install (CLI usage)

```bash
npm install -g @visibilio/mcp
export VISIBILIO_API_KEY=vsk_your_key_here
visibilio-mcp
```

## Verify it works

In Claude Desktop, open a new conversation and ask:

> What Visibilio projects do I have?

Claude should call `list_projects` and return a list. If you see a "Tool not authorized" or auth error, the most likely cause is an expired or revoked key — generate a new one.

## Environment variables

| Variable | Required | Default | What it does |
|---|---|---|---|
| `VISIBILIO_API_KEY` | yes | — | Your `vsk_*` key |
| `VISIBILIO_BACKEND_URL` | no | `https://api.visibilio.ai` | Backend base URL — only override for staging |
| `VISIBILIO_GATEWAY_URL` | no | `https://gateway.visibilio.ai` | Gateway base URL — only override for staging |
| `VISIBILIO_TIMEOUT_MS` | no | `30000` | HTTP timeout per request |

## Troubleshooting

### "Auth failed (401) — check VISIBILIO_API_KEY"

The key is missing, malformed, or revoked. Re-check the env var, or generate a new key in Settings.

### "Auth failed (403) — check VISIBILIO_API_KEY"

The key is valid but expired. The default lifetime is 90 days. Generate a new key in Settings.

### "Rate limit exceeded. Try again in N seconds."

The MCP server returns a 429 when your key exceeds its per-minute quota (60 / 600 / 6000 requests per minute by tier). The MCP client retries automatically with the `Retry-After` value, so this should be invisible during normal use. If you hit it during a script, slow the script down or upgrade your tier.

### Stale Python `visibilio-mcp` binary on PATH

If you previously installed the legacy Python implementation via `pipx`, remove it:

```bash
pipx uninstall visibilio-mcp-server
```

Then `which visibilio-mcp` should resolve to the npm-installed Node binary.

## Reporting issues

Open an issue at https://github.com/VisibilioAI/visibilio-mcp/issues with the output of `visibilio-mcp --version` (when supported), your platform, and the exact error.
