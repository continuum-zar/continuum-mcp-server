#!/usr/bin/env node
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import * as z from 'zod';

function apiBase(): string {
    const raw = process.env.CONTINUUM_API_BASE_URL?.trim() || 'http://127.0.0.1:8001/api/v1';
    return raw.replace(/\/$/, '');
}

function accessToken(): string {
    return process.env.CONTINUUM_ACCESS_TOKEN?.trim() || '';
}

async function fetchCursorMcpTask(taskId: number): Promise<unknown> {
    const token = accessToken();
    if (!token) {
        throw new Error('CONTINUUM_ACCESS_TOKEN is not set');
    }
    const url = `${apiBase()}/tasks/${taskId}/cursor-mcp`;
    const res = await fetch(url, {
        headers: {
            Authorization: `Bearer ${token}`,
            Accept: 'application/json',
        },
    });
    const text = await res.text();
    if (!res.ok) {
        throw new Error(`Continuum API ${res.status}: ${text.slice(0, 800)}`);
    }
    return JSON.parse(text) as unknown;
}

const server = new McpServer({ name: 'continuum-mcp-server', version: '0.1.0' });

server.registerTool(
    'continuum_get_task',
    {
        description:
            'Fetch a Continuum task (title, description, checklists, linked branch, comments) for use in Cursor. Requires the same JWT as the web app (project membership).',
        inputSchema: {
            task_id: z.number().int().positive().describe('Numeric task id'),
        },
    },
    async ({ task_id }) => {
        const payload = await fetchCursorMcpTask(task_id);
        const text =
            `# Continuum task ${task_id}\n\n` +
            '```json\n' +
            JSON.stringify(payload, null, 2) +
            '\n```';
        return { content: [{ type: 'text' as const, text }] };
    },
);

async function main() {
    const transport = new StdioServerTransport();
    await server.connect(transport);
}

main().catch((err) => {
    console.error(err);
    process.exit(1);
});
