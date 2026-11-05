import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { filterRepositories, main } from "./sensecore-ccr.mjs";

test("filterRepositories matches <user>- prefixes after the namespace", () => {
  const data = { repositories: [
    { name: "olabots_swr1/tianran-loongforge" },
    { name: "olabots_swr1/junjie-flora" },
  ] };
  assert.deepEqual(filterRepositories(data, "tianran").repositories.map((r) => r.name),
    ["olabots_swr1/tianran-loongforge"]);
  assert.equal(filterRepositories(data, undefined), data);
});

test("request refuses writes without --yes before network access", async () => {
  await assert.rejects(main(["request", "DELETE", "/x"]), /Refusing DELETE without --yes/);
});

test("helper runs when invoked through a symlinked skill directory", () => {
  const dir = path.dirname(fileURLToPath(import.meta.url));
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "sensecore-link-"));
  const link = path.join(tmp, "skill");
  fs.symlinkSync(path.dirname(dir), link);
  try {
    const out = execFileSync(process.execPath, [path.join(link, "scripts", "sensecore-ccr.mjs"), "--help"]);
    assert.match(String(out), /^Usage:/);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});
