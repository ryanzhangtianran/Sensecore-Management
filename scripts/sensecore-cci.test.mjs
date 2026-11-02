import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  buildAuthorization,
  collectPages,
  normalizeDnatProperties,
  requireMutationConfirmation,
  sanitizeServicePorts,
  validateDnatCreateBody,
} from "./sensecore-cci.mjs";

test("buildAuthorization matches the official SenseCore signing example", () => {
  const result = buildAuthorization({
    accessKeyId: "example-access-key",
    secretAccessKey: "secret",
    method: "GET",
    path: "/requests",
    date: "Thu, 22 Jun 2017 17:15:21 GMT",
  });

  assert.equal(
    result.stringToSign,
    "x-date: Thu, 22 Jun 2017 17:15:21 GMT\nGET /requests HTTP/1.1",
  );
  assert.equal(
    result.signature,
    "IXlgb2baHcvPrV7a/C+hKS+E5oHIQXXyz4k4maWws50=",
  );
  assert.equal(
    result.authorization,
    'hmac accesskey="example-access-key", algorithm="hmac-sha256", headers="x-date request-line", signature="IXlgb2baHcvPrV7a/C+hKS+E5oHIQXXyz4k4maWws50="',
  );
});

test("buildAuthorization signs the exact path including its query string", () => {
  const path = "/resources?page_size=100&page_token=1";
  const result = buildAuthorization({
    accessKeyId: "ak",
    secretAccessKey: "sk",
    method: "GET",
    path,
    date: "Mon, 18 Aug 2026 00:00:00 GMT",
  });

  assert.match(result.stringToSign, /GET \/resources\?page_size=100&page_token=1 HTTP\/1\.1$/);
});

test("requireMutationConfirmation rejects writes without --yes", () => {
  assert.throws(
    () => requireMutationConfirmation("POST", []),
    /Refusing POST without --yes/,
  );
  assert.doesNotThrow(() => requireMutationConfirmation("GET", []));
  assert.doesNotThrow(() => requireMutationConfirmation("DELETE", ["--yes"]));
});

test("sanitizeServicePorts strips server-generated names from create payloads", () => {
  assert.deepEqual(
    sanitizeServicePorts([
      { name: "881e9552-c36f-4974-bd2e-39322d42db58", port: 22, target_port: 22 },
      { name: "http", port: 8000, target_port: 8000 },
    ]),
    [
      { port: 22, target_port: 22 },
      { port: 8000, target_port: 8000 },
    ],
  );
});

test("normalizeDnatProperties serializes API port fields as strings", () => {
  assert.deepEqual(
    normalizeDnatProperties({
      external_port: 22224,
      internal_port: 22,
      internal_instance_type: "CCI_DEPLOYMENT_SERVICE",
      internal_instance_name: "service-uid",
    }),
    {
      external_port: "22224",
      internal_port: "22",
      internal_instance_type: "CCI_DEPLOYMENT_SERVICE",
      internal_instance_name: "service-uid",
    },
  );
});

test("validateDnatCreateBody rejects payloads missing full resource metadata", () => {
  assert.throws(
    () => validateDnatCreateBody({
      name: "dnat-olabots-example",
      properties: { external_port: "22224", internal_port: "22" },
    }),
    /missing required fields: id, display_name, uid, resource_type, creator_id, owner_id, tenant_id, zone/,
  );
});

test("collectPages follows next_page_token and stops on a repeated token", async () => {
  const pages = {
    1: { apps: [{ name: "a" }], next_page_token: "2", total_size: 3 },
    2: { apps: [{ name: "b" }, { name: "c" }], next_page_token: "" },
  };
  const seen = [];
  const all = await collectPages(async (t) => { seen.push(t); return pages[t]; }, "apps");
  assert.deepEqual(seen, ["1", "2"]);
  assert.deepEqual(all.apps.map((a) => a.name), ["a", "b", "c"]);

  let calls = 0;
  await collectPages(async () => { calls += 1; return { apps: [], next_page_token: "1" }; }, "apps");
  assert.equal(calls, 1);
});

test("both helpers run when invoked through a symlinked skill directory", () => {
  const dir = path.dirname(fileURLToPath(import.meta.url));
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "sensecore-link-"));
  const link = path.join(tmp, "skill");
  fs.symlinkSync(path.dirname(dir), link);
  try {
    for (const script of ["sensecore-cci.mjs", "sensecore-acp.mjs"]) {
      const out = execFileSync(process.execPath, [path.join(link, "scripts", script), "--help"]);
      assert.match(String(out), /^Usage:/, script);
    }
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});
