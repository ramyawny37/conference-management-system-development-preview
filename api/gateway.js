"use strict";

const { gatewayHandler } = require("../server/platform-gateway.cjs");

module.exports = async function vercelGateway(request, response) {
  const url = new URL(request.url, `http://${request.headers.host || "localhost"}`);
  const platformPath = url.searchParams.get("__platform_path");
  if (platformPath !== null) {
    url.searchParams.delete("__platform_path");
    const query = url.searchParams.toString();
    request.url = `${platformPath}${query ? `?${query}` : ""}`;
  }
  return gatewayHandler(request, response);
};
