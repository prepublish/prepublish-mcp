# prepublish-mcp

Tooling around the hosted PrePublish MCP server. The server itself is **not** in this package. It lives in the web app and is served at `https://prepublish.ai/mcp`.

| Path | What it is |
| --- | --- |
| `prepublish-fe/app/mcp/route.ts` | The live endpoint. Streamable HTTP, stateless, anonymous-friendly |
| `prepublish-fe/lib/mcp/protocol.ts` | JSON-RPC / MCP core |
| `prepublish-fe/lib/mcp/tools.ts` | The six tools and their descriptions |
| `prepublish-fe/lib/mcp/limits.ts` | Daily spend cap and per-caller burst limit |
| `prepublish-fe/app/mcp-server/` | Public documentation page |
| `prepublish-mcp/src/bridge.ts` | stdio bridge for clients that cannot use a remote server |
| `prepublish-mcp/test/` | Conformance suite driven by the official MCP SDK client |
| `prepublish-mcp/server.json` | Registry entry for `ai.prepublish/script-audit` |

One source of truth for tools: the app. The bridge fetches its tool list from the hosted server at startup, so adding a tool needs no release here.

## Why the server is hand-rolled rather than SDK-hosted

`@modelcontextprotocol/sdk`'s `StreamableHTTPServerTransport` speaks Node's `IncomingMessage`/`ServerResponse`; a Next App Router route handler speaks Web `Request`/`Response`. Shimming one onto the other is more code, and more fragile code, than answering the five JSON-RPC methods a tools-only server needs. Conformance is not taken on trust: `test/conformance.test.ts` drives the endpoint with the official SDK **client** over Streamable HTTP, so the wire format is checked against the reference implementation.

Supported protocol revisions: `2025-11-25`, `2025-06-18`, `2025-03-26`, `2024-11-05`. A client asking for a supported revision gets it back; anything else negotiates down to the newest we implement.

## Tools

| Tool | Cost | Purpose |
| --- | --- | --- |
| `audit_script` | AI-backed | Full audit of a finished draft. Scores, attention-risk map, per-passage rewrites. Polls to completion, then returns the analysis and its id |
| `get_audit` | free | Collect an audit by `analysis_id` |
| `audit_hook` | AI-backed | Per-sentence attention pull, curiosity gap, payoff distance, grade, rewrites |
| `check_authenticity` | AI-backed | Reused / templated / mass-produced content risk with quotes and remediation |
| `policy_preflight` | AI-backed | YouTube advertiser and monetisation policy exposure, each category citing YouTube's own page. Quoted passages are the paid half |
| `script_runtime` | free, local | Words ↔ runtime from measured speaking rates (160 / 181 / 201 wpm across 349 videos) |

Every AI-backed response carries the same `notice`: the check is text-only, it maps relative attention risk inside an unrecorded script, and it does not measure or predict published YouTube retention. That sentence is repeated to the user by the model, so it is in the tool descriptions as well as the payloads.

Failures return the next action rather than a stack trace: `402` asks the user for an email, `401`/`403` points at the plan, `429` says the allowance is spent and not to retry, `503` says try later.

## Limits

Set on the web app, visible at `GET https://prepublish.ai/mcp`:

| Variable | Default | Meaning |
| --- | --- | --- |
| `MCP_DAILY_CALL_CAP` | `100` | AI-backed calls per UTC day across the whole endpoint |
| `MCP_CALLER_CALL_LIMIT` | `6` | AI-backed calls per caller per 10 minutes |

Both counters are in-process. One web container, small numbers, and a restart resets a counter rather than wrongly blocking someone. Move them to Valkey if the app ever runs replicas.

The backend's own limiter keys on client IP, and every MCP call reaches it from the web container's single IP, which is exactly why the per-caller limit exists here.

## Local development

```bash
# 1. run the app (serves /mcp)
cd ../prepublish-fe && npm run build && npm run start -- --port 4910

# 2. conformance suite against it
cd ../prepublish-mcp && npm install && npm run build && npm test
```

`npm test` covers the handshake, tool discovery, schema shape, both directions of `script_runtime`, unknown-tool errors, the server card, batching rejection, notification handling, protocol negotiation in both directions, and the stdio bridge round trip. One AI-backed test is skipped unless `MCP_TEST_BILLABLE=1`, because a real call costs money and writes a row.

Verify a deployment:

```bash
MCP_URL=https://prepublish.ai/mcp npm run test:conformance
```

## The bridge

For clients that require a local stdio command:

```json
{
  "mcpServers": {
    "prepublish": { "command": "npx", "args": ["-y", "prepublish-mcp"] }
  }
}
```

`PREPUBLISH_MCP_URL` overrides the upstream endpoint; `PREPUBLISH_TOKEN` forwards a bearer token. The bridge adds and hides nothing: a test asserts its tool list equals the hosted one.

## Registry

`server.json` claims the DNS-verified namespace `ai.prepublish/script-audit` with a remote-only entry. Two ways to prove the domain, both documented in `ops/mcp/launch-2026-09-10.md`: a DNS TXT record, or the `MCP_REGISTRY_PUBLIC_KEY` environment variable, which makes `https://prepublish.ai/.well-known/mcp-registry-auth` serve the same value. The route 404s until that variable is set, so an unconfigured deployment cannot advertise a half-finished claim.

## Known gaps

- **Protocol revision lag.** The revision in force is `2026-07-28`; this server implements up to `2025-11-25`, which the SDK also treats as latest. Newer clients are required to handle older dialects. Revisit when the SDK ships `2026-07-28`.
- **No OAuth 2.1.** Anonymous plus optional bearer token. OAuth is only needed for per-user identity and verified-directory status.
- **No per-user API keys.** Authenticated use means an existing magic-link JWT. Real API keys are the prerequisite for selling MCP access.
- **Path, not subdomain.** `mcp.prepublish.ai` needs a DNS record and a Dokploy service; when it exists, only the URL in `server.json`, the docs page and the card change.
