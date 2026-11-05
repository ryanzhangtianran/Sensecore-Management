#!/usr/bin/env node

import fs from "node:fs/promises";
import { realpathSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { signedFetch } from "./sensecore-api.mjs";

export const PROFILE = Object.freeze({
  subscription: "019e3826-54cb-7a0a-a5ac-da1ee381f7cd",
  resourceGroup: "default",
  controlZone: "cn-sz-01z",
  namespace: "olabots_swr1",
  host: "https://ccr.cn-sz-01.qhsgaiccapi.com",
  registry: "registry.cn-sz-01.qhsgaicc.com",
});

export const PATHS = Object.freeze({
  repositories: `/devtools/ccr/data/v1/subscriptions/${PROFILE.subscription}`
    + `/resourceGroups/${PROFILE.resourceGroup}/zones/${PROFILE.controlZone}`
    + `/namespaces/${PROFILE.namespace}/repositories`,
});

// Repos are named <user>-<project>, so `list <user>` matches by prefix.
export function filterRepositories(data, prefix) {
  if (!prefix) return data;
  return {
    ...data,
    repositories: (data?.repositories || []).filter((item) => item.name
      .replace(`${PROFILE.namespace}/`, "").startsWith(prefix)),
  };
}

function request(req) {
  return signedFetch({ ...req, host: PROFILE.host, label: "SenseCore CCR" });
}

function usage() {
  return `Usage:
  sensecore-ccr.mjs list [repository-prefix]
  sensecore-ccr.mjs request <method> <path> [body.json] [--yes]

Mutating requests require --yes. Credentials come only from
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
    result = filterRepositories(await request({ method: "GET", path: PATHS.repositories }), args[0]);
  } else if (action === "request") {
    const [method, requestPath, bodyFile] = args;
    const body = bodyFile && !bodyFile.startsWith("--")
      ? JSON.parse(await fs.readFile(bodyFile, "utf8"))
      : undefined;
    result = await request({ method, path: requestPath, body, args });
  } else {
    throw new Error(`Unknown CCR action: ${action}`);
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
