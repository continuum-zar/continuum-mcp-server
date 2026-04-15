#!/usr/bin/env node
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { registerContinuumTools } from './registerTools.js';

const server = new McpServer({ name: 'continuum-mcp-server', version: '0.3.0' });
registerContinuumTools(server);

async function main() {
    const transport = new StdioServerTransport();
    await server.connect(transport);
}

main().catch((err) => {
    console.error(err);
    process.exit(1);
});
