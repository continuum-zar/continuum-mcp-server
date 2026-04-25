import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import * as z from 'zod';
import { fetchBytes, fetchJson } from './continuumApi.js';

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

interface AttachmentUploader {
    id: number;
    email?: string;
    first_name?: string;
    last_name?: string;
    display_name?: string | null;
}

interface TaskAttachment {
    id: number;
    original_filename: string;
    file_size: number;
    mime_type: string;
    url?: string | null;
    file_path?: string;
    created_at?: string;
    uploader?: AttachmentUploader;
}

interface TaskAttachmentList {
    attachments: TaskAttachment[];
    total: number;
}

interface PlannerMessage {
    role: 'user' | 'assistant';
    content: string;
}

interface PlannerFileContent {
    filename: string;
    text: string;
}

interface FigmaContext {
    file_key: string;
    node_id?: string | null;
    url?: string | null;
    source_name?: string | null;
    summary: string;
    components?: string[];
    tokens?: string[];
    interactions?: string[];
    screenshots?: string[];
}

interface PlannerChatResponse {
    reply: string;
    confidence: number;
    missing_areas: string[];
    ready_to_plan: boolean;
}

interface ProjectPlanResponse {
    plan: {
        project_name: string;
        project_description: string;
        summary: string;
        reasoning?: string;
        milestones: Array<{
            name: string;
            description?: string | null;
            tasks: Array<{
                title: string;
                description?: string | null;
                scope_weight: string;
                labels?: string[];
                checklist?: Array<{ title: string; is_completed: boolean }>;
            }>;
        }>;
    };
    confidence: number;
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

function defaultProjectId(): number | undefined {
    const raw = process.env.CONTINUUM_DEFAULT_PROJECT_ID?.trim();
    if (!raw) return undefined;
    const n = Number(raw);
    return Number.isFinite(n) && n > 0 ? n : undefined;
}

function textResult(text: string) {
    return { content: [{ type: 'text' as const, text }] };
}

function resolveApiBaseUrl(): string {
    const raw = process.env.CONTINUUM_API_BASE_URL?.trim() || 'http://127.0.0.1:8001/api/v1';
    return raw.replace(/\/$/, '');
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

function formatPlanSummary(result: ProjectPlanResponse): string {
    const plan = result.plan;
    const taskCount = plan.milestones.reduce((sum, milestone) => sum + milestone.tasks.length, 0);
    const milestoneLines = plan.milestones.map((milestone, index) => {
        const tasks = milestone.tasks.map((task) => `  - ${task.title}`).join('\n');
        return `${index + 1}. ${milestone.name} (${milestone.tasks.length} task(s))\n${tasks}`;
    });
    return [
        `# ${plan.project_name}`,
        '',
        plan.project_description,
        '',
        `Confidence: ${Math.round(result.confidence)}%`,
        `Milestones: ${plan.milestones.length}`,
        `Tasks: ${taskCount}`,
        '',
        '## Summary',
        plan.summary || '(none)',
        '',
        '## Milestones',
        milestoneLines.join('\n\n') || '(none)',
    ].join('\n');
}

function formatAttachment(a: TaskAttachment): string {
    const who =
        a.uploader?.display_name ||
        [a.uploader?.first_name, a.uploader?.last_name].filter(Boolean).join(' ').trim() ||
        a.uploader?.email ||
        (a.uploader?.id ? `user ${a.uploader.id}` : 'unknown uploader');
    const size = a.file_size != null ? `${a.file_size} bytes` : 'unknown size';
    const kind = a.url || a.mime_type === 'text/uri-list' ? 'link' : 'file';
    const directUrl = a.url || `${resolveApiBaseUrl()}/attachments/${a.id}/download`;
    const created = a.created_at ? `\n  created_at: ${a.created_at}` : '';
    return `#${a.id} [${kind}] ${a.original_filename}\n  mime: ${a.mime_type}\n  size: ${size}\n  uploader: ${who}\n  download_url: ${directUrl}${created}`;
}

function parseFilenameFromContentDisposition(contentDisposition: string | null): string | null {
    if (!contentDisposition) return null;
    const utf8Match = /filename\*=UTF-8''([^;]+)/i.exec(contentDisposition);
    if (utf8Match?.[1]) {
        try {
            return decodeURIComponent(utf8Match[1]).trim();
        } catch {
            return utf8Match[1].trim();
        }
    }
    const plainMatch = /filename="?([^";]+)"?/i.exec(contentDisposition);
    return plainMatch?.[1]?.trim() || null;
}

function isTextMime(mimeType: string): boolean {
    return (
        mimeType.startsWith('text/') ||
        mimeType.includes('json') ||
        mimeType.includes('xml') ||
        mimeType.includes('javascript') ||
        mimeType.includes('yaml')
    );
}

const plannerMessageSchema = z.object({
    role: z.enum(['user', 'assistant']),
    content: z.string().min(1),
});

const plannerFileContentSchema = z.object({
    filename: z.string().min(1),
    text: z.string().min(1),
});

const figmaContextSchema = z.object({
    file_key: z.string().min(1),
    node_id: z.string().nullable().optional(),
    url: z.string().nullable().optional(),
    source_name: z.string().nullable().optional(),
    summary: z.string().min(1),
    components: z.array(z.string()).optional(),
    tokens: z.array(z.string()).optional(),
    interactions: z.array(z.string()).optional(),
    screenshots: z.array(z.string()).optional(),
});

/** Register all Continuum MCP tools on the given server (stdio or HTTP). */
export function registerContinuumTools(server: McpServer): void {
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

    server.registerTool(
        'continuum_planner_chat',
        {
            description:
                'Send messages to the Continuum AI project planner. Optionally include Figma design ' +
                'context gathered from the official Figma MCP so the planner can ask better follow-up questions.',
            inputSchema: {
                messages: z.array(plannerMessageSchema).min(1).describe('Planner conversation so far'),
                file_contents: z
                    .array(plannerFileContentSchema)
                    .default([])
                    .describe('Optional uploaded/spec-like text context'),
                figma_context: figmaContextSchema
                    .optional()
                    .describe('Optional structured Figma design context from a frame or node'),
            },
        },
        async ({ messages, file_contents, figma_context }) => {
            const body = {
                messages: messages as PlannerMessage[],
                file_contents: file_contents as PlannerFileContent[],
                figma_context: figma_context as FigmaContext | undefined,
            };
            const res = await fetchJson<PlannerChatResponse>('POST', '/planner/chat', body);
            const missing = res.missing_areas?.length
                ? `\n\nMissing areas:\n${res.missing_areas.map((area) => `- ${area}`).join('\n')}`
                : '';
            return textResult(
                `${res.reply}\n\nConfidence: ${Math.round(res.confidence)}%\nReady to plan: ${
                    res.ready_to_plan ? 'yes' : 'no'
                }${missing}`,
            );
        },
    );

    server.registerTool(
        'continuum_generate_plan',
        {
            description:
                'Generate a Continuum project plan from planner messages, optional specs, and optional ' +
                'Figma design context. Returns reviewable milestones and tasks; it does not create the project.',
            inputSchema: {
                messages: z.array(plannerMessageSchema).min(1).describe('Planner conversation so far'),
                file_contents: z
                    .array(plannerFileContentSchema)
                    .default([])
                    .describe('Optional uploaded/spec-like text context'),
                figma_context: figmaContextSchema
                    .optional()
                    .describe('Optional structured Figma design context from a frame or node'),
                raw_json: z
                    .boolean()
                    .default(false)
                    .describe('Return the full raw plan JSON instead of a compact markdown summary'),
            },
        },
        async ({ messages, file_contents, figma_context, raw_json }) => {
            const body = {
                messages: messages as PlannerMessage[],
                file_contents: file_contents as PlannerFileContent[],
                figma_context: figma_context as FigmaContext | undefined,
            };
            const res = await fetchJson<ProjectPlanResponse>('POST', '/planner/generate-plan', body);
            if (raw_json) {
                return textResult('```json\n' + JSON.stringify(res, null, 2) + '\n```');
            }
            return textResult(formatPlanSummary(res));
        },
    );

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

    server.registerTool(
        'continuum_list_task_resources',
        {
            description:
                'List files and links attached to a Continuum task (Resources). ' +
                'Returns metadata and a download/open URL for each attachment.',
            inputSchema: {
                task_id: z.number().int().positive().describe('Numeric task id'),
            },
        },
        async ({ task_id }) => {
            const list = await fetchJson<TaskAttachmentList>('GET', `/tasks/${task_id}/attachments`);
            if (!list.attachments.length) {
                return textResult(`Task #${task_id} has no attached resources.`);
            }
            const lines = list.attachments.map(formatAttachment);
            return textResult(
                `Task #${task_id} resources (${list.total}):\n\n${lines.join('\n\n')}`,
            );
        },
    );

    server.registerTool(
        'continuum_get_task_resource',
        {
            description:
                'Get one task resource/attachment by id via authenticated MCP proxy. ' +
                'Returns inline text content for text files and metadata/preview info for binary files.',
            inputSchema: {
                attachment_id: z.number().int().positive().describe('Numeric attachment id'),
                text_max_chars: z
                    .number()
                    .int()
                    .min(200)
                    .max(200000)
                    .default(20000)
                    .describe('Max text characters to return when attachment is text-like'),
            },
        },
        async ({ attachment_id, text_max_chars }) => {
            const directUrl = `${resolveApiBaseUrl()}/attachments/${attachment_id}/download`;
            const downloaded = await fetchBytes('GET', `/attachments/${attachment_id}/download`);
            const contentType = (downloaded.contentType || 'application/octet-stream').toLowerCase();
            const filename =
                parseFilenameFromContentDisposition(downloaded.contentDisposition) ||
                `attachment-${attachment_id}`;
            const size = downloaded.bytes.length;

            if (isTextMime(contentType)) {
                const fullText = new TextDecoder('utf-8').decode(downloaded.bytes);
                const clipped = fullText.length > text_max_chars;
                const text = clipped ? `${fullText.slice(0, text_max_chars)}\n\n…[truncated]` : fullText;
                return textResult(
                    [
                        `Attachment #${attachment_id} (${filename})`,
                        `mime: ${contentType}`,
                        `size: ${size} bytes`,
                        '',
                        '--- content ---',
                        text,
                    ].join('\n'),
                );
            }

            if (contentType.startsWith('image/')) {
                const base64 = Buffer.from(downloaded.bytes).toString('base64');
                return {
                    content: [
                        {
                            type: 'text' as const,
                            text: [
                                `Attachment #${attachment_id} (${filename})`,
                                `mime: ${contentType}`,
                                `size: ${size} bytes`,
                                'Fetched via authenticated MCP proxy.',
                                `direct_url: ${directUrl}`,
                            ].join('\n'),
                        },
                        {
                            type: 'image' as const,
                            data: base64,
                            mimeType: contentType,
                        },
                    ],
                };
            }

            return textResult(
                [
                    `Attachment #${attachment_id} (${filename})`,
                    `mime: ${contentType}`,
                    `size: ${size} bytes`,
                    'Binary attachment fetched via authenticated MCP proxy.',
                    'Inline rendering is only enabled for text and image resources.',
                    `direct_url: ${directUrl}`,
                ].join('\n'),
            );
        },
    );

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
            const current = await fetchJson<CursorMcpTaskDetail>('GET', `/tasks/${task_id}/cursor-mcp`);
            const items: ChecklistItem[] = (current.checklists ?? []).map((c) => ({ ...c }));

            if (mark_all_done) items.forEach((c) => (c.done = true));
            if (mark_all_undone) items.forEach((c) => (c.done = false));

            if (toggle_indices) {
                for (const idx of toggle_indices) {
                    if (idx >= 0 && idx < items.length) {
                        items[idx].done = !items[idx].done;
                    }
                }
            }

            if (append) {
                for (const a of append) {
                    items.push({ text: a.text, done: a.done });
                }
            }

            await fetchJson<TaskFull>('PUT', `/tasks/${task_id}`, { checklists: items });

            return textResult(
                `Checklist for task #${task_id} updated:\n\n${formatChecklist(items)}`,
            );
        },
    );

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
            return textResult(`Comment #${comment.id} added to task #${task_id}.`);
        },
    );
}
