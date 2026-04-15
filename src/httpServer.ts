/**
 * Hosted Continuum MCP: Streamable HTTP + OAuth (RFC 8414 metadata from Continuum API).
 */
import type { AuthInfo } from '@modelcontextprotocol/sdk/server/auth/types.js';
import { getOAuthProtectedResourceMetadataUrl, mcpAuthMetadataRouter } from '@modelcontextprotocol/sdk/server/auth/router.js';
import { requireBearerAuth } from '@modelcontextprotocol/sdk/server/auth/middleware/bearerAuth.js';
import { createMcpExpressApp } from '@modelcontextprotocol/sdk/server/express.js';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { continuumAccessTokenALS } from './asyncToken.js';
import { registerContinuumTools } from './registerTools.js';

const PORT = Number(process.env.PORT || process.env.MCP_HTTP_PORT || 3000);

const issuerUrl = () => (process.env.CONTINUUM_OAUTH_ISSUER_URL || '').trim().replace(/\/$/, '');
const mcpPublicUrl = () => (process.env.MCP_PUBLIC_URL || '').trim().replace(/\/$/, '');

let cachedMetadata: Record<string, unknown> | null = null;

async function loadOAuthMetadata(): Promise<Record<string, unknown>> {
    if (cachedMetadata) return cachedMetadata;
    const iss = issuerUrl();
    if (!iss) {
        throw new Error(
            'CONTINUUM_OAUTH_ISSUER_URL is required for HTTP MCP (same host as API, e.g. https://api.example.com)',
        );
    }
    const res = await fetch(`${iss}/.well-known/oauth-authorization-server`);
    if (!res.ok) {
        throw new Error(`Failed to load OAuth metadata: ${res.status} ${await res.text()}`);
    }
    cachedMetadata = (await res.json()) as Record<string, unknown>;
    return cachedMetadata;
}

function buildVerifier(metadata: Record<string, unknown>) {
    return {
        verifyAccessToken: async (token: string): Promise<AuthInfo> => {
            const intro = metadata.introspection_endpoint as string | undefined;
            if (!intro) {
                throw new Error('OAuth metadata missing introspection_endpoint');
            }
            const r = await fetch(intro, {
                method: 'POST',
                headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
                body: new URLSearchParams({ token }),
            });
            const text = await r.text();
            if (!r.ok) {
                throw new Error(`Introspection failed: ${text.slice(0, 400)}`);
            }
            const data = JSON.parse(text) as {
                active?: boolean;
                exp?: number;
                scope?: string;
                client_id?: string;
            };
            if (!data.active) {
                throw new Error('Invalid or inactive token');
            }
            return {
                token,
                clientId: data.client_id || 'mcp',
                scopes: data.scope ? data.scope.split(/\s+/).filter(Boolean) : ['mcp:tools'],
                expiresAt: data.exp,
            };
        },
    };
}

async function main() {
    const publicBase = mcpPublicUrl();
    if (!publicBase) {
        throw new Error(
            'MCP_PUBLIC_URL is required (public origin of this MCP server, e.g. https://continuum-mcp.up.railway.app)',
        );
    }

    const oauthMetadata = await loadOAuthMetadata();
    const mcpResourceUrl = new URL('/mcp', `${publicBase}/`);

    const app = createMcpExpressApp({ host: '0.0.0.0' });

    app.get('/health', (_req, res) => {
        res.json({ ok: true, service: 'continuum-mcp-server', transport: 'stateless-streamable-http' });
    });

    app.use(
        mcpAuthMetadataRouter({
            oauthMetadata: oauthMetadata as never,
            resourceServerUrl: mcpResourceUrl,
            scopesSupported: ['openid', 'mcp:tools'],
            resourceName: 'Continuum MCP',
        }),
    );

    const verifier = buildVerifier(oauthMetadata);
    const resourceMetadataUrl = getOAuthProtectedResourceMetadataUrl(mcpResourceUrl);
    const authMiddleware = requireBearerAuth({
        verifier,
        requiredScopes: [],
        resourceMetadataUrl,
    });

    /** Stateless: one transport per request — safe behind load balancers. */
    app.post('/mcp', authMiddleware, async (req, res) => {
        const token = req.auth?.token;
        if (!token) {
            res.status(401).json({ error: 'Unauthorized' });
            return;
        }

        await continuumAccessTokenALS.run(token, async () => {
            const server = new McpServer({ name: 'continuum-mcp-server', version: '0.3.0' });
            registerContinuumTools(server);
            const transport = new StreamableHTTPServerTransport({
                sessionIdGenerator: undefined,
            });
            try {
                await server.connect(transport);
                await transport.handleRequest(req, res, req.body);
            } catch (e) {
                console.error(e);
                if (!res.headersSent) {
                    res.status(500).json({
                        jsonrpc: '2.0',
                        error: { code: -32603, message: 'Internal server error' },
                        id: null,
                    });
                }
            } finally {
                await transport.close().catch(() => {});
                await server.close().catch(() => {});
            }
        });
    });

    app.get('/mcp', (_req, res) => {
        res.status(405).json({
            jsonrpc: '2.0',
            error: { code: -32000, message: 'Use POST for MCP (stateless mode)' },
            id: null,
        });
    });

    app.delete('/mcp', (_req, res) => {
        res.status(405).json({
            jsonrpc: '2.0',
            error: { code: -32000, message: 'Session DELETE not used in stateless mode' },
            id: null,
        });
    });

    app.listen(PORT, '0.0.0.0', () => {
        console.error(`Continuum MCP HTTP listening on 0.0.0.0:${PORT} — MCP URL ${mcpResourceUrl.href}`);
    });
}

main().catch((err) => {
    console.error(err);
    process.exit(1);
});
