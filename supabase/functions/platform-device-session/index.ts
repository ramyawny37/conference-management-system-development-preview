import { createClient } from '@supabase/supabase-js';

const ORIGIN = 'https://ramyawny37.github.io';
const encoder = new TextEncoder();
const cors = {
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Origin': ORIGIN,
  'Vary': 'Origin',
};
const applicationCodes = new Set([
  'ACTION_NOT_SUPPORTED', 'AUTH_REQUIRED', 'BINDING_ID_INVALID', 'CHALLENGE_ID_INVALID',
  'DEVICE_SESSION_ARGUMENT_INVALID', 'DEVICE_SESSION_AUTHORITY_INVALID', 'DEVICE_SESSION_BACKEND_REQUIRED',
  'DEVICE_SESSION_BINDING_INVALID', 'DEVICE_SESSION_CHALLENGE_ALREADY_OPEN', 'DEVICE_SESSION_CHALLENGE_INVALID',
  'DEVICE_SESSION_CONTEXT_INVALID', 'DEVICE_SESSION_FINALIZATION_DENIED', 'DEVICE_SESSION_INVALID',
  'DEVICE_SESSION_SIGNATURE_INVALID', 'DEVICE_SESSION_TOKEN_INVALID', 'PUBLIC_KEY_INVALID',
  'SESSION_ID_INVALID', 'SIGNATURE_FORMAT_INVALID',
]);

function required(name: string): string {
  const value = String(Deno.env.get(name) || '').trim();
  if (!value) throw new Error(`MISSING_${name}`);
  return value;
}
function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } });
}
function uuid(value: unknown, code: string): string {
  const text = String(value || '');
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(text)) throw new Error(code);
  return text;
}
function b64urlBytes(value: unknown, code: string): Uint8Array {
  const text = String(value || '');
  if (!/^[A-Za-z0-9_-]+$/.test(text)) throw new Error(code);
  try {
    const normalized = text.replace(/-/g, '+').replace(/_/g, '/');
    return Uint8Array.from(atob(normalized + '='.repeat((4 - normalized.length % 4) % 4)), (c) => c.charCodeAt(0));
  } catch (_) { throw new Error(code); }
}
function b64url(value: Uint8Array): string {
  return btoa(String.fromCharCode(...value)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}
function bytea(value: Uint8Array): string {
  return `\\x${Array.from(value).map((item) => item.toString(16).padStart(2, '0')).join('')}`;
}
async function sha256(value: Uint8Array): Promise<Uint8Array> {
  return new Uint8Array(await crypto.subtle.digest('SHA-256', value));
}
function safeDiagnostic(error: unknown): { code: string; sqlstate?: string; applicationCode?: string } {
  const value = error && typeof error === 'object' ? error as { code?: unknown; message?: unknown } : {};
  const message = String(value.message || (error instanceof Error ? error.message : '')).trim();
  const applicationCode = applicationCodes.has(message) ? message : undefined;
  const rawSqlstate = String(value.code || '').trim();
  const sqlstate = /^[0-9A-Z]{5}$/.test(rawSqlstate) ? rawSqlstate : undefined;
  return { code: applicationCode || 'PLATFORM_DEVICE_SESSION_DENIED', ...(sqlstate ? { sqlstate } : {}), ...(applicationCode ? { applicationCode } : {}) };
}
function safeRequestId(request: Request): string | undefined {
  const value = String(request.headers.get('sb-request-id') || request.headers.get('x-request-id') || '').trim();
  return /^[A-Za-z0-9._:-]{1,96}$/.test(value) ? value : undefined;
}
async function authenticatedUser(request: Request) {
  const authorization = request.headers.get('Authorization') || '';
  if (!/^Bearer\s+\S+$/.test(authorization)) throw new Error('AUTH_REQUIRED');
  const client = createClient(required('SUPABASE_URL'), required('SUPABASE_ANON_KEY'), {
    global: { headers: { Authorization: authorization } }, auth: { persistSession: false, autoRefreshToken: false },
  });
  const result = await client.auth.getUser();
  if (result.error || !result.data.user) throw new Error('AUTH_REQUIRED');
  return { client, user: result.data.user };
}
function serviceClient() {
  return createClient(required('SUPABASE_URL'), required('SUPABASE_SERVICE_ROLE_KEY'), {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });
  if (request.method !== 'POST') return json(405, { ok: false, error: { code: 'METHOD_NOT_ALLOWED' } });
  if (request.headers.get('Origin') !== ORIGIN) return json(403, { ok: false, error: { code: 'DEVICE_SESSION_ORIGIN_DENIED' } });
  let stage = 'AUTH';
  try {
    const { client, user } = await authenticatedUser(request);
    const body = await request.json();
    const action = String(body && body.action || '');
    if (action === 'begin') {
      stage = 'CHALLENGE_CREATION';
      const bindingId = uuid(body.bindingId, 'BINDING_ID_INVALID');
      const result = await client.schema('platform').rpc('begin_device_session_challenge', { p_binding_id: bindingId });
      if (result.error) throw result.error;
      return json(200, { ok: true, data: result.data });
    }
    if (action === 'establish') {
      stage = 'SIGNATURE_FORMAT';
      const challengeId = uuid(body.challengeId, 'CHALLENGE_ID_INVALID');
      const signature = b64urlBytes(body.signature, 'SIGNATURE_FORMAT_INVALID');
      if (signature.length !== 64) throw new Error('SIGNATURE_FORMAT_INVALID');
      const service = serviceClient();
      stage = 'CHALLENGE_CONTEXT';
      const contextResult = await service.schema('platform').rpc('get_device_session_challenge_context', {
        p_challenge_id: challengeId, p_user_id: user.id,
      });
      if (contextResult.error || !contextResult.data) throw contextResult.error || new Error('DEVICE_SESSION_CHALLENGE_INVALID');
      const context = contextResult.data;
      if (context.userId !== user.id || context.origin !== ORIGIN || context.purpose !== 'PLATFORM_DEVICE_SESSION_ESTABLISH') {
        throw new Error('DEVICE_SESSION_CONTEXT_INVALID');
      }
      const jwk = context.publicKeyJwk as JsonWebKey;
      stage = 'BINDING_JWK_LOOKUP';
      if (!jwk || jwk.kty !== 'EC' || jwk.crv !== 'P-256' || !jwk.x || !jwk.y || jwk.d) throw new Error('PUBLIC_KEY_INVALID');
      const key = await crypto.subtle.importKey('jwk', jwk, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['verify']);
      stage = 'SIGNATURE_VERIFICATION';
      const valid = await crypto.subtle.verify({ name: 'ECDSA', hash: 'SHA-256' }, key, signature, encoder.encode(String(context.signingPayload || '')));
      if (!valid) throw new Error('DEVICE_SESSION_SIGNATURE_INVALID');
      const tokenBytes = crypto.getRandomValues(new Uint8Array(32));
      const token = b64url(tokenBytes);
      const sessionId = crypto.randomUUID();
      stage = 'SESSION_FINALIZATION';
      const complete = await service.schema('platform').rpc('complete_device_session', {
        p_challenge_id: challengeId,
        p_user_id: user.id,
        p_device_id: context.deviceId,
        p_authorization_id: context.authorizationId,
        p_binding_id: context.bindingId,
        p_public_key_thumbprint: context.publicKeyThumbprint,
        p_session_id: sessionId,
        p_token_hash: bytea(await sha256(tokenBytes)),
      });
      if (complete.error || !complete.data) throw complete.error || new Error('DEVICE_SESSION_FINALIZATION_DENIED');
      return json(200, { ok: true, data: { ...complete.data, token } });
    }
    if (action === 'verify') {
      stage = 'SESSION_VERIFICATION';
      const sessionId = uuid(body.sessionId, 'SESSION_ID_INVALID');
      const tokenBytes = b64urlBytes(body.token, 'DEVICE_SESSION_TOKEN_INVALID');
      if (tokenBytes.length !== 32) throw new Error('DEVICE_SESSION_TOKEN_INVALID');
      const result = await serviceClient().schema('platform').rpc('verify_device_session', {
        p_user_id: user.id, p_session_id: sessionId, p_token_hash: bytea(await sha256(tokenBytes)),
      });
      if (result.error || !result.data) throw result.error || new Error('DEVICE_SESSION_INVALID');
      return json(200, { ok: true, data: result.data });
    }
    throw new Error('ACTION_NOT_SUPPORTED');
  } catch (error) {
    const diagnostic = safeDiagnostic(error);
    const code = diagnostic.code;
    console.error(JSON.stringify({ stage, ...(diagnostic.sqlstate ? { sqlstate: diagnostic.sqlstate } : {}),
      ...(diagnostic.applicationCode ? { applicationCode: diagnostic.applicationCode } : {}),
      timestamp: new Date().toISOString(), ...(safeRequestId(request) ? { requestId: safeRequestId(request) } : {}) }));
    return json(code === 'AUTH_REQUIRED' ? 401 : 403, { ok: false, error: { code } });
  }
});
