import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

export const CONFIRMATION = "CLEAN_REGENERABLE";

const FORBIDDEN_NAMES = new Set([".git", ".svn", ".hg"]);
const PROJECT_CANDIDATES = new Map([
  ["target", { marker: "Cargo.toml", reason: "Rust build output; Cargo recreates it." }],
  [".next", { marker: "package.json", reason: "Next.js build/cache output; the next build recreates it." }],
  [".turbo", { marker: "package.json", reason: "Turborepo task cache; tasks recreate it." }],
  [".parcel-cache", { marker: "package.json", reason: "Parcel compilation cache; Parcel recreates it." }],
  ["coverage", { marker: "package.json", reason: "Generated test coverage report; tests recreate it." }]
]);

function error(code, message) {
  return Object.assign(new Error(message), { code });
}

async function exists(file) {
  try {
    await fs.access(file);
    return true;
  } catch {
    return false;
  }
}

async function directorySize(root) {
  let total = 0;
  const stack = [root];
  while (stack.length) {
    const current = stack.pop();
    let entries;
    try {
      entries = await fs.readdir(current, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      const item = path.join(current, entry.name);
      if (entry.isSymbolicLink()) continue;
      if (entry.isDirectory()) stack.push(item);
      else if (entry.isFile()) {
        try { total += (await fs.stat(item)).size; } catch { /* raced with another process */ }
      }
    }
  }
  return total;
}

async function classify(candidate) {
  const name = path.basename(candidate);
  const parent = path.dirname(candidate);
  if (name === ".cache" && path.basename(parent) === "node_modules") {
    const project = path.dirname(parent);
    if (await exists(path.join(project, "package.json"))) {
      return { kind: "node-cache", reason: "Node tool cache under node_modules; tools recreate it." };
    }
  }
  const rule = PROJECT_CANDIDATES.get(name);
  if (rule && await exists(path.join(parent, rule.marker))) {
    return { kind: name.slice(0, 1) === "." ? name.slice(1) : name, reason: rule.reason };
  }
  return null;
}

function isForbidden(candidate) {
  const resolved = path.resolve(candidate);
  const parsed = path.parse(resolved);
  if (resolved === parsed.root || resolved === os.homedir()) return true;
  return resolved.split(path.sep).some((part) => FORBIDDEN_NAMES.has(part));
}

export async function scan({ roots = [process.cwd()], maxDepth = 12 } = {}) {
  const candidates = [];
  const errors = [];
  const canonicalRoots = [];
  for (const root of roots) {
    try {
      const real = await fs.realpath(path.resolve(root));
      const stat = await fs.lstat(real);
      if (!stat.isDirectory() || stat.isSymbolicLink() || isForbidden(real)) {
        errors.push({ path: path.resolve(root), code: "UNSAFE_ROOT", message: "Root is not a safe directory." });
        continue;
      }
      canonicalRoots.push(real);
    } catch (cause) {
      errors.push({ path: path.resolve(root), code: cause.code ?? "ROOT_ERROR", message: cause.message });
    }
  }

  const seen = new Set();
  for (const root of canonicalRoots) {
    const stack = [{ directory: root, depth: 0 }];
    while (stack.length) {
      const { directory, depth } = stack.pop();
      let entries;
      try {
        entries = await fs.readdir(directory, { withFileTypes: true });
      } catch (cause) {
        errors.push({ path: directory, code: cause.code ?? "READ_ERROR", message: cause.message });
        continue;
      }
      for (const entry of entries) {
        if (!entry.isDirectory() || entry.isSymbolicLink() || FORBIDDEN_NAMES.has(entry.name)) continue;
        const item = path.join(directory, entry.name);
        const rule = await classify(item);
        if (rule) {
          const real = await fs.realpath(item);
          if (!seen.has(real) && !isForbidden(real)) {
            seen.add(real);
            candidates.push({ path: real, ...rule, bytes: await directorySize(real) });
          }
          continue;
        }
        if (depth < maxDepth && entry.name !== "node_modules") stack.push({ directory: item, depth: depth + 1 });
        else if (entry.name === "node_modules" && depth < maxDepth) {
          const cache = path.join(item, ".cache");
          if (await exists(cache)) {
            const cacheRule = await classify(cache);
            if (cacheRule) {
              const real = await fs.realpath(cache);
              if (!seen.has(real)) {
                seen.add(real);
                candidates.push({ path: real, ...cacheRule, bytes: await directorySize(real) });
              }
            }
          }
        }
      }
    }
  }
  candidates.sort((a, b) => b.bytes - a.bytes || a.path.localeCompare(b.path));
  return { dryRun: true, roots: canonicalRoots, candidates, totalBytes: candidates.reduce((n, item) => n + item.bytes, 0), errors };
}

function containedIn(candidate, roots) {
  return roots.some((root) => candidate === root || candidate.startsWith(`${root}${path.sep}`));
}

async function appendAudit(auditPath, event) {
  const destination = auditPath ?? path.join(os.homedir(), "Library", "Logs", "ComputerCleaner", "audit.jsonl");
  await fs.mkdir(path.dirname(destination), { recursive: true, mode: 0o700 });
  await fs.appendFile(destination, `${JSON.stringify({ at: new Date().toISOString(), ...event })}\n`, { mode: 0o600 });
  return destination;
}

export async function clean({ roots = [process.cwd()], apply = false, confirmation, auditPath } = {}) {
  const report = await scan({ roots });
  if (!apply) return { ...report, action: "preview", message: `Dry run only. Re-run with --apply --confirm ${CONFIRMATION}.` };
  if (confirmation !== CONFIRMATION) throw error("CONFIRMATION_REQUIRED", `Actual cleanup requires confirmation ${CONFIRMATION}.`);
  const removed = [];
  const errors = [...report.errors];
  for (const item of report.candidates) {
    try {
      const real = await fs.realpath(item.path);
      if (!containedIn(real, report.roots) || isForbidden(real) || !(await classify(real))) {
        throw error("SAFETY_RECHECK_FAILED", "Candidate no longer passes the strict allowlist.");
      }
      await fs.rm(real, { recursive: true, force: false, maxRetries: 1 });
      removed.push(item);
    } catch (cause) {
      errors.push({ path: item.path, code: cause.code ?? "REMOVE_ERROR", message: cause.message });
    }
  }
  let auditLog = auditPath ?? path.join(os.homedir(), "Library", "Logs", "ComputerCleaner", "audit.jsonl");
  try {
    auditLog = await appendAudit(auditPath, {
      action: "clean",
      roots: report.roots,
      removed: removed.map(({ path: itemPath, bytes, kind }) => ({ path: itemPath, bytes, kind })),
      errors
    });
  } catch (cause) {
    errors.push({ path: auditLog, code: cause.code ?? "AUDIT_ERROR", message: `Cleanup completed but audit logging failed: ${cause.message}` });
  }
  return { dryRun: false, roots: report.roots, removed, reclaimedBytes: removed.reduce((n, item) => n + item.bytes, 0), errors, auditLog };
}

export async function diskStatus({ root = process.cwd(), minFreeGb = 10 } = {}) {
  const stats = await fs.statfs(path.resolve(root));
  const freeBytes = stats.bavail * stats.bsize;
  const thresholdBytes = Number(minFreeGb) * 1024 ** 3;
  return { root: path.resolve(root), freeBytes, minFreeGb: Number(minFreeGb), low: freeBytes < thresholdBytes };
}

export async function guard({ roots = [process.cwd()], minFreeGb = 10, apply = false, confirmation, auditPath } = {}) {
  const disk = await diskStatus({ root: roots[0], minFreeGb });
  if (!disk.low) return { disk, action: "none", message: "Free disk space is above the configured threshold." };
  const result = await clean({ roots, apply, confirmation, auditPath });
  return { disk, action: apply ? "restricted-clean" : "suggest-clean", result };
}
