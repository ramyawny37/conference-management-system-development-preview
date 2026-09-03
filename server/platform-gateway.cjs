"use strict";

const crypto = require("node:crypto");
const fs = require("node:fs");
const http = require("node:http");
const https = require("node:https");
const path = require("node:path");
const { createServerClient } = require("@supabase/ssr");
const { loadModuleRegistry, publicModule } = require("./module-registry.cjs");

const ROOT = path.resolve(__dirname, "..");
const DEVELOPMENT_REF = "gppwltrifgfxrkzvvxoe";
const DEVELOPMENT_URL = `https://${DEVELOPMENT_REF}.supabase.co`;
const DEVICE_ID_COOKIE = "platform-device-id";
const DEVICE_SECRET_COOKIE = "platform-device-secret";
const DEVICE_HANDOFF_PURPOSE = "PLATFORM_DEVICE_OWNERSHIP_HANDOFF";
const DEVICE_HANDOFF_DEVICE_ID = "f9306733-612d-433f-a38e-5d72855c2fe3";
const DEVICE_HANDOFF_RETURN = "https://ramyawny37.github.io/conference-management-system-v1/platform-device-ownership-handoff.html";
const registry = loadModuleRegistry();
const port = Number(process.env.PORT || 3000);

if (process.env.SUPABASE_PROJECT_REF && process.env.SUPABASE_PROJECT_REF !== DEVELOPMENT_REF)
  throw new Error("PLATFORM_DEVELOPMENT_SUPABASE_REQUIRED");
if (process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.NEXT_PUBLIC_SUPABASE_URL !== DEVELOPMENT_URL)
  throw new Error("PLATFORM_DEVELOPMENT_SUPABASE_REQUIRED");

function parseCookies(header = "") {
  return Object.fromEntries(
    header.split(";").map((item) => item.trim()).filter(Boolean).map((item) => {
      const separator = item.indexOf("=");
      return [decodeURIComponent(item.slice(0, separator)), decodeURIComponent(item.slice(separator + 1))];
    }),
  );
}

function appendCookie(response, value) {
  const current = response.getHeader("set-cookie") || [];
  response.setHeader("set-cookie", [...(Array.isArray(current) ? current : [current]), value]);
}

function serializeCookie(name, value, options = {}) {
  const attributes = [`${encodeURIComponent(name)}=${encodeURIComponent(value)}`, "Path=/", "SameSite=Lax"];
  if (options.httpOnly !== false) attributes.push("HttpOnly");
  if (process.env.NODE_ENV === "production") attributes.push("Secure");
  if (options.maxAge !== undefined) attributes.push(`Max-Age=${options.maxAge}`);
  return attributes.join("; ");
}

function json(response, status, body) {
  response.writeHead(status, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" });
  response.end(JSON.stringify(body));
}

async function readJson(request) {
  let body = "";
  for await (const chunk of request) {
    body += chunk;
    if (body.length > 32_768) throw new Error("REQUEST_TOO_LARGE");
  }
  return body ? JSON.parse(body) : {};
}

function supabaseFor(request, response, device, writeCookies) {
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY;
  if (!key) return null;
  const requestCookies = parseCookies(request.headers.cookie);
  return createServerClient(DEVELOPMENT_URL, key, {
    global: device ? { headers: { "x-platform-device-id": device.id, "x-platform-device-secret": device.secret } } : undefined,
    cookies: {
      getAll: () => Object.entries(requestCookies).map(([name, value]) => ({ name, value })),
      setAll: (values) => (writeCookies || ((cookies) => cookies.forEach(({ name, value, options }) => appendCookie(response, serializeCookie(name, value, options)))))(values),
    },
  });
}

function getDevice(request) {
  const cookies = parseCookies(request.headers.cookie);
  const id = cookies[DEVICE_ID_COOKIE];
  const secret = cookies[DEVICE_SECRET_COOKIE];
  return /^[0-9a-f-]{36}$/i.test(id || "") && /^[A-Za-z0-9_-]{43}$/.test(secret || "") ? { id, secret } : null;
}

function createDevice() {
  return { id: crypto.randomUUID(), secret: crypto.randomBytes(32).toString("base64url") };
}

function commitDevice(response, device) {
  const options = { maxAge: 31_536_000 };
  appendCookie(response, serializeCookie(DEVICE_ID_COOKIE, device.id, options));
  appendCookie(response, serializeCookie(DEVICE_SECRET_COOKIE, device.secret, options));
}

function issueDevice(response) {
  const device = createDevice();
  commitDevice(response, device);
  return device;
}

function isUuid(value) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(String(value || ""));
}

function base64url(value) {
  return Buffer.from(value).toString("base64url");
}

function issueHandoffAssertion(claims) {
  const secret = String(process.env.PLATFORM_HANDOFF_ASSERTION_SECRET || "");
  const issuer = String(process.env.PLATFORM_HANDOFF_ASSERTION_ISSUER || "");
  const audience = String(process.env.PLATFORM_HANDOFF_ASSERTION_AUDIENCE || "");
  if (secret.length < 32 || !issuer || !audience) throw new Error("PLATFORM_HANDOFF_SIGNING_AUTHORITY_UNAVAILABLE");
  const now = Math.floor(Date.now() / 1000);
  const payload = {
    iss: issuer, aud: audience, purpose: DEVICE_HANDOFF_PURPOSE,
    user_id: claims.userId, device_id: claims.deviceId, authorization_id: claims.authorizationId,
    public_key_thumbprint: claims.publicKeyThumbprint, challenge_id: claims.challengeId,
    signing_payload_hash: crypto.createHash("sha256").update(String(claims.signingPayload || "")).digest("hex"),
    jti: crypto.randomUUID(), iat: now, exp: now + 90,
  };
  const encoded = `${base64url(JSON.stringify({ alg: "HS256", typ: "JWT" }))}.${base64url(JSON.stringify(payload))}`;
  return `${encoded}.${crypto.createHmac("sha256", secret).update(encoded).digest("base64url")}`;
}

async function platformAdministrationClient(request, response, options = {}) {
  const resolveGetDevice = options.getDevice || getDevice;
  const resolveSupabaseFor = options.supabaseFor || supabaseFor;
  const device = resolveGetDevice(request);
  if (!device) return { error: "PLATFORM_APPROVED_DEVICE_REQUIRED", status: 403 };
  const supabase = resolveSupabaseFor(request, response, device);
  if (!supabase) return { error: "PLATFORM_SUPABASE_NOT_CONFIGURED", status: 503 };
  const { data, error } = await supabase.auth.getUser();
  if (error || !data.user) return { error: "PLATFORM_AUTHENTICATION_REQUIRED", status: 401 };
  return { device, supabase, user: data.user };
}

async function moduleAccessFor(supabase, device, moduleKey, permissionKey, knownContext) {
  const contextResult = knownContext ? { data: knownContext, error: null }
    : await supabase.schema("platform").rpc("get_my_access_context", {
      p_domain: "platform", p_scope_type: "platform", p_scope_id: null,
    });
  const context = contextResult.data;
  if (contextResult.error || !context || context.accountStatus !== "approved" ||
      context.deviceStatus !== "approved" || context.deviceLifecycle !== "active")
    return { allowed: false, context, error: contextResult.error || { code: "PLATFORM_APPROVED_DEVICE_REQUIRED" } };
  if (Array.isArray(context.roles) && context.roles.includes("platform_owner"))
    return { allowed: true, context, authority: "platform_owner" };
  const permissions = Array.isArray(context.permissions) ? context.permissions : [];
  const allowed = permissions.includes(permissionKey) ||
    (permissionKey === "module.access" && permissions.includes("module.manage"));
  return { allowed, context, authority: allowed ? "module_grant" : null };
}

async function sessionContext(request, response, options = {}) {
  const resolveGetDevice = options.getDevice || getDevice;
  const resolveSupabaseFor = options.supabaseFor || supabaseFor;
  const device = resolveGetDevice(request);
  const supabase = resolveSupabaseFor(request, response, device);
  if (!supabase) return { configured: false, authenticated: false, modules: [] };
  const { data } = await supabase.auth.getUser();
  if (!data.user) return { configured: true, authenticated: false, modules: [] };
  if (!device) return { configured: true, authenticated: true, deviceStatus: "missing", modules: [] };
  const { data: authorization, error: authorizationError } = await supabase.schema("platform").rpc("get_my_access_context", {
    p_domain: "platform",
    p_scope_type: "platform",
    p_scope_id: null,
  });
  if (authorizationError || !authorization) throw new Error("PLATFORM_ACCESS_CONTEXT_UNAVAILABLE");
  const accountStatus = authorization?.accountStatus || "pending";
  const deviceStatus = authorization?.deviceStatus || "missing";
  const authorized = accountStatus === "approved" && deviceStatus === "approved";
  const modules = [];
  for (const module of registry) {
    let allowed = false;
    if (authorized && module.enabled) {
      allowed = (await moduleAccessFor(supabase, device, module.id, module.permission, authorization)).allowed;
    }
    modules.push(publicModule(module, allowed));
  }
  return { configured: true, authenticated: true, user: { id: data.user.id, email: data.user.email }, accountStatus, deviceStatus, deviceId: device.id, modules };
}

function createApiHandler(options = {}) {
  const resolveSupabaseFor = options.supabaseFor || supabaseFor;
  const resolveGetDevice = options.getDevice || getDevice;
  const resolveCreateDevice = options.createDevice || createDevice;
  const resolveCommitDevice = options.commitDevice || commitDevice;
  const resolveReadJson = options.readJson || readJson;
  const resolveAdministrationClient = options.platformAdministrationClient || ((request, response) => platformAdministrationClient(request, response, {
    getDevice: resolveGetDevice,
    supabaseFor: resolveSupabaseFor,
  }));
  const resolveSessionContext = options.sessionContext || ((request, response) => sessionContext(request, response, {
    getDevice: resolveGetDevice,
    supabaseFor: resolveSupabaseFor,
  }));
  return async function handleApi(request, response, pathname) {
  if (request.method === "GET" && pathname === "/api/platform/context")
    return json(response, 200, await resolveSessionContext(request, response));
  if (request.method === "GET" && pathname === "/api/platform/device-ownership-handoff/authorize") {
    const administration = await resolveAdministrationClient(request, response);
    if (administration.error) return json(response, administration.status, { error: { code: administration.error } });
    if (administration.device.id !== DEVICE_HANDOFF_DEVICE_ID)
      return json(response, 403, { error: { code: "DEVICE_HANDOFF_CANONICAL_DEVICE_MISMATCH" } });
    const input = new URL(request.url, `https://${request.headers.host || "localhost"}`);
    const thumbprint = String(input.searchParams.get("thumbprint") || "");
    if (!/^[0-9a-f]{64}$/.test(thumbprint)) return json(response, 400, { error: { code: "DEVICE_HANDOFF_THUMBPRINT_INVALID" } });
    const result = await administration.supabase.schema("platform").rpc("begin_current_device_ownership_handoff", {
      p_public_key_thumbprint: thumbprint,
    });
    if (result.error || !result.data) return json(response, 403, { error: { code: "DEVICE_HANDOFF_BEGIN_DENIED" } });
    try {
      const claims = result.data;
      if (claims.deviceId !== administration.device.id || claims.publicKeyThumbprint !== thumbprint)
        throw new Error("DEVICE_HANDOFF_ASSERTION_DENIED");
      const transition = base64url(JSON.stringify({ assertion: issueHandoffAssertion(claims), challenge: claims }));
      response.writeHead(302, { location: `${DEVICE_HANDOFF_RETURN}#handoff=${transition}`,
        "cache-control": "no-store", "referrer-policy": "no-referrer" });
      return response.end();
    } catch (error) {
      return json(response, 403, { error: { code: String(error && error.message || "DEVICE_HANDOFF_ASSERTION_DENIED").slice(0, 160) } });
    }
  }
  if (pathname === "/api/platform/conference-rpc" ||
      pathname === "/api/platform/device-authorizations/pending" ||
      pathname === "/api/platform/device-authorizations/approve")
    return json(response, 410, { error: "PLATFORM_PRIVILEGED_GATEWAY_RETIRED" });
  if (request.method === "POST" && pathname === "/api/platform/session/adopt") {
    const body = await resolveReadJson(request);
    const pendingCookies = [];
    const deferCookies = (values) => pendingCookies.push(...values);
    const supabase = resolveSupabaseFor(request, response, null, deferCookies);
    if (!supabase) return json(response, 503, { error: "PLATFORM_SUPABASE_NOT_CONFIGURED", category: "unexpected" });
    const result = await supabase.auth.setSession({ access_token: String(body.accessToken || ""), refresh_token: String(body.refreshToken || "") });
    const currentSession = result.data && result.data.session;
    if (result.error || !result.data.user || !currentSession || !currentSession.access_token || !currentSession.refresh_token)
      return json(response, 401, { error: "PLATFORM_SESSION_INVALID", category: "authentication" });
    const existingDevice = resolveGetDevice(request);
    const device = existingDevice || resolveCreateDevice();
    const deviceClient = resolveSupabaseFor(request, response, device, deferCookies);
    if (!deviceClient) return json(response, 503, { error: "PLATFORM_SUPABASE_NOT_CONFIGURED", category: "unexpected" });
    const deviceAuthentication = await deviceClient.auth.setSession({
      access_token: currentSession.access_token,
      refresh_token: currentSession.refresh_token,
    });
    if (deviceAuthentication.error || !deviceAuthentication.data || !deviceAuthentication.data.user)
      return json(response, 401, { error: "PLATFORM_SESSION_INVALID", category: "authentication" });
    const registration = await deviceClient.schema("platform").rpc("register_current_device", {
      p_display_name: "Integrated Platform browser",
      p_platform: null,
      p_browser: String(request.headers["user-agent"] || "").slice(0, 120) || null,
    });
    if (registration.error)
      return json(response, 403, { error: "PLATFORM_DEVICE_REGISTRATION_FAILED", category: "device" });
    pendingCookies.forEach(({ name, value, options: cookieOptions }) => appendCookie(response, serializeCookie(name, value, cookieOptions)));
    if (!existingDevice) resolveCommitDevice(response, device);
    return json(response, 200, { authenticated: true, deviceId: device.id });
  }
  if (request.method === "POST" && pathname === "/api/platform/session/logout") {
    const supabase = supabaseFor(request, response, getDevice(request));
    if (supabase) await supabase.auth.signOut();
    return json(response, 200, { authenticated: false });
  }
  return json(response, 404, { error: "PLATFORM_API_NOT_FOUND" });
  };
}

const handleApi = createApiHandler();

function contentType(filePath) {
  return ({ ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8", ".json": "application/json; charset=utf-8", ".png": "image/png", ".jpg": "image/jpeg", ".svg": "image/svg+xml" })[path.extname(filePath)] || "application/octet-stream";
}

function serveLocal(request, response, pathname) {
  const requested = pathname === "/" || pathname === "/conference" || pathname === "/conference/" ? "index.html"
    : pathname === "/platform/device-admin" || pathname === "/platform/device-admin/" ? "platform-device-admin.html"
      : pathname === "/platform/device-ownership-handoff" || pathname === "/platform/device-ownership-handoff/" ? "platform-device-ownership-handoff.html"
      : pathname.replace(/^\/conference\//, "").replace(/^\//, "");
  const filePath = path.resolve(ROOT, requested);
  if (!filePath.startsWith(`${ROOT}${path.sep}`) || !fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) return false;
  const publicHost = String(request.headers["x-forwarded-host"] || request.headers.host || "");
  if (requested === "index.html" && publicHost.startsWith("integrated-platform-development")) {
    const html = fs.readFileSync(filePath, "utf8").replace('<link rel="manifest" href="./manifest.json">', "");
    response.writeHead(200, { "content-type": contentType(filePath), "cache-control": "no-store" });
    response.end(html);
    return true;
  }
  response.writeHead(200, { "content-type": contentType(filePath) });
  fs.createReadStream(filePath).pipe(response);
  return true;
}

function normalizeLocation(value, destination) {
  if (!value) return value;
  try {
    const location = new URL(value, destination);
    if (location.origin !== destination.origin) return value;
    return `${location.pathname}${location.search}${location.hash}`;
  } catch {
    return value;
  }
}

function normalizeSetCookie(value) {
  if (!value) return value;
  const cookies = Array.isArray(value) ? value : [value];
  return cookies.map((cookie) => cookie.replace(/;\s*Domain=[^;]*/gi, ""));
}

function normalizeProxyHeaders(headers, destination) {
  const normalized = { ...headers };
  delete normalized["x-vercel-protection-bypass"];
  delete normalized["x-vercel-set-bypass-cookie"];
  if (normalized.location) normalized.location = normalizeLocation(normalized.location, destination);
  if (normalized["set-cookie"]) normalized["set-cookie"] = normalizeSetCookie(normalized["set-cookie"]);
  return normalized;
}

function proxyRequest(request, response, module, target) {
  const destination = new URL(target);
  const transport = destination.protocol === "https:" ? https : http;
  const bypassEnvironment = module.targetEnvironment.replace(/_TARGET$/, "_PROTECTION_BYPASS");
  const bypass = process.env[bypassEnvironment];
  const headers = { ...request.headers };
  delete headers["x-vercel-protection-bypass"];
  headers["x-vercel-protection-bypass"] = bypass;
  return new Promise((resolve) => {
    const outgoing = transport.request({
      protocol: destination.protocol,
      hostname: destination.hostname,
      port: destination.port,
      method: request.method,
      path: request.url,
      headers: { ...headers, host: destination.host, "x-forwarded-host": request.headers.host || "", "x-platform-module": module.id },
    }, (proxied) => {
      response.writeHead(proxied.statusCode || 502, normalizeProxyHeaders(proxied.headers, destination));
      proxied.on("end", resolve);
      proxied.pipe(response);
    });
    outgoing.on("error", () => {
      json(response, 502, { error: "PLATFORM_MODULE_UNAVAILABLE", module: module.id });
      resolve();
    });
    request.pipe(outgoing);
  });
}

function createGatewayHandler(options = {}) {
  const resolveSessionContext = options.sessionContext || sessionContext;
  const resolveApi = options.handleApi || handleApi;
  const resolveProxy = options.proxyRequest || proxyRequest;
  return async function gatewayHandler(request, response) {
    try {
      const pathname = new URL(request.url, `http://${request.headers.host || "localhost"}`).pathname;
      if (pathname.startsWith("/api/platform/")) return await resolveApi(request, response, pathname);
      const module = registry.find((item) => pathname === item.routePrefix || pathname.startsWith(`${item.routePrefix}/`));
      if (module) {
        const context = await resolveSessionContext(request, response);
        const access = context.modules?.find((item) => item.id === module.id);
        if (!context.authenticated) return response.writeHead(302, { location: "/?platformLogin=required" }).end();
        if (!access?.available) return json(response, 403, { error: "PLATFORM_MODULE_ACCESS_DENIED", module: module.id });
        if (module.runtime === "local-static") {
          if (!serveLocal(request, response, pathname)) json(response, 404, { error: "PLATFORM_ROUTE_NOT_FOUND" });
          return;
        }
        const target = process.env[module.targetEnvironment];
        if (!target) return json(response, 503, { error: "PLATFORM_MODULE_TARGET_NOT_CONFIGURED", module: module.id });
        const bypassEnvironment = module.targetEnvironment.replace(/_TARGET$/, "_PROTECTION_BYPASS");
        if (!process.env[bypassEnvironment]) return json(response, 503, { error: "PLATFORM_MODULE_PROTECTION_BYPASS_NOT_CONFIGURED", module: module.id });
        return await resolveProxy(request, response, module, target);
      }
      if (!serveLocal(request, response, pathname)) json(response, 404, { error: "PLATFORM_ROUTE_NOT_FOUND" });
    } catch (error) {
      json(response, 500, { error: "PLATFORM_GATEWAY_FAILURE", category: "unexpected" });
    }
  };
}

const gatewayHandler = createGatewayHandler();
const server = http.createServer(gatewayHandler);

if (require.main === module) server.listen(port, () => process.stdout.write(`Integrated Platform Development gateway listening on ${port}\n`));

module.exports = {
  server,
  gatewayHandler,
  createGatewayHandler,
  createApiHandler,
  proxyRequest,
  normalizeLocation,
  normalizeSetCookie,
  issueDevice,
  DEVELOPMENT_REF,
  DEVICE_ID_COOKIE,
  DEVICE_SECRET_COOKIE,
  moduleAccessFor,
  issueHandoffAssertion,
};
