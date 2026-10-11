(function (global) {
  'use strict';

  const SOURCE = 'conference_activation_authorization';

  function normalizeId(value) {
    const normalized = String(value || '').trim();
    return normalized || null;
  }

  function buildDenied(reason, conferenceId) {
    return {
      ok: false,
      active: false,
      reason: String(reason || 'canonical_access_required'),
      conferenceId: normalizeId(conferenceId),
      role: null,
      capabilities: null,
      source: SOURCE,
    };
  }

  // Local conference activation is retired. Canonical server discovery is required.
  function authorizeLocal({ conferenceId } = {}) {
    return buildDenied('canonical_access_required', conferenceId);
  }

  function authorizeCanonicalCloud({ conferenceId, canonicalAccess = false, capabilities = null } = {}) {
    const normalizedConferenceId = normalizeId(conferenceId);
    if (!normalizedConferenceId) return buildDenied('conference_missing', conferenceId);
    if (canonicalAccess !== true) {
      return buildDenied('canonical_access_required', normalizedConferenceId);
    }
    return {
      ok: true,
      active: true,
      reason: 'canonical_access_granted',
      conferenceId: normalizedConferenceId,
      role: null,
      capabilities: capabilities && typeof capabilities === 'object' ? capabilities : null,
      source: SOURCE,
    };
  }

  function authorizeCloud(input = {}) {
    return authorizeCanonicalCloud(input);
  }

  function validateCloud(input = {}) {
    return authorizeCanonicalCloud(input);
  }

  async function reconcileStartup({
    conferenceId,
    isLinked = false,
    validateCloud: validateCloudCallback = null,
    canonicalAccess = false,
    capabilities = null,
    onDeactivate = null,
  } = {}) {
    const normalizedConferenceId = normalizeId(conferenceId);
    if (!normalizedConferenceId) return buildDenied('conference_missing', conferenceId);
    // Link-store presence is not an authorization signal. Always validate canonical access.

    let decision;
    if (typeof validateCloudCallback === 'function') {
      decision = await validateCloudCallback({
        conferenceId: normalizedConferenceId,
        canonicalAccess,
        capabilities,
      });
    } else {
      decision = validateCloud({
        conferenceId: normalizedConferenceId,
        canonicalAccess,
        capabilities,
      });
    }

    if (decision && decision.ok === true && decision.active === true) {
      return {
        ...decision,
        role: null,
        source: SOURCE,
      };
    }

    if (typeof onDeactivate === 'function') {
      await onDeactivate({
        conferenceId: normalizedConferenceId,
        reason: (decision && decision.reason) || 'canonical_access_denied',
      });
    }
    return buildDenied((decision && decision.reason) || 'canonical_access_denied', normalizedConferenceId);
  }

  global.ConferenceActivationAuthorization = Object.freeze({
    authorizeLocal,
    authorizeCloud,
    validateCloud,
    reconcileStartup,
  });
})(window);
