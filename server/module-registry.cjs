"use strict";

const fs = require("node:fs");
const path = require("node:path");

const registryPath = path.join(__dirname, "..", "platform", "modules.json");
const idPattern = /^[a-z][a-z0-9-]*$/;
const routePattern = /^\/[a-z][a-z0-9-]*$/;
const environmentPattern = /^PLATFORM_[A-Z0-9_]+_TARGET$/;

function loadModuleRegistry() {
  const modules = JSON.parse(fs.readFileSync(registryPath, "utf8"));
  if (!Array.isArray(modules) || modules.length === 0)
    throw new Error("PLATFORM_MODULE_REGISTRY_EMPTY");
  const ids = new Set();
  const routes = new Set();
  for (const module of modules) {
    if (!module || !idPattern.test(module.id))
      throw new Error("PLATFORM_MODULE_ID_INVALID");
    if (!routePattern.test(module.routePrefix))
      throw new Error(`PLATFORM_MODULE_ROUTE_INVALID:${module.id}`);
    if (!environmentPattern.test(module.targetEnvironment))
      throw new Error(`PLATFORM_MODULE_TARGET_INVALID:${module.id}`);
    if (!String(module.permission || "").trim())
      throw new Error(`PLATFORM_MODULE_PERMISSION_REQUIRED:${module.id}`);
    if (ids.has(module.id) || routes.has(module.routePrefix))
      throw new Error(`PLATFORM_MODULE_DUPLICATE:${module.id}`);
    ids.add(module.id);
    routes.add(module.routePrefix);
  }
  return Object.freeze(
    modules
      .map((module) => Object.freeze({ ...module, navigation: { ...module.navigation } }))
      .sort((left, right) => left.navigation.order - right.navigation.order),
  );
}

function publicModule(module, available) {
  return {
    id: module.id,
    displayName: module.displayName,
    routePrefix: module.routePrefix,
    enabled: module.enabled,
    available: Boolean(available),
    navigation: module.navigation,
  };
}

module.exports = { loadModuleRegistry, publicModule };
