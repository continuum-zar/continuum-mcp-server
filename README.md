# continuum-mcp-server

[Model Context Protocol](https://modelcontextprotocol.io) server for **Continuum**: list tasks, read context, update checklists, change status, and add comments via the same REST API as the web app.

**Repository:** [github.com/continuum-zar/continuum-mcp-server](https://github.com/continuum-zar/continuum-mcp-server)

## Modes

| Mode | Command | Auth |
|------|---------|------|
| **stdio** (local Cursor) | `node dist/index.js` | `CONTINUUM_ACCESS_TOKEN` (JWT) in `mcp.json` |
| **HTTP** (hosted, OAuth) | `node dist/httpServer.js` | OAuth 2.1 + PKCE via Continuum; Bearer tokens only |

## Requirements

- Node.js 18+
- Continuum **backend** with OAuth MCP routes deployed (`/.well-known/oauth-authorization-server`, `/api/v1/oauth/*`) and migration `o1a2b3c4d5e6` applied.
- For HTTP: public URL for this service (`MCP_PUBLIC_URL`) and matching `API_PUBLIC_URL` on the API.

---

## Local stdio (classic)

### Environment

| Variable | Required | Description |
|----------|----------|-------------|
| `CONTINUUM_API_BASE_URL` | Yes | e.g. `https://your-host/api/v1` (no trailing slash) |
| `CONTINUUM_ACCESS_TOKEN` | Yes | Your JWT after login |
| `CONTINUUM_DEFAULT_PROJECT_ID` | No | Default project for `continuum_list_tasks` |

### Cursor `mcp.json`

```json
{
  "mcpServers": {
    "continuum": {
      "command": "node",
      "args": ["/absolute/path/to/continuum-mcp-server/dist/index.js"],
      "env": {
        "CONTINUUM_API_BASE_URL": "https://www.continuumapp.co.za/api/v1",
        "CONTINUUM_ACCESS_TOKEN": "<JWT from Local Storage auth-storage>"
      }
    }
  }
}
```

---

## Hosted HTTP + OAuth (Railway, etc.)

The HTTP server loads OAuth metadata from your API (`GET {CONTINUUM_OAUTH_ISSUER_URL}/.well-known/oauth-authorization-server`), exposes MCP at `POST /mcp`, and validates each request with the API’s **token introspection** endpoint.

### Environment

| Variable | Description |
|----------|-------------|
| `PORT` | Listen port (Railway sets this automatically) |
| `MCP_PUBLIC_URL` | **Public origin of this MCP service** (no path), e.g. `https://continuum-mcp.up.railway.app` |
| `CONTINUUM_API_BASE_URL` | Same as stdio, e.g. `https://api.example.com/api/v1` |
| `CONTINUUM_OAUTH_ISSUER_URL` | Must match the API’s `API_PUBLIC_URL` (scheme + host), e.g. `https://api.example.com` |

Do **not** set `CONTINUUM_ACCESS_TOKEN` on the hosted service.

### Start command

```bash
npm run start:http
# or: node dist/httpServer.js
```

### User flow

1. In **Cursor**, add a **remote** MCP server pointing at `https://<your-mcp-host>/mcp` (see Cursor docs for the exact `mcp.json` shape; OAuth is triggered on first use).
2. Cursor performs **dynamic client registration** against `POST /api/v1/oauth/register` and runs the **authorization code + PKCE** flow.
3. Browser opens Continuum → `/mcp-oauth` → user is already logged in → consent returns `redirect_url` with `code`.
4. Cursor exchanges the code at `POST /api/v1/oauth/token` and sends `Authorization: Bearer <access_token>` to `/mcp`.

### Health check

`GET /health` → `{ "ok": true, "service": "continuum-mcp-server" }`

---

## Tools (both modes)

| Tool | Description |
|------|-------------|
| `continuum_list_tasks` | List tasks (filters, pagination) |
| `continuum_get_task` | Task aggregate (description, checklist, branch, comments) |
| `continuum_get_task_raw` | Full task JSON |
| `continuum_set_task_status` | `todo` / `in_progress` / `done` |
| `continuum_update_task_checklists` | Safe merge + PUT |
| `continuum_add_comment` | Post a comment |

---

## Install / build

```bash
npm install
npm run build
```

## License

MIT
