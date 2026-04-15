import { AsyncLocalStorage } from 'node:async_hooks';

/** Per-request Continuum access token when running the HTTP MCP transport (OAuth). */
export const continuumAccessTokenALS = new AsyncLocalStorage<string>();

export function getContinuumAccessToken(): string {
    const fromContext = continuumAccessTokenALS.getStore();
    if (fromContext) return fromContext;
    const fromEnv = process.env.CONTINUUM_ACCESS_TOKEN?.trim() || '';
    return fromEnv;
}
