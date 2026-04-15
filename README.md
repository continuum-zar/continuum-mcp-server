# continuum-mcp-server

Thin [Model Context Protocol](https://modelcontextprotocol.io) (stdio) server for **Continuum**. It exposes a tool that loads the same task aggregate as the web app: `GET /api/v1/tasks/{task_id}/cursor-mcp` (title, description, checklists, branch, comments).

**Repository:** [github.com/continuum-zar/continuum-mcp-server](https://github.com/continuum-zar/continuum-mcp-server)

## Requirements

- Node.js 18+
- A Continuum **access token** (JWT from login). There is no long-lived PAT yet; refresh the token in Cursor config when it expires.

## Install

```bash
npm install
npm run build
```

## Environment

| Variable | Description |
|----------|-------------|
| `CONTINUUM_API_BASE_URL` | API prefix, e.g. `https://your-host.example.com/api/v1` (no trailing slash). Default: `http://127.0.0.1:8001/api/v1` |
| `CONTINUUM_ACCESS_TOKEN` | Bearer JWT for a user who is a member of the task's project |

## Tool: `continuum_get_task`

**Arguments:** `task_id` (positive integer)

Returns markdown-wrapped JSON of the Continuum `TaskCursorMcpDetail` payload.

## Cursor MCP config

Add to your Cursor MCP settings (adjust paths and host):

```json
{
  "mcpServers": {
    "continuum": {
      "command": "node",
      "args": ["/absolute/path/to/continuum-mcp-server/dist/index.js"],
      "env": {
        "CONTINUUM_API_BASE_URL": "https://your-api.example.com/api/v1",
        "CONTINUUM_ACCESS_TOKEN": "<paste access_token from Continuum login>"
      }
    }
  }
}
```

After code changes, run `npm run build` again so `dist/` is up to date.

## License

MIT
