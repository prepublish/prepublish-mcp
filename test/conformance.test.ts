/**
 * Protocol conformance for the hosted endpoint, driven by the official MCP SDK
 * client over Streamable HTTP. The point is to check the wire format against the
 * reference implementation rather than against a hand-written reading of the
 * spec, since the server in `prepublish-fe/lib/mcp` is hand-rolled.
 *
 * Target defaults to a locally running app; point it at production to verify a
 * deployment:
 *   MCP_URL=https://prepublish.ai/mcp npm run test:conformance
 *
 * Only free, non-billable behaviour is exercised by default: handshake, tool
 * discovery, schema shape, the local `script_runtime` tool, and error paths.
 * Nothing here spends AI budget or writes a row. Set MCP_TEST_BILLABLE=1 to
 * additionally exercise one AI-backed call.
 */

import assert from 'node:assert/strict'
import { test } from 'node:test'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'

const MCP_URL = process.env.MCP_URL ?? 'http://127.0.0.1:4910/mcp'

async function connect(): Promise<Client> {
    const client = new Client({ name: 'prepublish-conformance', version: '1.0.0' })
    await client.connect(new StreamableHTTPClientTransport(new URL(MCP_URL)))
    return client
}

test('the official SDK client completes the handshake and reports server identity', async () => {
    const client = await connect()
    const info = client.getServerVersion()
    assert.equal(info?.name, 'prepublish')
    assert.ok(client.getServerCapabilities()?.tools, 'server must advertise the tools capability')
    assert.match(client.getInstructions() ?? '', /never present a score as a prediction of published retention/)
    await client.close()
})

test('every tool is discoverable with a usable schema and an honest description', async () => {
    const client = await connect()
    const { tools } = await client.listTools()
    const names = tools.map((tool) => tool.name).sort()
    assert.deepEqual(names, ['audit_hook', 'audit_script', 'check_authenticity', 'get_audit', 'policy_preflight', 'script_runtime'])

    for (const tool of tools) {
        assert.ok(tool.description && tool.description.length > 120, `${tool.name} needs a description a model can route on`)
        assert.equal(tool.inputSchema.type, 'object', `${tool.name} inputSchema must be an object schema`)
        assert.ok(tool.inputSchema.properties, `${tool.name} inputSchema must declare properties`)
    }

    // The AI-backed script tools must carry the retention caveat; the local
    // arithmetic tool must not claim to be one.
    const auditScript = tools.find((tool) => tool.name === 'audit_script')
    assert.match(auditScript?.description ?? '', /does not measure or predict published YouTube retention/)
    assert.deepEqual((auditScript?.inputSchema.required as string[]).sort(), ['script_text', 'video_title'])

    const runtime = tools.find((tool) => tool.name === 'script_runtime')
    assert.doesNotMatch(runtime?.description ?? '', /retention/i)
    await client.close()
})

test('script_runtime converts both directions from measured speaking rates', async () => {
    const client = await connect()

    const fromWords = await client.callTool({ name: 'script_runtime', arguments: { word_count: 1810 } })
    const words = JSON.parse((fromWords.content as Array<{ text: string }>)[0]!.text)
    assert.equal(words.word_count, 1810)
    assert.equal(words.runtime_minutes.median, 10)
    assert.deepEqual(words.speaking_rates_words_per_minute, { fast: 201, median: 181, slow: 160 })

    const fromMinutes = await client.callTool({ name: 'script_runtime', arguments: { target_minutes: 10 } })
    const budget = JSON.parse((fromMinutes.content as Array<{ text: string }>)[0]!.text)
    assert.equal(budget.word_budget.median, 1810)
    assert.match(budget.caveat, /Pauses, B-roll/)

    const counted = await client.callTool({ name: 'script_runtime', arguments: { script_text: 'one two three four five' } })
    assert.equal(JSON.parse((counted.content as Array<{ text: string }>)[0]!.text).word_count, 5)
    await client.close()
})

test('a call with nothing to compute explains what is missing instead of guessing', async () => {
    const client = await connect()
    const result = await client.callTool({ name: 'script_runtime', arguments: {} })
    assert.equal(result.isError, true)
    assert.match((result.content as Array<{ text: string }>)[0]!.text, /needs script_text, word_count or target_minutes/)
    await client.close()
})

test('an unknown tool is a protocol error, not a silent empty result', async () => {
    const client = await connect()
    await assert.rejects(() => client.callTool({ name: 'no_such_tool', arguments: {} }), /Unknown tool/)
    await client.close()
})

test('the endpoint answers a bare GET with a machine-readable server card', async () => {
    const response = await fetch(MCP_URL, { headers: { accept: 'application/json' } })
    assert.equal(response.status, 200)
    const card = await response.json()
    assert.equal(card.name, 'prepublish')
    assert.equal(card.transport, 'streamable-http')
    assert.ok(Array.isArray(card.protocol_versions) && card.protocol_versions.includes('2025-06-18'))
    assert.equal(card.tools.length, 6)
    assert.ok(card.free_tier.ai_backed_calls_per_day > 0)
    assert.match(card.honesty, /does not measure or predict|No result measures or predicts/)
})

test('JSON-RPC batching is refused with the reason, since the spec removed it', async () => {
    const response = await fetch(MCP_URL, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify([{ jsonrpc: '2.0', id: 1, method: 'tools/list' }]),
    })
    const body = await response.json()
    assert.equal(body.error.code, -32600)
    assert.match(body.error.message, /batching is not supported/)
})

test('a notification gets an empty 202 and no body', async () => {
    const response = await fetch(MCP_URL, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }),
    })
    assert.equal(response.status, 202)
    assert.equal(await response.text(), '')
})

test('an older protocol revision is echoed back rather than forced upward', async () => {
    const response = await fetch(MCP_URL, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
            jsonrpc: '2.0',
            id: 1,
            method: 'initialize',
            params: { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'old', version: '0' } },
        }),
    })
    const body = await response.json()
    assert.equal(body.result.protocolVersion, '2024-11-05')
})

test('an unsupported revision falls back to the newest this server implements', async () => {
    const response = await fetch(MCP_URL, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
            jsonrpc: '2.0',
            id: 1,
            method: 'initialize',
            params: { protocolVersion: '1999-01-01', capabilities: {}, clientInfo: { name: 'future', version: '0' } },
        }),
    })
    const body = await response.json()
    assert.equal(body.result.protocolVersion, '2025-11-25')
})

// Streamable HTTP transport rules, revision 2025-11-25: Origin validation
// (403 when present and invalid), the `MCP-Protocol-Version` request header
// (400 when unsupported, assume 2025-03-26 when absent), and one negotiated
// revision reported in both the response header and the initialize result.

test('a browser origin this server does not own is refused with 403 and no CORS grant', async () => {
    const response = await fetch(MCP_URL, {
        method: 'POST',
        headers: { 'content-type': 'application/json', origin: 'https://evil.example' },
        body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'ping' }),
    })
    assert.equal(response.status, 403)
    assert.equal(response.headers.get('access-control-allow-origin'), null, 'a rejected origin must not be handed a wildcard grant')
    const body = await response.json()
    assert.equal(body.id, null)
    assert.equal(body.error.code, -32600)
    assert.match(body.error.message, /may not connect/)
})

test('a preflight from a disallowed origin is answered without a cross-origin grant', async () => {
    const response = await fetch(MCP_URL, {
        method: 'OPTIONS',
        headers: { origin: 'https://evil.example', 'access-control-request-method': 'POST' },
    })
    assert.equal(response.headers.get('access-control-allow-origin'), null)

    const allowed = await fetch(MCP_URL, {
        method: 'OPTIONS',
        headers: { origin: 'https://prepublish.ai', 'access-control-request-method': 'POST' },
    })
    assert.equal(allowed.headers.get('access-control-allow-origin'), 'https://prepublish.ai')
    assert.match(allowed.headers.get('access-control-allow-headers') ?? '', /mcp-protocol-version/)
})

test('a request with no Origin header is served, because no non-browser client sends one', async () => {
    const response = await fetch(MCP_URL, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ jsonrpc: '2.0', id: 7, method: 'ping' }),
    })
    assert.equal(response.status, 200)
    assert.deepEqual(await response.json(), { jsonrpc: '2.0', id: 7, result: {} })
})

test('an origin the server does own is echoed back rather than wildcarded', async () => {
    const response = await fetch(MCP_URL, {
        method: 'POST',
        headers: { 'content-type': 'application/json', origin: 'https://prepublish.ai' },
        body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'ping' }),
    })
    assert.equal(response.status, 200)
    assert.equal(response.headers.get('access-control-allow-origin'), 'https://prepublish.ai')
    assert.match(response.headers.get('vary') ?? '', /origin/i)
})

test('an unsupported MCP-Protocol-Version header is a 400, not a served request', async () => {
    const response = await fetch(MCP_URL, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'mcp-protocol-version': '1999-01-01' },
        body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'ping' }),
    })
    assert.equal(response.status, 400)
    const body = await response.json()
    assert.equal(body.id, null)
    assert.equal(body.error.code, -32600)
    assert.match(body.error.message, /Unsupported MCP-Protocol-Version/)
    assert.ok(
        (body.error.data.supported as string[]).includes('2025-11-25'),
        'the refusal must tell the client which revisions it could have asked for',
    )
})

test('a request with no MCP-Protocol-Version header falls back to the revision the spec names', async () => {
    const response = await fetch(MCP_URL, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'ping' }),
    })
    assert.equal(response.status, 200)
    // Transports, "Protocol Version Header": with no header and no other way to
    // identify the version, the server assumes 2025-03-26.
    assert.equal(response.headers.get('mcp-protocol-version'), '2025-03-26')
})

test('one negotiated revision is reported in both the response header and the initialize result', async () => {
    const fromHeader = await fetch(MCP_URL, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'mcp-protocol-version': '2024-11-05' },
        body: JSON.stringify({
            jsonrpc: '2.0',
            id: 1,
            method: 'initialize',
            params: { capabilities: {}, clientInfo: { name: 'header-only', version: '0' } },
        }),
    })
    const headerNegotiated = (await fromHeader.json()).result.protocolVersion
    assert.equal(headerNegotiated, '2024-11-05', 'a client that states its revision in the header must not be answered a different one')
    assert.equal(fromHeader.headers.get('mcp-protocol-version'), headerNegotiated)

    // The initialize body outranks the header when both are present: that is
    // where version negotiation happens.
    const fromBody = await fetch(MCP_URL, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'mcp-protocol-version': '2024-11-05' },
        body: JSON.stringify({
            jsonrpc: '2.0',
            id: 1,
            method: 'initialize',
            params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'body', version: '0' } },
        }),
    })
    const bodyNegotiated = (await fromBody.json()).result.protocolVersion
    assert.equal(bodyNegotiated, '2025-06-18')
    assert.equal(fromBody.headers.get('mcp-protocol-version'), bodyNegotiated)
})

test('an AI-backed call reaches the backend and comes back with its caveat', { skip: process.env.MCP_TEST_BILLABLE !== '1' }, async () => {
    const client = await connect()
    const result = await client.callTool({
        name: 'audit_hook',
        arguments: { hook_text: 'Most creators lose half their viewers in the first fifteen seconds, and the reason is in the first sentence.' },
    })
    const text = (result.content as Array<{ text: string }>)[0]!.text
    if (result.isError) {
        // A gate is a legitimate outcome; it must still be actionable.
        assert.match(text, /email|allowance|account/i)
    } else {
        const payload = JSON.parse(text)
        assert.match(payload.notice, /text-only check/)
        assert.ok(payload.hook, 'a successful hook audit must return the hook payload')
    }
    await client.close()
})
