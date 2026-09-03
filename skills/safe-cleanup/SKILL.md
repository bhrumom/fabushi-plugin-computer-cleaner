---
name: safe-cleanup
description: Safely inspect low disk space and preview or explicitly remove strictly allowlisted regenerable developer caches and build output with Computer Cleaner.
---

# Safe computer cleanup

Use the local `computer-cleaner` CLI or its MCP tools. Always begin with
`cleaner_scan` (or `computer-cleaner.mjs scan`) and show the path, size, and
reason for every candidate.

Never interpret a request to “clean”, “free memory”, or “free disk” as consent
to delete files. The default is dry-run. Actual removal requires both
`apply: true` and the exact confirmation `CLEAN_REGENERABLE`.

The engine only accepts its built-in allowlist: Cargo `target` beside a
`Cargo.toml`, Next.js `.next`, `.turbo`, `.parcel-cache`, test `coverage`
beside a `package.json`, and `node_modules/.cache`. It rejects symlinks, Git
metadata, filesystem roots, home roots, source trees, user documents, and
unrecognized paths. Do not bypass those rules or substitute arbitrary shell
deletion.

For low-space monitoring use `cleaner_guard` with a user-selected
`minFreeGb`. Without explicit cleanup confirmation it only recommends a
restricted cleanup. Report all failures and the audit-log path.
