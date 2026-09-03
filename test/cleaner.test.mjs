import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { clean, CONFIRMATION, guard, scan } from "../scripts/cleaner-core.mjs";

async function fixture() {
  return fs.mkdtemp(path.join(os.tmpdir(), "computer-cleaner-test-"));
}

test("finds only marked regenerable project output", async (t) => {
  const root = await fixture();
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  await fs.writeFile(path.join(root, "Cargo.toml"), "[package]\nname='x'\nversion='0.1.0'\n");
  await fs.mkdir(path.join(root, "target", "debug"), { recursive: true });
  await fs.writeFile(path.join(root, "target", "debug", "artifact"), "generated");
  await fs.mkdir(path.join(root, "src"));
  await fs.writeFile(path.join(root, "src", "main.rs"), "fn main() {}\n");
  const result = await scan({ roots: [root] });
  assert.equal(result.candidates.length, 1);
  assert.equal(result.candidates[0].kind, "target");
  assert.ok(result.candidates[0].bytes > 0);
});

test("ignores an arbitrary target directory without Cargo marker", async (t) => {
  const root = await fixture();
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  await fs.mkdir(path.join(root, "target"));
  await fs.writeFile(path.join(root, "target", "keep.txt"), "user data");
  assert.deepEqual((await scan({ roots: [root] })).candidates, []);
});

test("dry-run never deletes candidates", async (t) => {
  const root = await fixture();
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  await fs.writeFile(path.join(root, "package.json"), "{}");
  await fs.mkdir(path.join(root, ".next"));
  await fs.writeFile(path.join(root, ".next", "generated"), "x");
  const result = await clean({ roots: [root] });
  assert.equal(result.action, "preview");
  assert.equal(await fs.readFile(path.join(root, ".next", "generated"), "utf8"), "x");
});

test("apply requires exact confirmation", async (t) => {
  const root = await fixture();
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  await fs.writeFile(path.join(root, "package.json"), "{}");
  await fs.mkdir(path.join(root, ".turbo"));
  await assert.rejects(() => clean({ roots: [root], apply: true, confirmation: "yes" }), { code: "CONFIRMATION_REQUIRED" });
  assert.equal(await fs.stat(path.join(root, ".turbo")).then(() => true), true);
});

test("confirmed clean removes only allowlisted output and writes audit", async (t) => {
  const root = await fixture();
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  await fs.writeFile(path.join(root, "package.json"), "{}");
  await fs.mkdir(path.join(root, ".parcel-cache"));
  await fs.writeFile(path.join(root, ".parcel-cache", "cache"), "cache");
  await fs.mkdir(path.join(root, "src"));
  await fs.writeFile(path.join(root, "src", "index.js"), "source");
  const auditPath = path.join(root, "audit", "actions.jsonl");
  const result = await clean({ roots: [root], apply: true, confirmation: CONFIRMATION, auditPath });
  assert.equal(result.removed.length, 1);
  await assert.rejects(() => fs.stat(path.join(root, ".parcel-cache")), { code: "ENOENT" });
  assert.equal(await fs.readFile(path.join(root, "src", "index.js"), "utf8"), "source");
  assert.match(await fs.readFile(auditPath, "utf8"), /"action":"clean"/);
});

test("symlinked candidate is ignored", async (t) => {
  const root = await fixture();
  const outside = await fixture();
  t.after(() => Promise.all([fs.rm(root, { recursive: true, force: true }), fs.rm(outside, { recursive: true, force: true })]));
  await fs.writeFile(path.join(root, "Cargo.toml"), "[package]\nname='x'\nversion='0.1.0'\n");
  await fs.symlink(outside, path.join(root, "target"));
  assert.deepEqual((await scan({ roots: [root] })).candidates, []);
});

test("low-disk guard only suggests cleanup unless explicitly confirmed", async (t) => {
  const root = await fixture();
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  await fs.writeFile(path.join(root, "package.json"), "{}");
  await fs.mkdir(path.join(root, ".next"));
  await fs.writeFile(path.join(root, ".next", "generated"), "x");
  const result = await guard({ roots: [root], minFreeGb: Number.MAX_SAFE_INTEGER });
  assert.equal(result.action, "suggest-clean");
  assert.equal(result.result.action, "preview");
  assert.equal(await fs.readFile(path.join(root, ".next", "generated"), "utf8"), "x");
});
