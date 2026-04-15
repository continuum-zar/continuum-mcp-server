# continuum-mcp-server

[Model Context Protocol](https://modelcontextprotocol.io) (stdio) server for **Continuum**. It lets Cursor and other MCP-compatible tools interact with your Continuum project: list and read tasks, move them through statuses, toggle checklist items, and post comments — all through the same REST API the web app uses.

**Repository:** [github.com/continuum-zar/continuum-mcp-server](https://github.com/continuum-zar/continuum-mcp-server)

## Requirements

- Node.js 18+
- A Continuum **access token** (JWT). See [Authentication](#authentication) for how to get one.

## Install

```bash
npm install
npm run build
```

## Authentication

Each user provides **their own** Continuum JWT in their local Cursor MCP config. There is no shared token — every developer authenticates as themselves so actions (status changes, comments) are attributed correctly.

### Getting your token

1. Log into [Continuum](https://www.continuumapp.co.za) in your browser.
2. Open DevTools (F12) → **Application** → **Local Storage** → look for the `auth-storage` key.
3. Copy the `accessToken` value (it starts with `eyJ…`).
4. Paste it into your `.cursor/mcp.json` as `CONTINUUM_ACCESS_TOKEN` (see [setup](#cursor-mcp-config) below).

### Token lifetime

| Token type | Lifetime | How to refresh |
|------------|----------|----------------|
| Access token | 30 minutes | Re-copy from Local Storage after the web app refreshes it automatically, or call `POST /api/v1/auth/refresh-token` with your refresh token |
| Refresh token | 24 hours | Log in again |

When your access token expires, MCP tool calls will fail with a `401` error. Update `CONTINUUM_ACCESS_TOKEN` in your `mcp.json` and restart Cursor (or reload the MCP server).

> **Do not** set `CONTINUUM_ACCESS_TOKEN` as a shared environment variable on a hosted service (e.g. Railway) for multi-user use. The MCP server is designed to run **locally** via stdio — each user's token stays on their machine.

## Environment

| Variable | Required | Description |
|----------|----------|-------------|
| `CONTINUUM_API_BASE_URL` | Yes (for production) | API prefix, e.g. `https://www.continuumapp.co.za/api/v1` (no trailing slash). Default: `http://127.0.0.1:8001/api/v1` |
| `CONTINUUM_ACCESS_TOKEN` | Yes | Your personal Bearer JWT from Continuum login |
| `CONTINUUM_DEFAULT_PROJECT_ID` | No | Default `project_id` for `continuum_list_tasks` when not specified in the prompt |

## Tools

| Tool | Description | Key inputs |
|------|-------------|------------|
| `continuum_list_tasks` | List tasks with optional filters | `project_id?`, `status?`, `assigned_to?`, `limit`, `skip` |
| `continuum_get_task` | Aggregated task context (description, checklists, branch, comments) | `task_id` |
| `continuum_get_task_raw` | Full raw task JSON (status, dates, hours, labels, etc.) | `task_id` |
| `continuum_set_task_status` | Move a task to `todo`, `in_progress`, or `done` | `task_id`, `status` |
| `continuum_update_task_checklists` | Toggle items, mark all done/undone, or append new items | `task_id`, `toggle_indices?`, `mark_all_done?`, `mark_all_undone?`, `append?` |
| `continuum_add_comment` | Post a plain-text comment on a task | `task_id`, `content` |

### Checklist update semantics

`continuum_update_task_checklists` always performs a safe read-modify-write cycle: it fetches the current checklist, applies your changes, then writes the full array back. This prevents accidental data loss when only toggling a single item.

- **toggle_indices** — zero-based indices of items whose `done` flag should flip.
- **mark_all_done / mark_all_undone** — bulk set every item. Applied *before* individual toggles.
- **append** — new `{ text, done }` objects added to the end of the list.

## Cursor MCP config

Add to `.cursor/mcp.json` in your home directory (or project `.cursor/mcp.json`):

```json
{
  "mcpServers": {
    "continuum": {
      "command": "node",
      "args": ["/absolute/path/to/continuum-mcp-server/dist/index.js"],
      "env": {
        "CONTINUUM_API_BASE_URL": "https://www.continuumapp.co.za/api/v1",
        "CONTINUUM_ACCESS_TOKEN": "<your personal JWT — see Authentication section>",
        "CONTINUUM_DEFAULT_PROJECT_ID": "27"
      }
    }
  }
}
```

Replace `/absolute/path/to/continuum-mcp-server` with wherever you cloned this repo. After code changes, run `npm run build` so `dist/` is up to date.

### Quick setup checklist

1. Clone this repo and run `npm install && npm run build`.
2. Copy the JSON block above into `~/.cursor/mcp.json`.
3. Update the `args` path to your local clone.
4. Paste your JWT into `CONTINUUM_ACCESS_TOKEN`.
5. Restart Cursor — the "continuum" server should appear in the MCP panel.
6. Try: *"list my tasks"* or *"get task 542"* in Cursor chat.

## License

MIT
