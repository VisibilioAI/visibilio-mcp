# Glossary — visibilio-mcp

Domain language used inside the MCP server. Names here are authoritative — code, tests and tool schemas must match. Platform terms (Product, ContentItem, Brief, ContentPlan, Audience, KnowledgeDomain, Channel, ContentHub, Signal, WorkflowExecution, `execution_id`) keep the meaning defined in the platform `GLOSSARY.md` of the meta repo.

## Credential

What a caller presents to prove who they are: a personal API key (`vsk_*`, generated in Settings → API Keys, scope `mcp`) or an OAuth access token (`vat_*`, issued by the gateway after the consent screen). Both are sent to the gateway as `Authorization: Bearer <credential>`; the gateway's `jwtAuth` resolves them into the same session claims a browser session would carry. The MCP server never inspects the credential beyond its prefix.

## AuthContext

The resolved identity of the caller, obtained once per session from `GET /api/v2/auth/me`: `userId`, `email`, `name`, `organizationId` (the default organization) and `organizations` (every membership with its role). Cached for the lifetime of the session.

## Session

One authenticated MCP session: an `AuthContext`, a `VisibilioClient`, the active organization (switchable with `set_active_organization` among the memberships in the context) and the active product (set with `set_active_product`, cleared when the organization changes). Over Streamable HTTP a session is identified by the `Mcp-Session-Id` header and bound to the hash of the credential that created it; a request presenting another credential for that session id is rejected. Sessions live in the memory of one server instance; an unknown session id answers 404 so the client re-initializes.

## Active product

The product that product-scoped tools operate on when no `product_id` argument is passed. Every product-scoped tool accepts an optional `product_id` override, so a client can work without ever setting one.

## ToolDefinition

The MCP-protocol metadata of one tool: `name`, `title`, `description`, `inputSchema` (a zod shape, converted to JSON Schema by the SDK), `annotations` (`readOnlyHint`, `destructiveHint`) and the `handler`. Handlers return plain text for the model; a `ToolError` or an upstream `HttpError` is rendered as an error message instead of failing the protocol call.

## ToolError

An expected, user-facing failure raised inside a handler (missing argument, no active product, not a member of the organization). Rendered as `Error: <message>`.

## Resource

A read-only document the client can load without calling a tool: `visibilio://organization` (session context), `visibilio://product` (the active product) and `visibilio://knowledge/{domain}` for the eight knowledge domains.

## VisibilioClient

The HTTP adapter for the gateway: `get`, `post`, `put`, `patch`, `delete` with the credential as a bearer token, JSON bodies, a per-request timeout and retries with exponential backoff on 429 / 502 / 503 / 504 (`Retry-After` honoured).

## Streamable HTTP

The current MCP transport (`POST`/`GET`/`DELETE /mcp`, also served on `/sse` because existing connectors were registered with that path). The first `POST` must be an `initialize` request; the response carries `Mcp-Session-Id`. Responses are JSON. An unauthenticated request receives `401` with an RFC 6750 `WWW-Authenticate` challenge pointing at `/.well-known/oauth-protected-resource`, which is what lets claude.ai start the OAuth flow.

## Legacy SSE

The older transport (`GET /sse` opens the event stream, `POST /messages?sessionId=` sends requests). Kept for clients that have not moved to Streamable HTTP.

## Generated output

Text produced by a workflow (`start_workflow`, `generate_from_brief`, `generate_from_signal`) and returned by `get_workflow_status`. It is not a content item until `create_content_item` is called with `source_execution_id`, which the gateway treats idempotently per execution.
