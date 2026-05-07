# Glossary — visibilio-mcp

Domain language used inside the MCP server. Names here are authoritative — code, tests, and tool schemas must match.

## Session

A live MCP session bound to one `vsk_*` API key. Holds the resolved `AuthContext`, the currently active project (if set via `set_active_project`), and the wire transport (stdio for `cli.ts`, SSE for `http.ts`).

## AuthContext

The resolved identity of the caller. Returned from the backend `/api/v2/auth/resolve-key` endpoint. Contains `userId`, `organizationId`, `defaultProjectId`, `subscriptionTier`, and (Phase 3+) `scopes`. Cached for the lifetime of the session.

## ToolDescriptor

The MCP-protocol metadata for a single tool: `name`, `description`, `inputSchema` (zod → JSON Schema). Registered with the MCP `Server` instance during startup. Visible to the LLM through `tools/list`.

## ResourceUri

The string identifier the LLM uses to read a resource. Format: `visibilio://{kind}/{slug}`. Example: `visibilio://current_organization`, `visibilio://knowledge/company_profile`. Resolved by handlers registered via `Server.setRequestHandler('resources/read')`.

## TenantHeaders

The HTTP headers required when calling the Visibilio backend on behalf of a session: `X-User-Id`, `X-Organization-Id`, `X-Project-Id` (when project is active). Built by `McpSession.buildTenantHeaders()`. Backend `tenant_middleware` rejects requests without them.

## VisibilioClient

The HTTP adapter wrapping calls to the gateway (`gateway_*` methods, uses `vsk_*` key) and to the backend (`backend_*` methods, uses internal API key + tenant headers). Single shared instance per session.

## RetryableError

An HTTP error class (429, 502, 503, 504) that triggers exponential backoff. Distinguished from non-retryable 4xx errors (400, 401, 403, 404) which propagate immediately. Status-specific initial delay — 503 gets longer than 429.

## IntrospectionResult

(Phase 7) The OAuth token introspection response from the gateway. Contains `active`, `sub`, `org_id`, `scope`, `exp`. MCP server calls introspection on every `Bearer vat_*` request and caches per token for ≤60s.

## KnownOAuthClient

(Phase 7) An entry in the OAuth client registry that the gateway treats as pre-approved (no Dynamic Client Registration). Used for branding the consent screen ("Visibilio for Claude" vs generic "Application X is requesting access"). Anthropic Claude is pre-configured; future entries added via `KNOWN_OAUTH_CLIENTS` map.

## Scope

A capability granted to a session. Format: `mcp:read`, `mcp:write`, `mcp:admin`. Read-only sessions can `tools/list` write tools but cannot `tools/call` them — the dispatcher rejects with `ScopeError` before reaching the backend.

## Workflow

(Phase 2) A backend-driven asynchronous execution started via `POST /api/v2/workflow/start`, identified by an `execution_id`, polled at `GET /api/v2/workflow/{execution_id}/status` until it reaches a terminal state (`completed`, `failed`, `cancelled`, `error`). Tool handlers in the writer/strategy/research families delegate to the `runWorkflow` helper which encapsulates this start-poll-return contract. Writer agent selection is performed by the backend's workflow planner reading the natural-language `user_request` field (e.g. `"Write a LinkedIn post: ..."`); the MCP layer encodes this prefix per the `humanContentLabel` map in `_workflow.ts`. The MCP server only reads the workflow lifecycle — backend persists state, generates content, and returns `final_output` on completion. Defaults: `auto_confirm: true`, `async_mode: true`, 120-second poll deadline.

⚠️ The `repurpose_targets` field on `WorkflowStartRequest` is for **cross-posting after primary generation**, not writer selection. It expects `list[RepurposeTargetRequest]` (objects of shape `{platform, content_type, remix_strategy}`); sending strings produces a 422 Pydantic validation error. The MCP server does not populate this field today.
