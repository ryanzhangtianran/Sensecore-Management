import assert from "node:assert/strict";
import test from "node:test";

let acp = {};
try {
  acp = await import("./sensecore-acp.mjs");
} catch {
  // RED phase: the helper does not exist until the ACP behavior is specified.
}

test("buildListPath signs the exact documented ACP list query", () => {
  assert.equal(typeof acp.buildListPath, "function");
  assert.equal(
    acp.buildListPath({
      pageSize: 100,
      pageToken: "2",
      displayName: "demo_train",
      state: "RUNNING",
    }),
    "/compute/acp/data/v2/subscriptions/019e3826-54cb-7a0a-a5ac-da1ee381f7cd/resourceGroups/default/zones/cn-sz-01z/workspaces/olabots/trainingJobs?page_size=100&page_token=2&display_name=demo_train&state=RUNNING",
  );
});

test("buildResourceSpecsPath targets the aec2 v1 catalogue, not the acp product", () => {
  assert.equal(typeof acp.buildResourceSpecsPath, "function");
  assert.equal(
    acp.buildResourceSpecsPath(),
    "/compute/aec2/data/v1/subscriptions/019e3826-54cb-7a0a-a5ac-da1ee381f7cd/resourceGroups/default/zones/cn-sz-01a/aec2s/ola-cluster/resourceSpecs",
  );
  assert.equal(
    acp.buildResourceSpecsPath({ resourcePool: "other-pool", zone: "cn-sz-01b" }),
    "/compute/aec2/data/v1/subscriptions/019e3826-54cb-7a0a-a5ac-da1ee381f7cd/resourceGroups/default/zones/cn-sz-01b/aec2s/other-pool/resourceSpecs",
  );
});

test("validateCreatePayload accepts a resource_spec carrying only a name", () => {
  // The API rejects replicas alongside total_replicas, so the documented
  // payload must pass validation without it.
  assert.equal(
    typeof acp.validateCreatePayload({
      display_name: "demo_train",
      framework: "PYTORCH",
      roles: [{
        name: "Worker",
        resource_spec: [{ name: "N4lS.Iq.I10.8" }],
        total_replicas: 1,
        startup_script: "true",
        image_path: "registry.example/image:tag",
      }],
      resource_pool: { name: "ola-cluster" },
    }),
    "object",
  );
});

test("buildUpdatePath accepts only ACP fields supported by the API", () => {
  assert.equal(typeof acp.buildUpdatePath, "function");
  assert.equal(
    acp.buildUpdatePath("pt-example", "scheduling.priority"),
    "/compute/acp/data/v2/subscriptions/019e3826-54cb-7a0a-a5ac-da1ee381f7cd/resourceGroups/default/zones/cn-sz-01z/workspaces/olabots/trainingJobs/pt-example?update_mask=scheduling.priority",
  );
  assert.throws(
    () => acp.buildUpdatePath("pt-example", "roles"),
    /Unsupported ACP update mask: roles/,
  );
});

test("validateCreatePayload rejects an incomplete ACP training task", () => {
  assert.equal(typeof acp.validateCreatePayload, "function");
  assert.throws(
    () => acp.validateCreatePayload({ display_name: "demo_train" }),
    /missing required fields: framework, roles, resource_pool/,
  );
  assert.throws(
    () => acp.validateCreatePayload({
      display_name: "demo_train",
      framework: "PYTORCH_DDP",
      roles: [{ name: "Worker", resource_spec: [], total_replicas: 1 }],
      resource_pool: { name: "ola-cluster" },
    }),
    /Worker role requires image_path, startup_script, and resource_spec/,
  );
});

test("signedAcpRequest blocks writes without --yes before network access", async () => {
  assert.equal(typeof acp.signedAcpRequest, "function");
  let called = false;
  await assert.rejects(
    acp.signedAcpRequest({
      method: "POST",
      path: "/trainingJobs",
      body: {},
      env: {
        SENSECORE_ACCESS_KEY_ID: "example-access-key",
        SENSECORE_ACCESS_KEY_SECRET: "secret",
      },
      fetchImpl: async () => {
        called = true;
        return new Response("{}", { status: 200 });
      },
    }),
    /Refusing POST without --yes/,
  );
  assert.equal(called, false);
});

test("signedAcpRequest sends a HMAC-authenticated request to the ACP endpoint", async () => {
  assert.equal(typeof acp.signedAcpRequest, "function");
  const path = "/compute/acp/data/v2/example/trainingJobs?page_size=10&page_token=1";
  let request;
  const result = await acp.signedAcpRequest({
    method: "GET",
    path,
    env: {
      SENSECORE_ACCESS_KEY_ID: "example-access-key",
      SENSECORE_ACCESS_KEY_SECRET: "secret",
    },
    fetchImpl: async (url, init) => {
      request = { url, init };
      return new Response('{"training_jobs":[],"total_size":0}', {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    },
  });

  assert.equal(
    request.url,
    "https://aec2.cn-sz-01.qhsgaiccapi.com" + path,
  );
  assert.equal(request.init.method, "GET");
  assert.match(request.init.headers.Authorization, /^hmac accesskey="example-access-key"/);
  assert.deepEqual(result, { training_jobs: [], total_size: 0 });
});

test("helper runs when invoked through a symlinked skill directory", async () => {
  const { execFileSync } = await import("node:child_process");
  const fs = await import("node:fs");
  const os = await import("node:os");
  const path = await import("node:path");
  const { fileURLToPath } = await import("node:url");
  const dir = path.dirname(fileURLToPath(import.meta.url));
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "sensecore-link-"));
  const link = path.join(tmp, "skill");
  fs.symlinkSync(path.dirname(dir), link);
  try {
    const out = execFileSync(process.execPath, [path.join(link, "scripts", "sensecore-acp.mjs"), "--help"]);
    assert.match(String(out), /^Usage:/);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});
