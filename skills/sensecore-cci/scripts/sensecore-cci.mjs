#!/usr/bin/env node

import fs from "node:fs/promises";
import { realpathSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { signedFetch } from "./sensecore-api.mjs";

export { buildAuthorization, requireMutationConfirmation } from "./sensecore-api.mjs";

export const PROFILE = Object.freeze({
  subscription: "019e3826-54cb-7a0a-a5ac-da1ee381f7cd",
  resourceGroup: "default",
  controlZone: "cn-sz-01z",
  eipZone: "cn-sz-01a",
  workspace: "olabots-cci",
  namespace: "olabots_swr1",
  eipName: "eip-olabots-a8bdec30",
  hosts: Object.freeze({
    cci: "https://cci.cn-sz-01.qhsgaicc.com",
    management: "https://management.cn-sz-01.qhsgaiccapi.com",
    network: "https://network.cn-sz-01.qhsgaiccapi.com",
  }),
});

function controlRoot(product) {
  return `/compute/${product}/data/v2/subscriptions/${PROFILE.subscription}`
    + `/resourceGroups/${PROFILE.resourceGroup}/zones/${PROFILE.controlZone}`
    + `/workspaces/${PROFILE.workspace}`;
}

export const PATHS = Object.freeze({
  apps: `${controlRoot("cci")}/apps`,
  app: (name) => `${controlRoot("cci")}/apps/${name}`,
  services: `${controlRoot("service")}/services`,
  service: (name) => `${controlRoot("service")}/services/${name}`,
  dnatRules: `/network/eip/data/v1/subscriptions/${PROFILE.subscription}`
    + `/resourceGroups/${PROFILE.resourceGroup}/zones/${PROFILE.eipZone}/dnatRules`,
  dnatRule: (name) => `/network/eip/data/v1/subscriptions/${PROFILE.subscription}`
    + `/resourceGroups/${PROFILE.resourceGroup}/zones/${PROFILE.eipZone}`
    + `/eips/${PROFILE.eipName}/dnatRules/${name}`,
  resources: "/rmh/v1/resources",
});

export function sanitizeServicePorts(ports = []) {
  return ports.map(({ port, target_port }) => ({ port, target_port }));
}

export function normalizeDnatProperties(properties) {
  return {
    ...properties,
    external_port: String(properties.external_port),
    internal_port: String(properties.internal_port),
  };
}

const REQUIRED_DNAT_CREATE_FIELDS = [
  "id",
  "name",
  "display_name",
  "uid",
  "resource_type",
  "creator_id",
  "owner_id",
  "tenant_id",
  "zone",
  "properties",
];

export function validateDnatCreateBody(body) {
  const missing = REQUIRED_DNAT_CREATE_FIELDS.filter((field) => {
    const value = body?.[field];
    return value === undefined || value === null || value === "";
  });
  if (missing.length > 0) {
    throw new Error(`DNAT create body missing required fields: ${missing.join(", ")}`);
  }
  return body;
}

export async function signedRequest({ service, ...request }) {
  const host = PROFILE.hosts[service];
  if (!host) throw new Error(`Unknown service: ${service}`);
  const headers = service === "cci" ? { "x-ui-valid": "x-ui-valid" } : {};
  return signedFetch({ ...request, host, headers });
}

function queryString(entries) {
  const query = new URLSearchParams(entries);
  return query.toString();
}

async function readJson(file) {
  return JSON.parse(await fs.readFile(file, "utf8"));
}

function printJson(value) {
  process.stdout.write(`${JSON.stringify(value, null, 2)}\n`);
}

function usage() {
  return `Usage:
  sensecore-cci.mjs cci list|get|start|stop|delete|create|update ...
  sensecore-cci.mjs service get|create|delete ...
  sensecore-cci.mjs storage list
  sensecore-cci.mjs dnat list|create|delete ...
  sensecore-cci.mjs request <service> <method> <path> [body.json] [--yes]

Mutating commands require --yes. Credentials come only from
SENSECORE_ACCESS_KEY_ID and SENSECORE_ACCESS_KEY_SECRET.`;
}

// Follow next_page_token until it is empty; the shared workspace already holds ~100 apps.
export async function collectPages(fetchPage, key) {
  const items = [];
  const seen = new Set();
  let token = "1";
  let last;
  while (token && !seen.has(token)) {
    seen.add(token);
    last = await fetchPage(token);
    items.push(...(last?.[key] || []));
    token = last?.next_page_token;
  }
  return { ...last, [key]: items, next_page_token: "" };
}

async function runCci(action, args) {
  if (action === "list") {
    return collectPages((token) => signedRequest({
      service: "cci",
      method: "GET",
      path: `${PATHS.apps}?${queryString({ page_size: "100", page_token: token })}`,
    }), "apps");
  }
  const name = args[0];
  if (action === "get") {
    return signedRequest({ service: "cci", method: "GET", path: PATHS.app(name) });
  }
  if (action === "start" || action === "stop") {
    return signedRequest({
      service: "cci",
      method: "POST",
      path: `${PATHS.app(name)}:${action}`,
      args,
    });
  }
  if (action === "delete") {
    try {
      await signedRequest({
        service: "cci",
        method: "DELETE",
        path: PATHS.service(name),
        args,
      });
    } catch (error) {
      if (!error.message.includes("HTTP 404")) throw error;
    }
    return signedRequest({
      service: "cci",
      method: "DELETE",
      path: PATHS.app(name),
      args,
    });
  }
  if (action === "create") {
    const payload = await readJson(args[0]);
    const app = await signedRequest({
      service: "cci",
      method: "POST",
      path: PATHS.apps,
      body: payload.app,
      args,
    });
    if (payload.service) {
      payload.service.ports = sanitizeServicePorts(payload.service.ports);
      await signedRequest({
        service: "cci",
        method: "POST",
        path: PATHS.services,
        body: payload.service,
        args,
      });
    }
    return app;
  }
  if (action === "update") {
    const payload = await readJson(args[1]);
    const maskIndex = args.indexOf("--update-mask");
    const suffix = maskIndex >= 0
      ? `?${queryString({ update_mask: args[maskIndex + 1] })}`
      : "";
    return signedRequest({
      service: "cci",
      method: "PATCH",
      path: `${PATHS.app(name)}${suffix}`,
      body: payload,
      args,
    });
  }
  throw new Error(`Unknown CCI action: ${action}`);
}

async function runService(action, args) {
  const name = args[0];
  if (action === "get") {
    return signedRequest({ service: "cci", method: "GET", path: PATHS.service(name) });
  }
  if (action === "create") {
    const body = await readJson(name);
    body.ports = sanitizeServicePorts(body.ports);
    return signedRequest({
      service: "cci", method: "POST", path: PATHS.services, body, args,
    });
  }
  if (action === "delete") {
    return signedRequest({
      service: "cci", method: "DELETE", path: PATHS.service(name), args,
    });
  }
  throw new Error(`Unknown service action: ${action}`);
}

async function runStorage(action) {
  if (action !== "list") throw new Error(`Unknown storage action: ${action}`);
  const filter = 'resource_type="storage.afs.v2.volume"';
  const query = queryString({
    filter,
    page_size: "100",
    page_token: "1",
    permission: "afs.volume.read OR afs.volume.write",
  });
  return signedRequest({
    service: "management", method: "GET", path: `${PATHS.resources}?${query}`,
  });
}

async function runDnat(action, args) {
  if (action === "list") {
    const query = queryString({
      eip_names: PROFILE.eipName,
      page_size: "500",
      page_token: "1",
    });
    return signedRequest({
      service: "network", method: "GET", path: `${PATHS.dnatRules}?${query}`,
    });
  }
  if (action === "create") {
    const body = validateDnatCreateBody(await readJson(args[0]));
    body.properties = normalizeDnatProperties(body.properties);
    return signedRequest({
      service: "network",
      method: "POST",
      path: PATHS.dnatRule(body.name),
      body,
      args,
    });
  }
  if (action === "delete") {
    return signedRequest({
      service: "network", method: "DELETE", path: PATHS.dnatRule(args[0]), args,
    });
  }
  throw new Error(`Unknown DNAT action: ${action}`);
}

export async function main(argv = process.argv.slice(2)) {
  if (argv.length < 2 || argv.includes("--help")) {
    process.stdout.write(`${usage()}\n`);
    return;
  }
  const [group, action, ...args] = argv;
  let result;
  if (group === "cci") result = await runCci(action, args);
  else if (group === "service") result = await runService(action, args);
  else if (group === "storage") result = await runStorage(action, args);
  else if (group === "dnat") result = await runDnat(action, args);
  else if (group === "request") {
    const [service, method, requestPath, bodyFile] = [action, ...args];
    const body = bodyFile && !bodyFile.startsWith("--") ? await readJson(bodyFile) : undefined;
    result = await signedRequest({
      service, method, path: requestPath, body, args: argv,
    });
  } else throw new Error(`Unknown command group: ${group}`);
  printJson(result);
}

// realpath: the skill is usually installed as a symlink, and import.meta.url is already resolved
const isMain = process.argv[1]
  && realpathSync(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  main().catch((error) => {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  });
}
