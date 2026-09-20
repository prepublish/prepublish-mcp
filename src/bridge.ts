#!/usr/bin/env node
/**
 * stdio bridge to the hosted PrePublish MCP server.
 *
 * The tools themselves live in the web app and are served over Streamable HTTP
 * at https://prepublish.ai/mcp. That is the single source of truth: this process
 * adds no tools of its own, it forwards. It exists for clients that can only
 * speak stdio to a local command (Claude Desktop bundles, some editors and
 * local agent runtimes), so those users are not left out while a remote
 * connector is unavailable to them.
 *
 * The tool list is fetched from the remote server at startup, so adding a tool
 * in the app requires no release here.
 *
 * Usage:
 *   npx prepublish-mcp                       # bridges to https://mcp.prepublish.ai
 *   PREPUBLISH_MCP_URL=... npx prepublish-mcp # bridges to another deployment
 *   PREPUBLISH_TOKEN=...  npx prepublish-mcp  # forwards a bearer token upstream
 */

import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import { Server } from '@modelcontextprotocol/sdk/server/index.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js'

const remoteUrl = process.env.PREPUBLISH_MCP_URL ?? 'https://mcp.prepublish.ai'
const token = process.env.PREPUBLISH_TOKEN

const upstream = new Client({ name: 'prepublish-stdio-bridge', version: '1.0.0' })
await upstream.connect(
    new StreamableHTTPClientTransport(new URL(remoteUrl), {
        requestInit: token ? { headers: { authorization: `Bearer ${token}` } } : undefined,
    }),
)

const { tools } = await upstream.listTools()

// The bridge is a pass-through, so it must present the upstream server's own
// identity rather than a stub of its own. Without this, a client installed
// through the bridge sees a server with no title, no description and no
// website, and a catalogue that scans it scores the metadata as missing.
// getServerVersion() returns the upstream Implementation object, which carries
// title, description, websiteUrl and icons on revision 2025-11-25.
const upstreamInfo = upstream.getServerVersion()

const local = new Server(
    {
        name: upstreamInfo?.name ?? 'prepublish',
        version: upstreamInfo?.version ?? '1.0.0',
        ...(upstreamInfo?.title ? { title: upstreamInfo.title } : {}),
        ...(upstreamInfo?.description ? { description: upstreamInfo.description } : {}),
        ...(upstreamInfo?.websiteUrl ? { websiteUrl: upstreamInfo.websiteUrl } : {}),
        ...(upstreamInfo?.icons ? { icons: upstreamInfo.icons } : {}),
    },
    {
        capabilities: { tools: { listChanged: false } },
        ...(upstream.getInstructions() ? { instructions: upstream.getInstructions() } : {}),
    },
)

local.setRequestHandler(ListToolsRequestSchema, async () => ({ tools }))

local.setRequestHandler(CallToolRequestSchema, async (request) =>
    upstream.callTool({ name: request.params.name, arguments: request.params.arguments ?? {} }),
)

process.stderr.write(`prepublish-mcp bridge ready: upstream=${remoteUrl} tools=${tools.length} auth=${token ? 'bearer' : 'anonymous'}\n`)

await local.connect(new StdioServerTransport())
