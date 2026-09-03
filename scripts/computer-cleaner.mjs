#!/usr/bin/env node
import { pathToFileURL } from "node:url";
import { clean, CONFIRMATION, diskStatus, guard, scan } from "./cleaner-core.mjs";

function parse(argv) {
  const command = argv.shift() ?? "help";
  const options = { roots: [] };
  while (argv.length) {
    const value = argv.shift();
    if (value === "--json") options.json = true;
    else if (value === "--apply") options.apply = true;
    else if (value === "--confirm") options.confirmation = argv.shift();
    else if (value === "--min-free-gb") options.minFreeGb = Number(argv.shift());
    else if (value === "--audit-log") options.auditPath = argv.shift();
    else if (value?.startsWith("-")) throw new Error(`Unknown option: ${value}`);
    else options.roots.push(value);
  }
  if (!options.roots.length) options.roots = [process.cwd()];
  return { command, options };
}

function human(bytes) {
  const units = ["B", "KiB", "MiB", "GiB", "TiB"];
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) { value /= 1024; unit += 1; }
  return `${value.toFixed(unit ? 1 : 0)} ${units[unit]}`;
}

function present(result, json = false) {
  if (json) return console.log(JSON.stringify(result, null, 2));
  if (result.candidates) {
    for (const item of result.candidates) console.log(`${human(item.bytes)}\t${item.path}\t${item.reason}`);
    console.log(`Total reclaimable: ${human(result.totalBytes)} (${result.candidates.length} paths)`);
  } else if (result.removed) {
    for (const item of result.removed) console.log(`removed\t${human(item.bytes)}\t${item.path}`);
    console.log(`Reclaimed: ${human(result.reclaimedBytes)}; audit: ${result.auditLog}`);
  } else console.log(JSON.stringify(result, null, 2));
  if (result.message) console.log(result.message);
  if (result.errors?.length) console.error(JSON.stringify(result.errors, null, 2));
}

const TOOL_DEFINITIONS = [
  { name: "cleaner_scan", description: "Dry-run scan of strictly allowlisted regenerable caches/build output.", inputSchema: { type: "object", properties: { roots: { type: "array", items: { type: "string" } } } } },
  { name: "cleaner_clean", description: `Clean allowlisted results. Requires apply=true and confirmation=${CONFIRMATION}.`, inputSchema: { type: "object", properties: { roots: { type: "array", items: { type: "string" } }, apply: { type: "boolean" }, confirmation: { type: "string" } }, required: ["apply", "confirmation"] } },
  { name: "cleaner_guard", description: "Check free disk threshold and preview or explicitly trigger restricted cleanup.", inputSchema: { type: "object", properties: { roots: { type: "array", items: { type: "string" } }, minFreeGb: { type: "number" }, apply: { type: "boolean" }, confirmation: { type: "string" } } } }
];

async function callTool(name, args = {}) {
  if (name === "cleaner_scan") return scan(args);
  if (name === "cleaner_clean") return clean(args);
  if (name === "cleaner_guard") return guard(args);
  throw Object.assign(new Error(`Unknown tool: ${name}`), { code: "METHOD_NOT_FOUND" });
}

async function mcpServe() {
  process.stdin.setEncoding("utf8");
  let buffer = "";
  for await (const chunk of process.stdin) {
    buffer += chunk;
    let newline;
    while ((newline = buffer.indexOf("\n")) >= 0) {
      const line = buffer.slice(0, newline).trim();
      buffer = buffer.slice(newline + 1);
      if (!line) continue;
      let request;
      try {
        request = JSON.parse(line);
        let result;
        if (request.method === "initialize") result = { protocolVersion: "2025-03-26", capabilities: { tools: {} }, serverInfo: { name: "computer-cleaner", version: "0.1.0" } };
        else if (request.method === "notifications/initialized") continue;
        else if (request.method === "tools/list") result = { tools: TOOL_DEFINITIONS };
        else if (request.method === "tools/call") {
          const output = await callTool(request.params?.name, request.params?.arguments ?? {});
          result = { content: [{ type: "text", text: JSON.stringify(output, null, 2) }], structuredContent: output };
        } else throw Object.assign(new Error(`Unsupported method: ${request.method}`), { code: -32601 });
        process.stdout.write(`${JSON.stringify({ jsonrpc: "2.0", id: request.id, result })}\n`);
      } catch (cause) {
        process.stdout.write(`${JSON.stringify({ jsonrpc: "2.0", id: request?.id ?? null, error: { code: typeof cause.code === "number" ? cause.code : -32000, message: cause.message } })}\n`);
      }
    }
  }
}

export async function main(argv = process.argv.slice(2)) {
  const { command, options } = parse([...argv]);
  if (command === "scan") present(await scan(options), options.json);
  else if (command === "clean") present(await clean(options), options.json);
  else if (command === "guard") present(await guard(options), options.json);
  else if (command === "status") present(await diskStatus({ root: options.roots[0], minFreeGb: options.minFreeGb }), options.json);
  else if (command === "mcp-serve") await mcpServe();
  else {
    console.log(`Computer Cleaner\n\nCommands:\n  scan [roots...] [--json]\n  clean [roots...] --apply --confirm ${CONFIRMATION}\n  guard [roots...] --min-free-gb N [--apply --confirm ${CONFIRMATION}]\n  status [root] --min-free-gb N\n\nAll cleanup commands default to dry-run. Only strict regenerable-path rules are eligible.`);
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  main().catch((cause) => {
    console.error(JSON.stringify({ error: { code: cause.code ?? "ERROR", message: cause.message } }));
    process.exitCode = 1;
  });
}
