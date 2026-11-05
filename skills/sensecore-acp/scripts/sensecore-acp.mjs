#!/usr/bin/env node

import fs from "node:fs/promises";
import { realpathSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { signedFetch } from "./sensecore-api.mjs";

export const PROFILE = Object.freeze({
  subscription: "019e3826-54cb-7a0a-a5ac-da1ee381f7cd",
  resourceGroup: "default",
  controlZone: "cn-sz-01z",
  workspace: "olabots",
  resourcePool: "ola-cluster",
  resourcePoolZone: "cn-sz-01a",
  vpcId: "019e3896-bd7d-74f4-aa7c-10284aa49b94",
  host: "https://aec2.cn-sz-01.qhsgaiccapi.com",
});

function trainingRoot() {
  return `/compute/acp/data/v2/subscriptions/${PROFILE.subscription}`
    + `/resourceGroups/${PROFILE.resourceGroup}/zones/${PROFILE.controlZone}`
    + `/workspaces/${PROFILE.workspace}/trainingJobs`;
}

export const PATHS = Object.freeze({
  trainingJobs: trainingRoot(),
  trainingJob: (name) => `${trainingRoot()}/${encodeURIComponent(name)}`,
  workers: (name) => `${trainingRoot()}/${encodeURIComponent(name)}/workers`,
  batchDelete: `${trainingRoot()}:batchDelete`,
});

// The spec catalogue is not served by the acp product: every resourceSpecs
// route under /compute/acp/... is a 404. It lives on aec2, at v1, and is keyed
// by the resource pool rather than the workspace.
export function buildResourceSpecsPath({
  resourcePool = PROFILE.resourcePool,
  zone = PROFILE.resourcePoolZone,
} = {}) {
  return `/compute/aec2/data/v1/subscriptions/${PROFILE.subscription}`
    + `/resourceGroups/${PROFILE.resourceGroup}/zones/${zone}`
    + `/aec2s/${encodeURIComponent(resourcePool)}/resourceSpecs`;
}

function queryString(entries) {
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(entries)) {
    if (value !== undefined && value !== null && value !== "") {
      query.set(key, String(value));
    }
  }
  return query.toString();
}

export function buildListPath({
  pageSize = 100,
  pageToken = "1",
  displayName,
  state,
} = {}) {
  const query = queryString({
    page_size: pageSize,
    page_token: pageToken,
    display_name: displayName,
    state,
  });
  return `${PATHS.trainingJobs}?${query}`;
}

export function buildWorkersPath(name, { pageSize = 100, pageToken = "1" } = {}) {
  const query = queryString({ page_size: pageSize, page_token: pageToken });
  return `${PATHS.workers(name)}?${query}`;
}

const SUPPORTED_UPDATE_MASKS = new Set(["display_name", "scheduling.priority"]);

export function buildUpdatePath(name, updateMask) {
  if (!SUPPORTED_UPDATE_MASKS.has(updateMask)) {
    throw new Error(`Unsupported ACP update mask: ${updateMask}`);
  }
  return `${PATHS.trainingJob(name)}?${queryString({ update_mask: updateMask })}`;
}

export function validateCreatePayload(body) {
  const required = ["display_name", "framework", "roles", "resource_pool"];
  const missing = required.filter((field) => {
    const value = body?.[field];
    return value === undefined || value === null || value === ""
      || (Array.isArray(value) && value.length === 0);
  });
  if (missing.length > 0) {
    throw new Error(`ACP create payload missing required fields: ${missing.join(", ")}`);
  }

  if (!Array.isArray(body.roles) || body.roles.length !== 1) {
    throw new Error("ACP create payload requires exactly one Worker role");
  }
  const worker = body.roles[0];
  if (worker.name !== "Worker") {
    throw new Error("ACP role name must be Worker");
  }
  if (!worker.image_path || !worker.startup_script
    || !Array.isArray(worker.resource_spec) || worker.resource_spec.length === 0) {
    throw new Error("Worker role requires image_path, startup_script, and resource_spec");
  }
  if (!Number.isInteger(worker.total_replicas) || worker.total_replicas < 1) {
    throw new Error("Worker total_replicas must be a positive integer");
  }
  if (worker.resource_spec.some((spec) => !spec.name)) {
    throw new Error("Every ACP resource_spec requires a name");
  }
  if (!body.resource_pool.name) {
    throw new Error("ACP resource_pool requires a name");
  }
  return body;
}

export function signedAcpRequest(request) {
  return signedFetch({
    ...request, host: PROFILE.host, headers: { Accept: "application/json" }, label: "SenseCore ACP",
  });
}

async function readJson(file) {
  if (!file || file.startsWith("--")) throw new Error("A JSON payload file is required");
  return JSON.parse(await fs.readFile(file, "utf8"));
}

function option(args, name, fallback) {
  const index = args.indexOf(name);
  if (index < 0) return fallback;
  if (!args[index + 1] || args[index + 1].startsWith("--")) {
    throw new Error(`${name} requires a value`);
  }
  return args[index + 1];
}

function usage() {
  return `Usage:
  sensecore-acp.mjs list [--page-size N] [--page-token N] [--display-name NAME] [--state STATE]
  sensecore-acp.mjs specs [--resource-pool NAME] [--zone ZONE]
  sensecore-acp.mjs get <training-job-name>
  sensecore-acp.mjs workers <training-job-name> [--page-size N] [--page-token N]
  sensecore-acp.mjs create <body.json> --yes
  sensecore-acp.mjs update <training-job-name> <body.json> --update-mask <field> --yes
  sensecore-acp.mjs delete <training-job-name> [more-names...] --yes

Mutating commands require --yes. Credentials come only from
SENSECORE_ACCESS_KEY_ID and SENSECORE_ACCESS_KEY_SECRET.`;
}

export async function main(argv = process.argv.slice(2)) {
  if (argv.length === 0 || argv.includes("--help")) {
    process.stdout.write(`${usage()}\n`);
    return;
  }

  const [action, ...args] = argv;
  let result;
  if (action === "list") {
    result = await signedAcpRequest({
      method: "GET",
      path: buildListPath({
        pageSize: option(args, "--page-size", 100),
        pageToken: option(args, "--page-token", "1"),
        displayName: option(args, "--display-name"),
        state: option(args, "--state"),
      }),
    });
  } else if (action === "specs") {
    result = await signedAcpRequest({
      method: "GET",
      path: buildResourceSpecsPath({
        resourcePool: option(args, "--resource-pool", PROFILE.resourcePool),
        zone: option(args, "--zone", PROFILE.resourcePoolZone),
      }),
    });
  } else if (action === "get") {
    result = await signedAcpRequest({ method: "GET", path: PATHS.trainingJob(args[0]) });
  } else if (action === "workers") {
    result = await signedAcpRequest({
      method: "GET",
      path: buildWorkersPath(args[0], {
        pageSize: option(args, "--page-size", 100),
        pageToken: option(args, "--page-token", "1"),
      }),
    });
  } else if (action === "create") {
    const body = validateCreatePayload(await readJson(args[0]));
    result = await signedAcpRequest({
      method: "POST", path: PATHS.trainingJobs, body, args,
    });
  } else if (action === "update") {
    const body = await readJson(args[1]);
    result = await signedAcpRequest({
      method: "PATCH",
      path: buildUpdatePath(args[0], option(args, "--update-mask")),
      body,
      args,
    });
  } else if (action === "delete") {
    const names = args.filter((value) => !value.startsWith("--"));
    if (names.length === 0) throw new Error("At least one ACP task name is required");
    result = await signedAcpRequest({
      method: "POST",
      path: PATHS.batchDelete,
      body: {
        subscription_name: PROFILE.subscription,
        resource_group_name: PROFILE.resourceGroup,
        zone: PROFILE.controlZone,
        workspace_name: PROFILE.workspace,
        training_job_names: names,
      },
      args,
    });
  } else {
    throw new Error(`Unknown ACP action: ${action}`);
  }

  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
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
