# Installing the Prepublish MCP server

Prepublish is a remote Streamable HTTP server. No API key, account, or environment variable is required.

## Preferred: connect to the remote endpoint

Add this to the client's MCP configuration:

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

Claude Code, one command:

```bash
claude mcp add --transport http prepublish https://mcp.prepublish.ai
```

## Fallback: stdio bridge for clients that only launch commands

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

Node 20 or newer is required for the bridge. It forwards to the same remote endpoint and exposes the same six tools.

## Verify

Call `script_runtime` with `{"word_count": 1500}`. It is local arithmetic, never rate limited, and returns three runtime estimates. If that works, the connection is good.

## Tools

| Tool | Purpose | Required inputs |
| --- | --- | --- |
| `audit_script` | Full audit of a written script: hook, structure, pacing, attention-risk map, one rewrite | `video_title`, `script_text` |
| `get_audit` | Fetch an audit started earlier | `analysis_id` |
| `audit_hook` | Score the opening lines and rewrite them | `hook_text` |
| `check_authenticity` | Inauthentic-content check with firing signals | `video_title`, `script_text` |
| `policy_preflight` | YouTube policy categories a script may touch, citing YouTube's pages | `script` |
| `script_runtime` | Words to runtime, or target minutes to a word budget | none |

## Limits

100 AI-backed calls per UTC day across the whole endpoint and 6 per caller per 10 minutes. `audit_script` asks for an email address because the full result is released by email. The other tools need no address. `script_runtime` never counts against the cap.

Docs: https://prepublish.ai/mcp-server
