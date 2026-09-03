import { createClient } from '@supabase/supabase-js';
import {
  generateAuthenticationOptions,
  generateRegistrationOptions,
  verifyAuthenticationResponse,
  verifyRegistrationResponse,
} from '@simplewebauthn/server';
import { cose, decodeCredentialPublicKey } from '@simplewebauthn/server/helpers';

const corsBaseHeaders = {
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Vary': 'Origin',
};
const encoder = new TextEncoder();

function required(name: string): string {
  const value = String(Deno.env.get(name) || '').trim();
  if (!value) throw new Error(`MISSING_${name}`);
  return value;
}
function bytesToBase64Url(bytes: Uint8Array): string {
  let binary = '';
  bytes.forEach((value) => { binary += String.fromCharCode(value); });
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}
function base64ToBytes(value: string): Uint8Array {
  const normalized = value.replace(/-/g, '+').replace(/_/g, '/');
  const padded = normalized + '='.repeat((4 - normalized.length % 4) % 4);
  return Uint8Array.from(atob(padded), (character) => character.charCodeAt(0));
}
function bytea(bytes: Uint8Array): string {
  return `\\x${Array.from(bytes).map((value) => value.toString(16).padStart(2, '0')).join('')}`;
}
async function sha256(bytes: Uint8Array): Promise<Uint8Array> {
  return new Uint8Array(await crypto.subtle.digest('SHA-256', bytes));
}
function uuid(value: unknown, label: string): string {
  const normalized = String(value || '');
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(normalized)) {
    throw new Error(`INVALID_${label}`);
  }
  return normalized;
}
function corsHeaders(requestOrigin: string): Record<string, string> | null {
  const expectedOrigin = required('WEBAUTHN_EXPECTED_ORIGIN').toLowerCase();
  return requestOrigin.toLowerCase() === expectedOrigin
    ? { ...corsBaseHeaders, 'Access-Control-Allow-Origin': requestOrigin.toLowerCase() }
    : null;
}
function responseJson(status: number, body: unknown, headers: Record<string, string>): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...headers, 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  });
}
function environment(): string {
  const value = required('WEBAUTHN_ENVIRONMENT');
  if (!['local', 'development_preview', 'production'].includes(value)) throw new Error('INVALID_WEBAUTHN_ENVIRONMENT');
  return value;
}
function verificationContext(info: { userVerified?: boolean; credentialBackedUp?: boolean; credentialDeviceType?: string }): Record<string, unknown> {
  return {
    userVerified: info.userVerified === true,
    backupEligible: info.credentialDeviceType === 'multiDevice',
    backupState: info.credentialBackedUp === true,
  };
}
function logSafeDiagnostic(phase: string, error: unknown): void {
  const errorName = String(error instanceof Error ? error.name : 'UnknownError')
    .replace(/[^A-Za-z0-9_.:-]/g, '_').slice(0, 80);
  const errorMessage = String(error instanceof Error ? error.message : 'PLATFORM_DEVICE_AUTHORIZATION_FAILED')
    .slice(0, 240)
    .replace(/Bearer\s+\S+/gi, '[REDACTED]')
    .replace(/\beyJ[A-Za-z0-9_-]*\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/g, '[REDACTED]')
    .replace(/\bsb_(?:publishable|secret)_[A-Za-z0-9_-]+\b/gi, '[REDACTED]')
    .replace(/\b[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\b/gi, '[REDACTED]')
    .replace(/[A-Za-z0-9_-]{41,}/g, '[REDACTED]');
  console.error(JSON.stringify({ phase, errorName, errorMessage }));
}

Deno.serve(async (request) => {
  let currentAction = '';
  const requestOrigin = String(request.headers.get('origin') || '').toLowerCase();
  const responseCorsHeaders = corsHeaders(requestOrigin);
  if (!responseCorsHeaders) return responseJson(403, { ok: false, error: { code: 'APP_ORIGIN_DENIED' } }, corsBaseHeaders);
  if (request.method === 'OPTIONS') return new Response('ok', { headers: responseCorsHeaders });
  const json = (status: number, body: unknown) => responseJson(status, body, responseCorsHeaders);
  if (request.method !== 'POST') return json(405, { ok: false, error: { code: 'METHOD_NOT_ALLOWED' } });
  try {
    const supabaseUrl = required('SUPABASE_URL');
    const anonKey = required('SUPABASE_ANON_KEY');
    const serviceKey = required('SUPABASE_SERVICE_ROLE_KEY');
    const expectedOrigin = required('WEBAUTHN_EXPECTED_ORIGIN').toLowerCase();
    const rpID = required('WEBAUTHN_RP_ID').toLowerCase();
    const rpName = Deno.env.get('WEBAUTHN_RP_NAME') || 'Conference Management Platform';
    const authorization = request.headers.get('authorization') || '';
    if (!authorization.toLowerCase().startsWith('bearer ')) throw new Error('AUTH_REQUIRED');
    const userClient = createClient(supabaseUrl, anonKey, { global: { headers: { Authorization: authorization } } });
    const { data: userData, error: userError } = await userClient.auth.getUser();
    if (userError || !userData.user) throw new Error('AUTH_REQUIRED');
    const actorUserId = userData.user.id;
    const backend = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });
    const body = await request.json();
    const action = String(body.action || '');
    currentAction = action;
    const stableRecoveryAction = action === 'get-stable-development-recovery-state'
      || action === 'begin-stable-development-recovery'
      || action === 'finish-stable-development-recovery';
    const actorDeviceId = stableRecoveryAction ? null : uuid(body.actorDeviceId, 'ACTOR_DEVICE_ID');
    const env = environment();
    const call = async (name: string, args: Record<string, unknown>) => {
      const { data, error } = await backend.rpc(name, args);
      if (error) throw new Error(String(error.message || error.code || 'DATABASE_REJECTED'));
      return data;
    };
    const failChallenge = async (payload: Record<string, unknown>, code: string) => {
      try {
        await call('fail_system_owner_device_possession_challenge', {
          p_actor_user_id: actorUserId, p_actor_device_id: actorDeviceId,
          p_session_id: uuid(payload.sessionId, 'SESSION_ID'),
          p_challenge_id: uuid(payload.challengeId, 'CHALLENGE_ID'), p_failure_code: code,
        });
      } catch (_) { /* The original verification failure remains authoritative. */ }
    };

    if (action === 'get-administration-state') {
      const result = await call('get_system_owner_platform_device_administration_state', {
        p_actor_user_id: actorUserId, p_actor_device_id: actorDeviceId,
      });
      if (result.credentialExternalId) {
        result.credentialExternalId = bytesToBase64Url(base64ToBytes(result.credentialExternalId));
      }
      return json(200, { ok: true, status: result.status, data: result });
    }

    if (action === 'get-stable-development-recovery-state') {
      const result = await call('get_stable_development_platform_device_recovery_state', {
        p_actor_user_id: actorUserId, p_actor_device_id: null,
      });
      return json(200, { ok: true, status: result.status,
        data: { status: result.status, credentialId: result.credentialId } });
    }

    if (action === 'begin-credential-enrollment') {
      const sessionId = crypto.randomUUID();
      const operationId = crypto.randomUUID();
      const bootstrapToken = String(body.bootstrapToken || '');
      if (bootstrapToken.length < 32) throw new Error('BOOTSTRAP_TOKEN_REQUIRED');
      const options = await generateRegistrationOptions({
        rpName, rpID, userName: userData.user.email || actorUserId,
        userDisplayName: userData.user.user_metadata?.display_name || userData.user.email || actorUserId,
        userID: encoder.encode(actorUserId), attestationType: 'none',
        authenticatorSelection: { residentKey: 'required', userVerification: 'required' },
        supportedAlgorithmIDs: [-7, -257], timeout: 120000,
      });
      const result = await call('begin_system_owner_credential_enrollment', {
        p_actor_user_id: actorUserId, p_actor_device_id: actorDeviceId, p_session_id: sessionId,
        p_environment: env, p_expected_origin: expectedOrigin, p_expected_rp_id: rpID,
        p_challenge_hash: bytea(await sha256(base64ToBytes(options.challenge))), p_operation_id: operationId,
        p_bootstrap_hash: bytea(await sha256(encoder.encode(bootstrapToken))),
      });
      return json(200, { ok: true, status: 'challenge_created', data: { options, sessionId, operationId,
        challengeId: result.challengeId, bootstrapAuthorizationId: result.bootstrapAuthorizationId } });
    }

    if (action === 'finish-credential-enrollment') {
      const response = body.response;
      const challenge = String(body.challenge || '');
      let verification;
      try {
        verification = await verifyRegistrationResponse({ response, expectedChallenge: challenge,
          expectedOrigin, expectedRPID: rpID, requireUserVerification: true });
      } catch (error) {
        await failChallenge(body, 'REGISTRATION_VERIFICATION_FAILED');
        throw error;
      }
      if (!verification.verified || !verification.registrationInfo) {
        await failChallenge(body, 'REGISTRATION_NOT_VERIFIED');
        throw new Error('WEBAUTHN_REGISTRATION_INVALID');
      }
      const info = verification.registrationInfo;
      const context = verificationContext(info);
      if (!context.userVerified || (context.backupState && !context.backupEligible)) throw new Error('WEBAUTHN_CREDENTIAL_POLICY_DENIED');
      const decodedKey = decodeCredentialPublicKey(info.credential.publicKey);
      const result = await call('complete_system_owner_credential_enrollment', {
        p_actor_user_id: actorUserId, p_actor_device_id: actorDeviceId,
        p_session_id: uuid(body.sessionId, 'SESSION_ID'), p_environment: env,
        p_challenge_id: uuid(body.challengeId, 'CHALLENGE_ID'),
        p_challenge_hash: bytea(await sha256(base64ToBytes(challenge))),
        p_operation_id: uuid(body.operationId, 'OPERATION_ID'),
        p_bootstrap_authorization_id: uuid(body.bootstrapAuthorizationId, 'BOOTSTRAP_AUTHORIZATION_ID'),
        p_credential_id: bytea(base64ToBytes(info.credential.id)), p_public_key_cose: bytea(info.credential.publicKey),
        p_public_key_algorithm: Number(decodedKey.get(cose.COSEKEYS.alg)), p_aaguid: info.aaguid || null,
        p_transports: response.response?.transports || [], p_sign_count: info.credential.counter,
        p_origin: expectedOrigin, p_rp_id: rpID, p_verification_context: context,
      });
      return json(200, { ok: true, status: result.status, data: result });
    }

    if (action === 'begin-stable-development-recovery') {
      const recoveryState = await call('get_stable_development_platform_device_recovery_state', {
        p_actor_user_id: actorUserId, p_actor_device_id: null,
      });
      const recoveryActorDeviceId = uuid(recoveryState.serverActorDeviceId, 'RECOVERY_ACTOR_DEVICE_ID');
      const sessionId = crypto.randomUUID();
      const options = await generateAuthenticationOptions({
        rpID, userVerification: 'required', timeout: 120000, allowCredentials: [],
      });
      const result = await call('begin_stable_development_platform_device_recovery', {
        p_actor_user_id: actorUserId, p_actor_device_id: recoveryActorDeviceId,
        p_credential_id: uuid(recoveryState.credentialId, 'CREDENTIAL_ID'), p_session_id: sessionId,
        p_challenge_hash: bytea(await sha256(base64ToBytes(options.challenge))), p_environment: env,
      });
      return json(200, { ok: true, status: 'challenge_created', data: {
        options: { ...options, allowCredentials: [{
          id: bytesToBase64Url(base64ToBytes(result.credentialExternalId)),
          type: 'public-key', transports: result.transports || [],
        }] },
        sessionId, challengeId: result.challengeId,
        recoveryAuthorizationId: result.recoveryAuthorizationId,
        operationId: result.operationId, credentialId: result.credentialId,
      } });
    }

    if (action === 'finish-stable-development-recovery') {
      const recoveryState = await call('get_stable_development_platform_device_recovery_state', {
        p_actor_user_id: actorUserId, p_actor_device_id: null,
      });
      const recoveryActorDeviceId = uuid(recoveryState.serverActorDeviceId, 'RECOVERY_ACTOR_DEVICE_ID');
      const challenge = String(body.challenge || '');
      const material = await call('get_stable_development_platform_device_recovery_material', {
        p_actor_user_id: actorUserId, p_actor_device_id: recoveryActorDeviceId,
        p_session_id: uuid(body.sessionId, 'SESSION_ID'),
        p_challenge_id: uuid(body.challengeId, 'CHALLENGE_ID'),
      });
      let verification;
      try {
        verification = await verifyAuthenticationResponse({
          response: body.response, expectedChallenge: challenge, expectedOrigin,
          expectedRPID: rpID, requireUserVerification: true,
          credential: {
            id: bytesToBase64Url(base64ToBytes(String(material.credentialExternalId || ''))),
            publicKey: base64ToBytes(String(material.publicKeyCose || '')),
            counter: Number(material.signCount), transports: material.transports || [],
          },
        });
      } catch (error) {
        logSafeDiagnostic('stable-development-recovery-verification', error);
        throw error;
      }
      if (!verification.verified) throw new Error('WEBAUTHN_ASSERTION_INVALID');
      const info = verification.authenticationInfo;
      const context = verificationContext(info);
      if (context.userVerified !== true || (context.backupState && !context.backupEligible)) {
        throw new Error('WEBAUTHN_CREDENTIAL_POLICY_DENIED');
      }
      const result = await call('complete_stable_development_platform_device_recovery', {
        p_actor_user_id: actorUserId, p_actor_device_id: recoveryActorDeviceId,
        p_credential_id: uuid(material.credentialId, 'CREDENTIAL_ID'),
        p_session_id: uuid(body.sessionId, 'SESSION_ID'),
        p_challenge_id: uuid(body.challengeId, 'CHALLENGE_ID'),
        p_challenge_hash: bytea(await sha256(base64ToBytes(challenge))),
        p_recovery_authorization_id: uuid(body.recoveryAuthorizationId, 'RECOVERY_AUTHORIZATION_ID'),
        p_operation_id: uuid(body.operationId, 'OPERATION_ID'), p_environment: env,
        p_new_sign_count: info.newCounter, p_origin: expectedOrigin, p_rp_id: rpID,
        p_verification_context: context,
      });
      return json(200, { ok: true, status: result.status, data: result });
    }

    if (action.startsWith('begin-pending-device-')) {
      const mode = action.slice('begin-pending-device-'.length);
      if (!['list', 'approval', 'rejection'].includes(mode)) throw new Error('ACTION_NOT_SUPPORTED');
      const sessionId = crypto.randomUUID();
      const operationId = mode === 'list' ? null : uuid(body.operationId, 'OPERATION_ID');
      const purpose = mode === 'list' ? 'SYSTEM_OWNER_PENDING_DEVICE_LIST'
        : mode === 'approval' ? 'SYSTEM_OWNER_PENDING_DEVICE_APPROVE' : 'SYSTEM_OWNER_PENDING_DEVICE_REJECT';
      const options = await generateAuthenticationOptions({ rpID, userVerification: 'required', timeout: 120000,
        allowCredentials: [] });
      const result = await call('begin_system_owner_device_possession_challenge', {
        p_actor_user_id: actorUserId, p_actor_device_id: actorDeviceId,
        p_credential_id: uuid(body.credentialId, 'CREDENTIAL_ID'), p_session_id: sessionId,
        p_purpose: purpose, p_target_user_id: mode === 'list' ? null : uuid(body.targetUserId, 'TARGET_USER_ID'),
        p_target_device_id: mode === 'list' ? null : uuid(body.targetDeviceId, 'TARGET_DEVICE_ID'),
        p_operation_id: operationId, p_environment: env, p_expected_origin: expectedOrigin,
        p_expected_rp_id: rpID, p_challenge_hash: bytea(await sha256(base64ToBytes(options.challenge))),
      });
      if (result.status === 'completed') return json(200, { ok: true, status: 'completed', data: result });
      return json(200, { ok: true, status: 'challenge_created', data: { options: { ...options,
        allowCredentials: [{ id: bytesToBase64Url(base64ToBytes(result.credentialExternalId)), type: 'public-key', transports: result.transports || [] }] },
        sessionId, operationId, challengeId: result.challengeId, credentialId: result.credentialId,
        publicKeyCose: result.publicKeyCose, signCount: result.signCount } });
    }

    if (action.startsWith('finish-pending-device-')) {
      const mode = action.slice('finish-pending-device-'.length);
      if (!['list', 'approval', 'rejection'].includes(mode)) throw new Error('ACTION_NOT_SUPPORTED');
      const challenge = String(body.challenge || '');
      const material = await call('get_system_owner_device_challenge_verification_material', {
        p_actor_user_id: actorUserId, p_actor_device_id: actorDeviceId,
        p_session_id: uuid(body.sessionId, 'SESSION_ID'), p_challenge_id: uuid(body.challengeId, 'CHALLENGE_ID'),
      });
      let phase = 'credential-material-conversion';
      try {
        const credential = { id: bytesToBase64Url(base64ToBytes(String(material.credentialExternalId || ''))),
          publicKey: base64ToBytes(String(material.publicKeyCose || '')), counter: Number(material.signCount),
          transports: material.transports || [] };
        phase = 'verify-authentication-response';
        let verification;
        try {
          verification = await verifyAuthenticationResponse({ response: body.response,
            expectedChallenge: challenge, expectedOrigin, expectedRPID: rpID, credential,
            requireUserVerification: true });
        } catch (error) {
          await failChallenge(body, 'ASSERTION_VERIFICATION_FAILED');
          throw error;
        }
        phase = 'verification-result/policy';
        if (!verification.verified) {
          await failChallenge(body, 'ASSERTION_NOT_VERIFIED');
          throw new Error('WEBAUTHN_ASSERTION_INVALID');
        }
        const info = verification.authenticationInfo;
        const context = verificationContext(info);
        if (!context.userVerified || (context.backupState && !context.backupEligible)) throw new Error('WEBAUTHN_CREDENTIAL_POLICY_DENIED');
        phase = 'completion-payload-construction';
        const common = { p_actor_user_id: actorUserId, p_actor_device_id: actorDeviceId,
          p_credential_id: uuid(material.credentialId, 'CREDENTIAL_ID'), p_session_id: uuid(body.sessionId, 'SESSION_ID'),
          p_environment: env, p_challenge_id: uuid(body.challengeId, 'CHALLENGE_ID'),
          p_challenge_hash: bytea(await sha256(base64ToBytes(challenge))), p_new_sign_count: info.newCounter,
          p_origin: expectedOrigin, p_rp_id: rpID, p_verification_context: context };
        if (mode === 'list') {
          const listingToken = bytesToBase64Url(crypto.getRandomValues(new Uint8Array(32)));
          const listingId = crypto.randomUUID();
          const completionPayload = { ...common, p_listing_id: listingId,
            p_listing_token_hash: bytea(await sha256(encoder.encode(listingToken))) };
          phase = 'before-completion-rpc';
          phase = 'completion-rpc';
          const result = await call('complete_system_owner_pending_device_listing', completionPayload);
          const listed = await call('list_system_owner_pending_device_authorizations', {
            p_actor_user_id: actorUserId, p_actor_device_id: actorDeviceId, p_session_id: body.sessionId,
            p_environment: env, p_listing_token_hash: bytea(await sha256(encoder.encode(listingToken))) });
          return json(200, { ok: true, status: result.status, data: { ...listed, listingToken,
            listingSessionId: body.sessionId, credentialId: body.credentialId,
            credentialExternalId: material.credentialExternalId } });
        }
        const completionPayload = { ...common,
          p_operation_id: uuid(body.operationId, 'OPERATION_ID'), p_target_user_id: uuid(body.targetUserId, 'TARGET_USER_ID'),
          p_target_device_id: uuid(body.targetDeviceId, 'TARGET_DEVICE_ID'),
          p_action: mode === 'approval' ? 'approve' : 'reject' };
        phase = 'before-completion-rpc';
        phase = 'completion-rpc';
        const result = await call('complete_system_owner_pending_device_operation', completionPayload);
        return json(200, { ok: true, status: result.status, data: result });
      } catch (error) {
        logSafeDiagnostic(phase, error);
        throw error;
      }
    }

    if (action === 'list-pending-devices') {
      const result = await call('list_system_owner_pending_device_authorizations', {
        p_actor_user_id: actorUserId, p_actor_device_id: actorDeviceId,
        p_session_id: uuid(body.listingSessionId, 'LISTING_SESSION_ID'), p_environment: env,
        p_listing_token_hash: bytea(await sha256(encoder.encode(String(body.listingToken || '')))),
      });
      return json(200, { ok: true, status: 'listed', data: result });
    }

    if (action === 'get-operation-result') {
      const result = await call('get_system_owner_device_operation_result', {
        p_actor_user_id: actorUserId, p_actor_device_id: actorDeviceId,
        p_operation_id: uuid(body.operationId, 'OPERATION_ID'),
        p_target_user_id: uuid(body.targetUserId, 'TARGET_USER_ID'),
        p_target_device_id: uuid(body.targetDeviceId, 'TARGET_DEVICE_ID'),
        p_action: String(body.operationAction || ''), p_environment: env,
      });
      return json(200, { ok: true, status: result.status, data: result });
    }
    throw new Error('ACTION_NOT_SUPPORTED');
  } catch (error) {
    const code = String(error instanceof Error ? error.message : 'PLATFORM_DEVICE_AUTHORIZATION_FAILED').slice(0, 240);
    if (currentAction === 'finish-credential-enrollment') logSafeDiagnostic('credential-enrollment', error);
    return json(code === 'AUTH_REQUIRED' ? 401 : 403, { ok: false, status: 'denied', error: { code } });
  }
});
