# Changelog

## 0.2.2

- Preserve partial variant properties and unassigned labels when name recovery cannot determine a missing key.

- Infer a single missing variant key from a consistent sibling schema; reject ambiguous or conflicting combinations.

- Recover variant metadata from normalized main-component names when the native getter throws; retain warnings and explicit inferred provenance.

- Add `figma-handoff plugin`, `--path` and `--open` for local plugin discovery and member setup instructions.

## 0.2.1

- Handle mixed Figma text properties without Symbol conversion failures; preserve styled text ranges.
- Continue exporting components whose variant getter fails, recording a metadata warning.
- Bound asset filenames by UTF-8 byte length with stable hash suffixes and bound new bridge folder names.

## 0.2.0

- Download design bundles as ZIP without installing a CLI.
- Save to a project through the Node.js bridge, with stable ID-based folders and incremental screen checks.
- Run `figma-handoff sync` after explicitly enabling CLI sync in the connected plugin: all pages except Trash, 2×, unchanged screens skipped.
- Revoke pairing when disabling CLI sync; reject concurrent sessions and jobs.
- Fix hash calculation for Figma UI environments without WebCrypto and guard exports against unintended/stale events.
- Improve VI/EN interface, setup guidance, copy feedback, scope help and export logs.
- Add experimental macOS `open` command; automatic plugin launch still depends on macOS permissions and Figma UI behavior.
- Expand CLI help and installation, troubleshooting and release documentation.

## 0.1.0

Initial npm CLI and local bridge release.
