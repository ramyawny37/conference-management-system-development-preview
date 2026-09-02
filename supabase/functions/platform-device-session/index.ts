import { createClient } from '@supabase/supabase-js';

const ORIGIN = 'https://ramyawny37.github.io';
const encoder = new TextEncoder();
const cors = {
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Origin': ORIGIN,
  'Vary': 'Origin',
};

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
function safeCode(error: unknown): string {
  const source = error && typeof error === 'object' && 'message' in error ? String((error as { message?: unknown }).message || '') : String(error || '');
  const match = source.match(/\b([A-Z][A-Z0-9_]{2,95})\b/);
  return match ? match[1] : 'DEVICE_SESSION_DENIED';
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
  try {
    const { client, user } = await authenticatedUser(request);
    const body = await request.json();
    const action = String(body && body.action || '');
    if (action === 'begin') {
      const bindingId = uuid(body.bindingId, 'BINDING_ID_INVALID');
      const result = await client.schema('platform').rpc('begin_device_session_challenge', { p_binding_id: bindingId });
      if (result.error) throw result.error;
      return json(200, { ok: true, data: result.data });
    }
    if (action === 'establish') {
      const challengeId = uuid(body.challengeId, 'CHALLENGE_ID_INVALID');
      const signature = b64urlBytes(body.signature, 'SIGNATURE_FORMAT_INVALID');
      if (signature.length !== 64) throw new Error('SIGNATURE_FORMAT_INVALID');
      const service = serviceClient();
      const contextResult = await service.schema('platform').rpc('get_device_session_challenge_context', {
        p_challenge_id: challengeId, p_user_id: user.id,
      });
      if (contextResult.error || !contextResult.data) throw contextResult.error || new Error('DEVICE_SESSION_CHALLENGE_INVALID');
      const context = contextResult.data;
      if (context.userId !== user.id || context.origin !== ORIGIN || context.purpose !== 'PLATFORM_DEVICE_SESSION_ESTABLISH') {
        throw new Error('DEVICE_SESSION_CONTEXT_INVALID');
      }
      const jwk = context.publicKeyJwk as JsonWebKey;
      if (!jwk || jwk.kty !== 'EC' || jwk.crv !== 'P-256' || !jwk.x || !jwk.y || jwk.d) throw new Error('PUBLIC_KEY_INVALID');
      const key = await crypto.subtle.importKey('jwk', jwk, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['verify']);
      const valid = await crypto.subtle.verify({ name: 'ECDSA', hash: 'SHA-256' }, key, signature, encoder.encode(String(context.signingPayload || '')));
      if (!valid) throw new Error('DEVICE_SESSION_SIGNATURE_INVALID');
      const tokenBytes = crypto.getRandomValues(new Uint8Array(32));
      const token = b64url(tokenBytes);
      const sessionId = crypto.randomUUID();
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
    const code = safeCode(error);
    console.error(JSON.stringify({ code, stage: 'DEVICE_SESSION', timestamp: new Date().toISOString() }));
    return json(code === 'AUTH_REQUIRED' ? 401 : 403, { ok: false, error: { code } });
  }
});
