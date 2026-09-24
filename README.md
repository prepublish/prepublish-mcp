# prepublish-mcp

Audit a YouTube script **before** you record it, from inside your AI client.

Prepublish is a remote MCP server. It reads a draft that does not exist as a
video yet and returns hook, structure and pacing scores, the passages most
likely to lose viewers, an inauthentic-content check, a YouTube policy
pre-flight that cites YouTube's own published pages, and a words-to-runtime
calculator built on measured speaking rates.

Every other YouTube MCP server fetches the transcript of a video that is
already published. This one reads the script you have not filmed.

Free, anonymous, no API key, no account.

## Install

**Claude Code**, one command:

```bash
claude mcp add --transport http prepublish https://mcp.prepublish.ai
```

**Cursor, VS Code, Windsurf, Claude Code project scope**, or anything that
reads an `mcpServers` object:

```json
{
  "mcpServers": {
    "prepublish": {
      "type": "http",
      "url": "https://mcp.prepublish.ai"
    }
  }
}
```

**Claude Desktop**: add a custom connector under Customize, then Connectors,
and paste `https://mcp.prepublish.ai`.

**Codex CLI**, `~/.codex/config.toml`:

```toml
[mcp_servers.prepublish]
url = "https://mcp.prepublish.ai"
```

**Clients that can only launch a command** use the stdio bridge in this
repository. It needs Node 20 or newer and forwards to the same endpoint:

```json
{
  "mcpServers": {
    "prepublish": {
      "command": "npx",
      "args": ["-y", "prepublish-mcp"]
    }
  }
}
```

Agents installing this on a user's behalf should read
[`llms-install.md`](./llms-install.md).

### Check it worked

Ask for a runtime estimate: *"Use prepublish to convert 1500 words into a
runtime range."* `script_runtime` is local arithmetic, never rate limited, and
returns three estimates. If that answers, the connection is good.

## Tools

| Tool | Cost | What it returns |
| --- | --- | --- |
| `audit_script` | AI-backed | Full audit of a finished draft: hook, structure and pacing scores, an attention-risk map naming the passages most likely to lose viewers, and a rewrite. Returns the analysis and its id |
| `get_audit` | free | Collect an earlier audit by `analysis_id` |
| `audit_hook` | AI-backed | Per-sentence attention pull across the opening, curiosity gap, payoff distance, a grade, and rewritten alternatives |
| `check_authenticity` | AI-backed | Reused, templated or mass-produced content risk, with the quotes that fired each signal |
| `policy_preflight` | AI-backed | Which YouTube policy families a script touches, each citing YouTube's own page |
| `script_runtime` | free, local | Words to runtime and runtime to a word budget, at 160, 181 and 201 words per minute measured across 349 videos |

`audit_script` asks for an email address, because the full audit is released by
email. The other five do not.

### What it does not do

Every AI-backed response carries the same notice, and it is worth stating here
too. These checks are text-only. They map relative attention risk inside an
unrecorded script. They do not measure or predict the retention a published
video will get, and no output here is a forecast of views, watch time or
revenue.

Nothing fetches a video, a transcript or a channel. Every tool reads text you
pass it.

## Limits

The free tier is published live at `GET https://mcp.prepublish.ai`, which
returns a machine-readable server card with the current day's usage.

| Limit | Default |
| --- | --- |
| AI-backed calls per UTC day, across the whole endpoint | 100 |
| AI-backed calls per caller per 10 minutes | 6 |

`script_runtime` is local arithmetic and never counts against either.

A bearer token in `PREPUBLISH_TOKEN` raises the limits without changing the
tool list.

When the daily cap is reached the tool returns an error that tells the model
not to retry and names the web alternative for that day. Failures return the
next action rather than a stack trace.

## Transport and protocol

Streamable HTTP, stateless. Supported revisions: `2025-11-25`, `2025-06-18`,
`2025-03-26`, `2024-11-05`. A client asking for a supported revision gets it
back; anything else negotiates to the newest one implemented, and the
negotiated revision is reported identically in the response header and in the
`initialize` result.

The endpoint validates the `Origin` header. Requests without one, which is
every non-browser client, are always served. A browser origin that is not
`prepublish.ai` is refused with 403, as the transport specification requires.
An unsupported `MCP-Protocol-Version` header is a 400.

Aliases: `https://prepublish.ai/mcp` and `https://mcp.prepublish.ai/mcp` serve
the same handler.

## Development

The server itself lives in the Prepublish web application, not in this
repository. What is here is the stdio bridge and the conformance suite that
holds the hosted endpoint to the specification.

```bash
npm install
npm run build
MCP_URL=https://mcp.prepublish.ai npm test
```

The suite drives the endpoint with the official MCP SDK **client** over
Streamable HTTP, so the wire format is checked against the reference
implementation rather than against our own assumptions. It covers the
handshake, tool discovery, schema shape, both directions of `script_runtime`,
unknown-tool errors, the server card, batching rejection, notification
handling, protocol negotiation in both directions, Origin validation, protocol
version validation, and the stdio bridge round trip.

One AI-backed test is skipped unless `MCP_TEST_BILLABLE=1`, because a real call
costs money and writes a row.

`PREPUBLISH_MCP_URL` overrides the upstream endpoint for the bridge. The bridge
adds and hides nothing: a test asserts its tool list equals the hosted one, so
adding a tool on the server needs no release here.

## Registry

Published to the official MCP registry as `ai.prepublish/script-audit`, a
remote-only entry under the DNS-verified `ai.prepublish` namespace. See
[`server.json`](./server.json).

[![M8ven Score](https://m8ven.ai/badge/mcp/prepublish-prepublish-mcp-bcz7se)](https://m8ven.ai/mcp/prepublish-prepublish-mcp-bcz7se)

## Links

- Documentation: <https://prepublish.ai/mcp-server>
- Privacy: <https://prepublish.ai/privacy>
- Contact: <https://prepublish.ai/contact>

## License

MIT. See [LICENSE](./LICENSE).
