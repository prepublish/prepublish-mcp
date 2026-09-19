/**
 * The stdio bridge must present the hosted server's tools unchanged and forward
 * calls to it. Run against a local app instance; the bridge is spawned as a real
 * child process over stdio, exactly as a desktop client would launch it.
 *
 * Requires `npm run build` first, because a client launches `dist/bridge.js`.
 */

import assert from 'node:assert/strict'
import { existsSync } from 'node:fs'
import { test } from 'node:test'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js'

const UPSTREAM = process.env.MCP_URL ?? 'http://127.0.0.1:4910/mcp'
const BRIDGE = new URL('../dist/bridge.js', import.meta.url).pathname

test('the bridge mirrors the hosted tool list and forwards a call', { skip: !existsSync(BRIDGE) && 'run npm run build first' }, async () => {
    const client = new Client({ name: 'bridge-test', version: '1.0.0' })
    await client.connect(
        new StdioClientTransport({
            command: process.execPath,
            args: [BRIDGE],
            env: { ...process.env, PREPUBLISH_MCP_URL: UPSTREAM },
        }),
    )

    const { tools } = await client.listTools()
    assert.deepEqual(
        tools.map((tool) => tool.name).sort(),
        ['audit_hook', 'audit_script', 'check_authenticity', 'get_audit', 'policy_preflight', 'script_runtime'],
        'the bridge must add and hide nothing',
    )

    // Forwarding proves the round trip: the local tool is computed upstream.
    const result = await client.callTool({ name: 'script_runtime', arguments: { target_minutes: 5 } })
    const payload = JSON.parse((result.content as Array<{ text: string }>)[0]!.text)
    assert.equal(payload.word_budget.median, 905)

    await client.close()
})
