/**
 * Thin HTTP client for the Continuum REST API.
 *
 * Every tool in the MCP server calls through here so auth, base-URL
 * resolution, and error formatting live in one place.
 */

import { getContinuumAccessToken } from './asyncToken.js';

function resolveBaseUrl(): string {
    const raw = process.env.CONTINUUM_API_BASE_URL?.trim() || 'http://127.0.0.1:8001/api/v1';
    return raw.replace(/\/$/, '');
}

function resolveToken(): string {
    const token = getContinuumAccessToken();
    if (!token) {
        throw new Error(
            'CONTINUUM_ACCESS_TOKEN is not set. ' +
                'Provide a valid Continuum JWT in the MCP server environment.',
        );
    }
    return token;
}

export class ContinuumApiError extends Error {
    constructor(
        public readonly status: number,
        public readonly body: string,
    ) {
        super(`Continuum API ${status}: ${body.slice(0, 800)}`);
        this.name = 'ContinuumApiError';
    }
}

export async function fetchJson<T = unknown>(
    method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE',
    path: string,
    body?: unknown,
): Promise<T> {
    const url = `${resolveBaseUrl()}${path}`;
    const headers: Record<string, string> = {
        Authorization: `Bearer ${resolveToken()}`,
        Accept: 'application/json',
    };
    if (body !== undefined) {
        headers['Content-Type'] = 'application/json';
    }
    const res = await fetch(url, {
        method,
        headers,
        body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    const text = await res.text();
    if (!res.ok) {
        if (res.status === 401) {
            throw new ContinuumApiError(
                res.status,
                'Authentication failed — your CONTINUUM_ACCESS_TOKEN has likely expired. ' +
                    'Copy a fresh JWT from the Continuum web app (Local Storage → auth-storage → accessToken) ' +
                    'and update your .cursor/mcp.json, then restart Cursor.',
            );
        }
        throw new ContinuumApiError(res.status, text);
    }
    if (!text) return undefined as T;
    return JSON.parse(text) as T;
}

export interface FetchBytesResponse {
    bytes: Uint8Array;
    contentType: string | null;
    contentDisposition: string | null;
}

export async function fetchBytes(
    method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE',
    path: string,
    body?: unknown,
): Promise<FetchBytesResponse> {
    const url = `${resolveBaseUrl()}${path}`;
    const headers: Record<string, string> = {
        Authorization: `Bearer ${resolveToken()}`,
    };
    if (body !== undefined) {
        headers['Content-Type'] = 'application/json';
    }
    const res = await fetch(url, {
        method,
        headers,
        body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    if (!res.ok) {
        const text = await res.text();
        if (res.status === 401) {
            throw new ContinuumApiError(
                res.status,
                'Authentication failed — your CONTINUUM_ACCESS_TOKEN has likely expired. ' +
                    'Copy a fresh JWT from the Continuum web app (Local Storage → auth-storage → accessToken) ' +
                    'and update your .cursor/mcp.json, then restart Cursor.',
            );
        }
        throw new ContinuumApiError(res.status, text);
    }
    const arr = new Uint8Array(await res.arrayBuffer());
    return {
        bytes: arr,
        contentType: res.headers.get('content-type'),
        contentDisposition: res.headers.get('content-disposition'),
    };
}
