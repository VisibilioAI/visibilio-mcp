// Live smoke of the Visibilio MCP server over Streamable HTTP.
// Usage: node mcp-live-smoke.mjs <server-url> <key-file>
import { readFileSync } from 'node:fs';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';

const [serverUrl, keyFile, ...toolSpecs] = process.argv.slice(2);
const credential = readFileSync(keyFile, 'utf8').trim();
const transport = new StreamableHTTPClientTransport(new URL(serverUrl), {
  requestInit: { headers: { Authorization: `Bearer ${credential}` } },
});
const client = new Client({ name: 'live-smoke', version: '0.0.0' });
await client.connect(transport);
const { tools } = await client.listTools();
console.log(`connected; ${tools.length} tools`);
const { resources } = await client.listResources();
console.log(`${resources.length} resources: ${resources.map((r) => r.uri).join(', ')}`);

const calls = toolSpecs.length
  ? toolSpecs.map((s) => { const [name, json] = s.split('='); return [name, json ? JSON.parse(json) : {}]; })
  : [['whoami', {}], ['list_organizations', {}], ['list_products', {}]];
for (const [name, args] of calls) {
  const started = Date.now();
  try {
    const result = await client.callTool({ name, arguments: args });
    const text = result.content.map((c) => c.text ?? '').join('\n');
    console.log(`\n### ${name} ${JSON.stringify(args)} → ${result.isError ? 'ERROR' : 'ok'} (${Date.now() - started} ms)\n${text.slice(0, 700)}${text.length > 700 ? '\n…' : ''}`);
  } catch (err) {
    console.log(`\n### ${name} → THREW ${err instanceof Error ? err.message : String(err)}`);
  }
}
await client.close();
