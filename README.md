# Computer Cleaner

A local-first CLI and MCP mini-app for reclaiming disk space from regenerable
developer caches and build output. It has no network dependency.

## Safety model

- Every scan and guard action defaults to dry-run.
- Every candidate includes its canonical path, byte size, type, and reason.
- Actual deletion requires `--apply --confirm CLEAN_REGENERABLE`.
- Candidates must pass the allowlist both at scan time and immediately before deletion.
- Symlinks, Git metadata, roots, home directories, source files, user documents,
  system-critical directories, and unknown directory names are never candidates.
- Cleanup actions and errors are appended to
  `~/Library/Logs/ComputerCleaner/audit.jsonl` (override with `--audit-log`).

Eligible directories are Cargo `target` beside `Cargo.toml`, `.next`, `.turbo`,
`.parcel-cache`, and `coverage` beside `package.json`, plus
`node_modules/.cache` in a package project.

## CLI

```sh
node scripts/computer-cleaner.mjs scan /path/to/project
node scripts/computer-cleaner.mjs status /path/to/project --min-free-gb 15
node scripts/computer-cleaner.mjs guard /path/to/project --min-free-gb 15
node scripts/computer-cleaner.mjs clean /path/to/project --apply --confirm CLEAN_REGENERABLE
```

`guard` only previews when free space is below the threshold. It performs a
restricted cleanup only when the same explicit apply and confirmation flags
are supplied.

The plugin's `.mcp.json` exposes the same engine as `cleaner_scan`,
`cleaner_clean`, and `cleaner_guard` for mini-app callers.
