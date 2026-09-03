import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const pluginRoot = path.dirname(path.dirname(fileURLToPath(import.meta.url)));

function exchange(messages) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ["scripts/computer-cleaner.mjs", "mcp-serve"], { cwd: pluginRoot, stdio: ["pipe", "pipe", "pipe"] });
    let output = "";
    let stderr = "";
    child.stdout.setEncoding("utf8").on("data", (chunk) => { output += chunk; });
    child.stderr.setEncoding("utf8").on("data", (chunk) => { stderr += chunk; });
    child.on("error", reject);
    child.on("close", (code) => code === 0 ? resolve(output.trim().split("\n").map(JSON.parse)) : reject(new Error(stderr || `exit ${code}`)));
    child.stdin.end(messages.map((message) => JSON.stringify(message)).join("\n") + "\n");
  });
}

test("MCP server initializes and exposes the three bounded tools", async () => {
  const responses = await exchange([
    { jsonrpc: "2.0", id: 1, method: "initialize", params: {} },
    { jsonrpc: "2.0", method: "notifications/initialized" },
    { jsonrpc: "2.0", id: 2, method: "tools/list", params: {} }
  ]);
  assert.equal(responses[0].result.serverInfo.name, "computer-cleaner");
  assert.deepEqual(responses[1].result.tools.map((tool) => tool.name), ["cleaner_scan", "cleaner_clean", "cleaner_guard"]);
});

test("MCP clean refuses missing explicit confirmation", async () => {
  const [response] = await exchange([
    { jsonrpc: "2.0", id: 3, method: "tools/call", params: { name: "cleaner_clean", arguments: { roots: [pluginRoot], apply: true, confirmation: "yes" } } }
  ]);
  assert.equal(response.error.code, -32000);
  assert.match(response.error.message, /requires confirmation/);
});
