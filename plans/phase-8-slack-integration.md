# Phase 8 — Slack OAuth-client integration

Sibling plan to [`phase-2-tools-implementation.md`](./phase-2-tools-implementation.md). Independent workstream — depends only on Phase 7 OAuth (done), not on Phase 2.

## Context

Phase 7 shipped the MCP server as an RFC-compliant OAuth resource server. claude.ai (and any other MCP-aware client) can now register, consent, and call tools using `vat_*` Bearer tokens. Slack is the next external surface: a Slack bot that proxies user-issued slash commands (and other Slack interactions) to Visibilio MCP tools, with each Slack user authenticated as the corresponding Visibilio user via the same OAuth flow we built for Claude.

Earlier session decision: **Slack acts as an OAuth client of our MCP** (option A from the three considered). The Slack app speaks the MCP protocol over the same `/sse` + `/messages` surface that Claude.ai uses. No new backend work required; no parallel REST surface; same scope semantics (`mcp:read` / `mcp:write`).

## Goal

A Slack workspace can install "Visibilio for Slack" (an OAuth-protected Slack app), each Slack user can authorize access to their Visibilio account once, and from then on can run commands like `/visibilio briefing`, `/visibilio post linkedin "<brief>"`, `/visibilio knowledge search "<query>"` from any channel or DM.

## Authoritative inputs

- `CLAUDE.md` at workspace root
- This session's conversation history of the Slack architecture options (A: bot as MCP client; B: REST surface; C: hybrid)
- Phase 7 OAuth surface — `oauth_clients`, `oauth_authorizations`, `oauth_access_tokens`, `oauth_refresh_tokens` tables (production)
- Slack platform docs: Slack Bolt for JS/TS, Slack OAuth v2, Slack signing secret verification

## Architecture (locked)

```
Slack workspace user runs:  /visibilio briefing today
                                 │
                                 ▼
                     Slack → POST /slack/commands  ──┐
                                                     │  (signed payload)
                                                     ▼
                          Visibilio Slack bot service
                          (Cloud Run; node + Slack Bolt)
                                                     │
                                ┌────────────────────┤
                                │                    │
                       vat_ for       proxy MCP request
                       Slack user      via /sse + /messages
                                │                    │
                                ▼                    ▼
                       per-Slack-user            Visibilio MCP
                       token storage              (existing)
                       (Supabase table)
```

The bot service holds:
- Slack app credentials (signing secret, bot token)
- A per-Slack-user mapping table: `slack_user_id` → `{vat, vrt, vat_expires_at, visibilio_user_id, visibilio_org_id}`
- A short-lived "linking" flow (see "Linking flow" below) for first-time users

The bot service does NOT:
- Hold any Visibilio business logic — it's a thin command translator
- Store generated content beyond the immediate Slack response — same transient pattern as MCP tools
- Bypass scope enforcement — `mcp:read` Slack users can call read tools; write requires fresh consent step

## Decisions still required (lock these before drafting PR sequence)

| # | Question | Recommendation | Why |
|---|---|---|---|
| 1 | Tech stack | Node 20 + TypeScript + Slack Bolt SDK | Matches MCP server stack; reuses `@visibilio/shared-types`; Bolt handles signature verification, retries, ack timing |
| 2 | Repository layout | New repo `visibilio-slack-bot` (sibling to `visibilio-mcp`) | Independent deploy lifecycle; own CI; doesn't bloat the MCP repo. Same monorepo workspace pattern. |
| 3 | Hosting | Cloud Run europe-west1 (mirror MCP) | Closest to Slack data-residency expectations; same operational surface; same `gcloud` familiarity |
| 4 | Token storage | New Supabase table `slack_user_tokens` (no PII beyond user_id) | Same DB the rest of the platform uses; RLS-protected; the only DB write the bot does. Per CLAUDE.md DB Write Rules: **bot writes directly because it's the persistence boundary for its own state, not user-facing content** |
| 5 | OAuth client model | One pre-registered OAuth client per Slack workspace (`vco_slack_<workspace_id>`) | Simplifies revocation per-workspace; the bot stores `client_id` + `client_secret` per workspace install |
| 6 | User mapping | Email-based linking on first command | Slack users have email; we have email in `auth.users`; first command in a workspace prompts a magic-link to confirm linkage |
| 7 | Workspace ↔ Org mapping | 1 Slack workspace → 1 Visibilio org (workspace admin chooses on install) | Avoids UX mess of "which org for this Slack DM"; explicit and auditable |
| 8 | Commands surface (MVP) | `/visibilio briefing`, `/visibilio post <type> "<brief>"`, `/visibilio knowledge search "<query>"`, `/visibilio status` | The 4 highest-value entry points; covers the audience that wanted Slack |
| 9 | Slash command discoverability | Static slash commands in Slack manifest + dynamic completions via Slack search modal | Manifests bundled with the OAuth-install link; modal handler offers tool list |
| 10 | First-message UX for unauthorized | Bot replies with "Connect your Visibilio account first" + ephemeral button → opens our consent screen with Slack's redirect URI | One-click onboarding; reuses Phase 7 consent UI without modification |

## Linking flow (locked)

1. User runs `/visibilio briefing` in Slack for the first time
2. Bot looks up `slack_user_id` in `slack_user_tokens`. **Miss.**
3. Bot replies (ephemeral): "Connect your Visibilio account: [Authorize]"
4. The button links to `https://visibilio-frontend-prod.vercel.app/oauth/consent?...&client_id=vco_slack_<workspace>&redirect_uri=https://visibilio-slack-bot/oauth/callback&state=<slack_user_id>:<nonce>`
5. User clicks → consent screen → Allow
6. FE POSTs to `/api/v2/oauth/authorize`, gets redirect URL with `code=`, browser navigates to bot's callback
7. Bot exchanges code → `vat_*` + `vrt_*` (using its workspace `vcs_*` secret)
8. Bot writes the row to `slack_user_tokens` keyed by `slack_user_id`
9. Bot sends DM to user: "✅ Connected. Try `/visibilio briefing` again."
10. User reruns the command — bot now has the token, proxies the MCP call, returns result.

Subsequent commands take a sub-second path: lookup token, refresh if expired, call MCP, return.

## Dependencies

- **Phase 7 OAuth — DONE** (today). No new gateway/MCP work needed for Phase 8 baseline.
- **Phase 2 tool implementation — HELPFUL but not blocking.** Slack bot can ship with the 8 currently-real tools; expands surface as Phase 2 lands.
- **DNS for `slack.visibilio.ai` — nice to have.** Slack accepts vercel.app/run.app URLs in app manifests; alias-able later.

## PR sequence (high-level — refined after decisions locked)

| PR | Scope | Notes |
|---|---|---|
| 8a | Repo bootstrap: `visibilio-slack-bot` repo, Bolt skeleton, CI, healthcheck | No Slack signing yet |
| 8b | Slack OAuth install flow: workspace admin installs app → bot stores workspace credentials in `slack_workspaces` table | RLS-protected; Slack signing secret verification middleware |
| 8c | `slack_user_tokens` Supabase migration + linking flow (steps 1-9 above) | Tested with a real Slack workspace |
| 8d | First slash command: `/visibilio briefing` proxying to MCP `get_briefing` | End-to-end smoke |
| 8e | Refresh token rotation on expired `vat_*` | Anti-theft cascade matches gateway behavior |
| 8f | Remaining MVP commands: `/visibilio post`, `/visibilio knowledge search`, `/visibilio status` | Each with happy + error tests |
| 8g | Slack manifest, marketplace listing prep | Submission to Slack App Directory (separate from Anthropic submission) |

Total: ~7 PRs, similar cadence to Phase 2. Same TDD discipline, same wait-for-approval-per-commit rule.

## Cross-cutting concerns

### DB Write Rules compliance

Per CLAUDE.md:
- `slack_user_tokens` — Slack bot writes directly (persistence boundary for its own session state). Documented exception, similar to backend writing `knowledge_base` during onboarding.
- `slack_workspaces` — same rationale.
- All other DB interactions (e.g. `oauth_authorizations` lookups during the consent flow) flow through the gateway as normal.

### Scope enforcement reuse

Slack-issued `vat_*` tokens carry the same `mcp:read` / `mcp:write` scopes as Claude-issued ones. PR 14d's `ScopeError` dispatcher (Phase 2) gates write commands automatically. No Slack-specific scope work needed beyond requesting `mcp:write` in the consent flow when the user installs.

### Per-workspace OAuth client registration

When a Slack workspace admin installs Visibilio for Slack, the bot service:
1. Receives Slack OAuth callback with workspace details
2. POSTs `/api/v2/oauth/register` (gateway DCR) with:
   - `client_name`: `Slack: <workspace name>`
   - `redirect_uris`: `[https://visibilio-slack-bot/oauth/callback]`
   - `grant_types`: `[authorization_code, refresh_token]`
   - `token_endpoint_auth_method`: `client_secret_basic`
3. Stores returned `client_id` + `client_secret` in `slack_workspaces` table keyed by `slack_team_id`
4. Subsequent linking flows use this workspace-scoped client

Per-workspace registration gives crisp revocation: uninstalling the app from a workspace deletes its row → all `vat_*` issued under that `client_id` can be cascade-revoked via gateway.

### Out of scope

| Item | Why deferred | Phase |
|---|---|---|
| Threaded replies + interactive components (Block Kit beyond simple text) | Visual polish; MVP is utility | Post-MVP |
| Channel-level commands (`/visibilio summarize-channel`) | Requires Slack channel-history scopes | Phase 8.5 |
| Multi-org Slack users (`/visibilio org switch`) | Decision #7 says 1:1 | Phase 9 if requested |
| Audit log of bot actions | Compliance feature | Phase 8.5 |
| Self-serve Slack app distribution | Slack Marketplace listing | Phase 8g + cycle |

## Decisions still required from user

The 10 decisions above are recommendations. Confirm they hold, or flag the ones to revisit. Phase 8 doesn't start until they're locked.

After approval:
1. Bootstrap `visibilio-slack-bot` repo (PR 8a)
2. Iterate per the PR sequence

## Risk register

| Risk | Severity | Mitigation |
|---|---|---|
| Slack signing secret leak → spoofed commands | High | Standard Bolt middleware enforces; rotate on suspicion |
| `vat_*` refresh failure cascade hits Slack UX | Medium | Per-user retry logic; fall back to "please re-authorize" message |
| User links wrong Slack identity to wrong Visibilio account | Medium | Email-based linking with magic-link confirm prevents cross-mapping |
| Workspace admin uninstalls Slack app while users have active sessions | Low | Bot revokes all workspace tokens via gateway DELETE on uninstall |
| Slack bot Cloud Run cold starts add latency on first command | Low | Min instances ≥ 1 in production |
| Phase 2 tools take longer than expected, delays Slack rollout | Low (Phase 8 ships with current 8 real tools regardless) | Independent timelines; Phase 8 doesn't wait |

## Reading order

1. This file (Phase 8 plan, locked decisions, PR sequence)
2. [`phase-2-tools-implementation.md`](./phase-2-tools-implementation.md) (Phase 2 plan, can run in parallel)
3. [`phase-2-tools-implementation-critique.md`](./phase-2-tools-implementation-critique.md) (rationale for both plans)

## Approval gate

No code, no repo bootstrap, no Slack app registration before user explicitly approves this plan. Same plan-only mode as Phase 2.
