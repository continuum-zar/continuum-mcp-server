#!/usr/bin/env node
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import * as z from 'zod';
import { fetchJson } from './continuumApi.js';

// ---------------------------------------------------------------------------
// Types (mirror the backend schemas we care about)
// ---------------------------------------------------------------------------

interface TaskSummary {
    id: number;
    title: string;
    status: string;
    project_id: number;
    assigned_to: number | null;
    due_date: string | null;
    scope_weight: string | null;
    milestone_id: number | null;
    labels?: string[];
}

interface ChecklistItem {
    id?: string | null;
    text: string;
    done: boolean;
}

interface Branch {
    linked_repo: string;
    linked_branch: string;
    linked_branch_full_ref?: string | null;
    identifier: string;
}

interface CommentAuthor {
    id: number;
    display_name?: string | null;
    username?: string | null;
}

interface Comment {
    id: number;
    content: string;
    author: CommentAuthor;
    created_at: string;
}

interface CursorMcpTaskDetail {
    id: number;
    project_id: number;
    title: string;
    description: string | null;
    checklists: ChecklistItem[];
    branch: Branch | null;
    comments: Comment[];
}

interface TaskFull {
    id: number;
    title: string;
    description?: string | null;
    status: string;
    project_id: number;
    milestone_id?: number | null;
    assigned_to?: number | null;
    due_date?: string | null;
    estimated_hours?: number | null;
    scope_weight?: string | null;
    checklists?: ChecklistItem[] | null;
    created_at?: string;
    updated_at?: string | null;
    attachment_count?: number;
    comment_count?: number;
    closure_summary?: string | null;
    linked_repo?: string | null;
    linked_branch?: string | null;
    linked_branch_full_ref?: string | null;
    labels?: string[];
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function defaultProjectId(): number | undefined {
    const raw = process.env.CONTINUUM_DEFAULT_PROJECT_ID?.trim();
    if (!raw) return undefined;
    const n = Number(raw);
    return Number.isFinite(n) && n > 0 ? n : undefined;
}

function textResult(text: string) {
    return { content: [{ type: 'text' as const, text }] };
}

function formatTaskSummary(t: TaskSummary): string {
    const parts = [`#${t.id} [${t.status}] ${t.title}`];
    if (t.assigned_to) parts.push(`  assigned_to: ${t.assigned_to}`);
    if (t.due_date) parts.push(`  due: ${t.due_date}`);
    if (t.scope_weight) parts.push(`  scope: ${t.scope_weight}`);
    if (t.labels?.length) parts.push(`  labels: ${t.labels.join(', ')}`);
    return parts.join('\n');
}

function formatChecklist(items: ChecklistItem[]): string {
    if (!items.length) return '(no checklist items)';
    return items.map((c) => `- [${c.done ? 'x' : ' '}] ${c.text}`).join('\n');
}

function formatBranch(b: Branch | null): string {
    if (!b) return 'No branch linked.';
    return `${b.linked_repo} @ ${b.linked_branch}` + (b.linked_branch_full_ref ? ` (${b.linked_branch_full_ref})` : '');
}

function formatComment(c: Comment): string {
    const who = c.author.display_name || c.author.username || `User ${c.author.id}`;
    return `[${c.created_at}] ${who}:\n${c.content}`;
}

// ---------------------------------------------------------------------------
// Server
// ---------------------------------------------------------------------------

const server = new McpServer({ name: 'continuum-mcp-server', version: '0.2.0' });

// ---- continuum_list_tasks ---------------------------------------------------

server.registerTool(
    'continuum_list_tasks',
    {
        description:
            'List Continuum tasks, optionally filtered by project, status, or assignee. ' +
            'Returns a compact summary of each task (id, title, status, assignee, due date, labels). ' +
            'If CONTINUUM_DEFAULT_PROJECT_ID is set it is used when no project_id is provided.',
        inputSchema: {
            project_id: z.number().int().positive().optional().describe('Filter by project id'),
            status: z
                .enum(['todo', 'in_progress', 'done'])
                .optional()
                .describe('Filter by status'),
            assigned_to: z.number().int().positive().optional().describe('Filter by assignee user id'),
            limit: z.number().int().min(1).max(200).default(50).describe('Max tasks to return'),
            skip: z.number().int().min(0).default(0).describe('Offset for pagination'),
        },
    },
    async ({ project_id, status, assigned_to, limit, skip }) => {
        const pid = project_id ?? defaultProjectId();
        const params = new URLSearchParams();
        if (pid !== undefined) params.set('project_id', String(pid));
        if (status) params.set('status', status);
        if (assigned_to !== undefined) params.set('assigned_to', String(assigned_to));
        params.set('limit', String(limit));
        params.set('skip', String(skip));

        const tasks = await fetchJson<TaskSummary[]>('GET', `/tasks/?${params}`);
        if (!tasks.length) return textResult('No tasks found matching the filters.');
        const lines = tasks.map(formatTaskSummary);
        return textResult(`Found ${tasks.length} task(s):\n\n${lines.join('\n\n')}`);
    },
);

// ---- continuum_get_task -----------------------------------------------------

server.registerTool(
    'continuum_get_task',
    {
        description:
            'Fetch a single Continuum task with full context: title, description, checklists, ' +
            'linked Git branch, and comments. Ideal for understanding what needs to be done.',
        inputSchema: {
            task_id: z.number().int().positive().describe('Numeric task id'),
        },
    },
    async ({ task_id }) => {
        const t = await fetchJson<CursorMcpTaskDetail>('GET', `/tasks/${task_id}/cursor-mcp`);
        const sections = [
            `# Task #${t.id}: ${t.title}`,
            `**Project:** ${t.project_id}`,
            '',
            '## Description',
            t.description?.trim() || '(none)',
            '',
            '## Checklist',
            formatChecklist(t.checklists),
            '',
            '## Branch',
            formatBranch(t.branch),
        ];
        if (t.comments.length) {
            sections.push('', '## Comments', ...t.comments.map(formatComment));
        }
        return textResult(sections.join('\n'));
    },
);

// ---- continuum_get_task_raw -------------------------------------------------

server.registerTool(
    'continuum_get_task_raw',
    {
        description:
            'Fetch the full raw task object from Continuum (status, dates, hours, labels, etc.). ' +
            'Use this when you need fields not included in the aggregated view.',
        inputSchema: {
            task_id: z.number().int().positive().describe('Numeric task id'),
        },
    },
    async ({ task_id }) => {
        const t = await fetchJson<TaskFull>('GET', `/tasks/${task_id}`);
        return textResult(
            `# Task #${t.id} (raw)\n\n` + '```json\n' + JSON.stringify(t, null, 2) + '\n```',
        );
    },
);

// ---- continuum_set_task_status ----------------------------------------------

server.registerTool(
    'continuum_set_task_status',
    {
        description:
            'Move a Continuum task to a new status. Valid transitions: todo, in_progress, done.',
        inputSchema: {
            task_id: z.number().int().positive().describe('Numeric task id'),
            status: z.enum(['todo', 'in_progress', 'done']).describe('New status'),
        },
    },
    async ({ task_id, status }) => {
        const updated = await fetchJson<TaskFull>('PATCH', `/tasks/${task_id}/status`, { status });
        return textResult(`Task #${updated.id} is now **${updated.status}**.`);
    },
);

// ---- continuum_update_task_checklists ---------------------------------------
//
// The backend replaces the entire checklists array on PUT, so to toggle a
// single item we must GET -> merge -> PUT.  Callers specify which items to
// toggle by index or by text substring; new items can be appended.

server.registerTool(
    'continuum_update_task_checklists',
    {
        description:
            'Update checklist items on a Continuum task. Supports toggling items by index, ' +
            'marking all done/undone, and appending new items. ' +
            'The tool fetches the current checklist first to avoid overwriting concurrent edits.',
        inputSchema: {
            task_id: z.number().int().positive().describe('Numeric task id'),
            toggle_indices: z
                .array(z.number().int().min(0))
                .optional()
                .describe('Zero-based indices of items to toggle (done <-> undone)'),
            mark_all_done: z.boolean().optional().describe('Set every item to done'),
            mark_all_undone: z.boolean().optional().describe('Set every item to undone'),
            append: z
                .array(z.object({ text: z.string(), done: z.boolean().default(false) }))
                .optional()
                .describe('New checklist items to append'),
        },
    },
    async ({ task_id, toggle_indices, mark_all_done, mark_all_undone, append }) => {
        // Fetch current state
        const current = await fetchJson<CursorMcpTaskDetail>('GET', `/tasks/${task_id}/cursor-mcp`);
        const items: ChecklistItem[] = (current.checklists ?? []).map((c) => ({ ...c }));

        // Apply bulk mark
        if (mark_all_done) items.forEach((c) => (c.done = true));
        if (mark_all_undone) items.forEach((c) => (c.done = false));

        // Toggle specific indices
        if (toggle_indices) {
            for (const idx of toggle_indices) {
                if (idx >= 0 && idx < items.length) {
                    items[idx].done = !items[idx].done;
                }
            }
        }

        // Append new items
        if (append) {
            for (const a of append) {
                items.push({ text: a.text, done: a.done });
            }
        }

        // Write back via PUT (only checklists field, exclude_unset on backend)
        await fetchJson<TaskFull>('PUT', `/tasks/${task_id}`, { checklists: items });

        return textResult(
            `Checklist for task #${task_id} updated:\n\n${formatChecklist(items)}`,
        );
    },
);

// ---- continuum_add_comment --------------------------------------------------

server.registerTool(
    'continuum_add_comment',
    {
        description:
            'Post a comment on a Continuum task. Useful for leaving progress notes or ' +
            'asking questions visible to the rest of the team.',
        inputSchema: {
            task_id: z.number().int().positive().describe('Numeric task id'),
            content: z.string().min(1).max(5000).describe('Comment body (plain text)'),
        },
    },
    async ({ task_id, content }) => {
        const comment = await fetchJson<Comment>('POST', `/tasks/${task_id}/comments`, { content });
        return textResult(
            `Comment #${comment.id} added to task #${task_id}.`,
        );
    },
);

// ---------------------------------------------------------------------------
// Bootstrap
// ---------------------------------------------------------------------------

async function main() {
    const transport = new StdioServerTransport();
    await server.connect(transport);
}

main().catch((err) => {
    console.error(err);
    process.exit(1);
});
