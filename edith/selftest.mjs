/**
 * EDITH self-test — exercises the REAL tool layer against a throwaway workspace.
 * No LLM required. Proves fs/terminal/git/build tools actually execute.
 *
 *   node selftest.mjs
 */
import os from "node:os";
import path from "node:path";
import fs from "node:fs";
import assert from "node:assert";
import { Workspace } from "./src/workspace.mjs";
import { buildRegistry } from "./src/registry.mjs";
import { classifyCommand, LEVEL } from "./src/safety.mjs";
import { capabilityCheck } from "./src/capabilities.mjs";

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "edith-selftest-"));
const ws = new Workspace(tmp);
const changes = [];
const { tools, riskOf } = buildRegistry(ws, { onChange: (c) => changes.push(c) });

let pass = 0;
const ok = (name) => { console.log(`  ✓ ${name}`); pass++; };

console.log(`EDITH self-test in ${tmp}\n`);

// 1. write + read
let r = await tools["edith.write_file"].run({ file: "src/index.js", content: "console.log('hi from edith');\n" });
assert.equal(r.action, "created"); ok("write_file creates a real file");
r = await tools["edith.read_file"].run({ file: "src/index.js" });
assert.match(r.content, /hi from edith/); ok("read_file returns real contents");

// 2. edit
r = await tools["edith.edit_file"].run({ file: "src/index.js", find: "hi from edith", replace: "hello world" });
assert.equal(r.replacements, 1);
assert.match(fs.readFileSync(path.join(tmp, "src/index.js"), "utf8"), /hello world/); ok("edit_file changes the real file");

// 3. search
r = await tools["edith.search_code"].run({ query: "hello world" });
assert.ok(r.matches.length >= 1); ok("search_code finds real matches");

// 4. run_command (real stdout + exit code)
r = await tools["edith.run_command"].run({ command: "node src/index.js" });
assert.equal(r.exitCode, 0);
assert.match(r.stdout, /hello world/); ok(`run_command executes (exit ${r.exitCode}, ${r.durationMs}ms)`);

// 5. non-zero exit is reported honestly
r = await tools["edith.run_command"].run({ command: "node -e \"process.exit(3)\"" });
assert.equal(r.exitCode, 3); assert.equal(r.ok, false); ok("run_command reports real non-zero exit codes");

// 6. workspace escape is blocked
try { await tools["edith.read_file"].run({ file: "../../../etc/passwd" }); assert.fail("should have thrown"); }
catch (e) { assert.match(e.message, /escapes the workspace/); ok("workspace escape is blocked"); }

// 7. git init + commit (real hash)
await tools["edith.write_file"].run({ file: "package.json", content: JSON.stringify({ name: "edith-test", version: "1.0.0", scripts: { build: "node -e \"console.log('built')\"", test: "node -e \"console.log('tested')\"" } }, null, 2) });
r = await tools["edith.git_init"].run({});
assert.equal(r.ok, true); ok("git_init creates a real repo");
await tools["edith.run_command"].run({ command: "git config user.email t@e.st && git config user.name test" });
r = await tools["edith.git_commit"].run({ message: "initial commit" });
assert.equal(r.ok, true); assert.match(r.hash || "", /^[0-9a-f]{7,}$/); ok(`git_commit returns a REAL hash (${r.hash})`);

// 8. detect + build + test
r = await tools["edith.detect_project"].run({});
assert.equal(r.pkg, true); ok(`detect_project reads real package.json (pm=${r.packageManager})`);
r = await tools["edith.build"].run({});
assert.equal(r.exitCode, 0); assert.match(r.stdout, /built/); ok("build runs the real build script");
r = await tools["edith.test"].run({});
assert.equal(r.exitCode, 0); assert.match(r.stdout, /tested/); ok("test runs the real test script");

// 9. safety classification
assert.equal(classifyCommand("npm test").level, LEVEL.SAFE);
assert.equal(classifyCommand("git push").level, LEVEL.REVIEW);
assert.equal(classifyCommand("rm -rf /").level, LEVEL.DANGEROUS);
assert.equal(riskOf("edith.run_command", { command: "rm -rf build" }), "dangerous");
ok("safety classifier tags SAFE/REVIEW/DANGEROUS correctly");

// 10. deploy is honestly "not connected" without creds
r = await tools["edith.deploy"].run({ provider: "vercel" });
assert.equal(r.ok, false); assert.equal(r.connected, false); ok("deploy reports 'not connected' instead of faking success");

// 11. capability check is real
const caps = capabilityCheck(ws);
assert.equal(caps.node.ok, true); ok(`capability check is real (node ${caps.node.detail})`);

// file-change tracking
assert.ok(changes.some((c) => c.kind === "created")); ok("file changes are tracked for the UI");

fs.rmSync(tmp, { recursive: true, force: true });
console.log(`\n${pass} checks passed. EDITH's tool layer is real and working.`);
