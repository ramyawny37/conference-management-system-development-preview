import { createClient } from '@supabase/supabase-js';

const PURPOSE = 'PLATFORM_DEVICE_OWNERSHIP_HANDOFF';
const DEVICE_ID = 'f9306733-612d-433f-a38e-5d72855c2fe3';
const encoder = new TextEncoder();
const cors = {
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Origin': 'https://ramyawny37.github.io',
  'Vary': 'Origin',
};

function required(name: string): string {
  const value = String(Deno.env.get(name) || '').trim();
  if (!value) throw new Error(`MISSING_${name}`);
  return value;
}
function b64urlBytes(value: string): Uint8Array {
  const normalized = value.replace(/-/g, '+').replace(/_/g, '/');
  return Uint8Array.from(atob(normalized + '='.repeat((4 - normalized.length % 4) % 4)), (c) => c.charCodeAt(0));
}
function bytesHex(value: Uint8Array): string {
  return Array.from(value).map((item) => item.toString(16).padStart(2, '0')).join('');
}
function bytea(value: Uint8Array): string { return `\\x${bytesHex(value)}`; }
function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } });
}
function uuid(value: unknown, name: string): string {
  const text = String(value || '');
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(text)) throw new Error(`INVALID_${name}`);
  return text;
}
async function sha256(value: string): Promise<Uint8Array> {
  return new Uint8Array(await crypto.subtle.digest('SHA-256', encoder.encode(value)));
}
async function thumbprint(jwk: JsonWebKey): Promise<string> {
  if (jwk.kty !== 'EC' || jwk.crv !== 'P-256' || !jwk.x || !jwk.y || jwk.d) throw new Error('PUBLIC_KEY_INVALID');
  return bytesHex(await sha256(JSON.stringify({ crv: 'P-256', kty: 'EC', x: jwk.x, y: jwk.y })));
}
async function assertion(compact: string, secret: string): Promise<Record<string, unknown>> {
  const parts = compact.split('.');
  if (parts.length !== 3) throw new Error('HANDOFF_ASSERTION_INVALID');
  const header = JSON.parse(new TextDecoder().decode(b64urlBytes(parts[0])));
  const claims = JSON.parse(new TextDecoder().decode(b64urlBytes(parts[1])));
  if (header.alg !== 'HS256' || header.typ !== 'JWT') throw new Error('HANDOFF_ASSERTION_ALGORITHM_DENIED');
  const key = await crypto.subtle.importKey('raw', encoder.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['verify']);
  if (!await crypto.subtle.verify('HMAC', key, b64urlBytes(parts[2]), encoder.encode(`${parts[0]}.${parts[1]}`))) throw new Error('HANDOFF_ASSERTION_SIGNATURE_INVALID');
  const now = Math.floor(Date.now() / 1000);
  if (claims.iss !== required('PLATFORM_HANDOFF_ASSERTION_ISSUER') || claims.aud !== required('PLATFORM_HANDOFF_ASSERTION_AUDIENCE')
    || claims.purpose !== PURPOSE || claims.device_id !== DEVICE_ID || typeof claims.iat !== 'number' || typeof claims.exp !== 'number'
    || claims.iat > now + 15 || claims.exp <= now || claims.exp > claims.iat + 120) throw new Error('HANDOFF_ASSERTION_CLAIMS_INVALID');
  uuid(claims.jti, 'ASSERTION_JTI'); uuid(claims.user_id, 'ASSERTION_USER');
  uuid(claims.authorization_id, 'ASSERTION_AUTHORIZATION'); uuid(claims.challenge_id, 'ASSERTION_CHALLENGE');
  return claims;
}

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (request.method !== 'POST') return json(405, { ok: false, error: { code: 'METHOD_NOT_ALLOWED' } });
  try {
    if (String(request.headers.get('origin') || '') !== cors['Access-Control-Allow-Origin']) throw new Error('HANDOFF_ORIGIN_DENIED');
    const authorization = request.headers.get('authorization') || '';
    if (!authorization.toLowerCase().startsWith('bearer ')) throw new Error('AUTH_REQUIRED');
    const url = required('SUPABASE_URL'), anon = required('SUPABASE_ANON_KEY');
    const userClient = createClient(url, anon, { global: { headers: { Authorization: authorization } } });
    const userResult = await userClient.auth.getUser();
    if (userResult.error || !userResult.data.user) throw new Error('AUTH_REQUIRED');
    const body = await request.json();
    if (body.action === 'status') {
      const status = await userClient.schema('platform').rpc('get_my_device_key_binding_status');
      if (status.error) throw new Error('BINDING_STATUS_DENIED');
      return json(200, { ok: true, data: status.data });
    }
    if (body.action !== 'finalize') throw new Error('ACTION_NOT_SUPPORTED');
    const claims = await assertion(String(body.assertion || ''), required('PLATFORM_HANDOFF_ASSERTION_SECRET'));
    if (claims.user_id !== userResult.data.user.id) throw new Error('HANDOFF_ASSERTION_USER_MISMATCH');
    const publicJwk = body.publicKeyJwk as JsonWebKey;
    const computedThumbprint = await thumbprint(publicJwk);
    if (computedThumbprint !== claims.public_key_thumbprint) throw new Error('HANDOFF_PUBLIC_KEY_THUMBPRINT_MISMATCH');
    const signingPayload = String(body.signingPayload || '');
    if (bytesHex(await sha256(signingPayload)) !== claims.signing_payload_hash) throw new Error('HANDOFF_CHALLENGE_PAYLOAD_MISMATCH');
    if (!signingPayload || !await crypto.subtle.verify(
      { name: 'ECDSA', hash: 'SHA-256' },
      await crypto.subtle.importKey('jwk', publicJwk, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['verify']),
      b64urlBytes(String(body.keySignature || '')), encoder.encode(signingPayload),
    )) throw new Error('NEW_KEY_POSSESSION_INVALID');
    const service = createClient(url, required('SUPABASE_SERVICE_ROLE_KEY'), { auth: { persistSession: false, autoRefreshToken: false } });
    const result = await service.schema('platform').rpc('complete_device_ownership_handoff', {
      p_user_id: claims.user_id, p_device_id: claims.device_id, p_authorization_id: claims.authorization_id,
      p_challenge_id: claims.challenge_id, p_public_key_thumbprint: computedThumbprint, p_public_key_jwk: publicJwk,
      p_assertion_jti: claims.jti, p_assertion_hash: bytea(await sha256(String(body.assertion))),
      p_assertion_issued_at: new Date(Number(claims.iat) * 1000).toISOString(),
      p_assertion_expires_at: new Date(Number(claims.exp) * 1000).toISOString(),
    });
    if (result.error) throw new Error(String(result.error.message || 'HANDOFF_FINALIZATION_DENIED'));
    return json(200, { ok: true, status: 'active', data: result.data });
  } catch (error) {
    const code = String(error instanceof Error ? error.message : 'HANDOFF_DENIED').replace(/\beyJ\S+/g, '[REDACTED]').slice(0, 160);
    return json(code === 'AUTH_REQUIRED' ? 401 : 403, { ok: false, status: 'denied', error: { code } });
  }
});
