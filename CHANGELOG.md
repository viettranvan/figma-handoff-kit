# Changelog

## 0.2.5

- Add project listing and confirmed unregistration, preserving exports and preventing silent re-registration from legacy configuration.

- Add macOS/Linux fixed-user installation and updates via `figma-handoff setup`, stable manifest paths and launchers independent of the nvm installation path.

## 0.2.4

- Preserve full stroke metadata and native CSS; only generate safe inside-solid box border fallbacks.
- Export official Figma component properties/definitions and separate layer-name guesses from the code API.
- Follow variable aliases across modes with cycle/missing-reference diagnostics, and retain source metadata within SVG assets.

- Refresh the bridge destination before local export and require a second click if the project changed.
- Preserve the actual HTTP/bridge error during change checks instead of incorrectly asking users to upgrade.

- Preserve original image formats, source sizes and per-fill crop/transform metadata.
- Keep typography units and distinct full-record variants, and export text runs for fill/decoration differences.
- Build font guides from actual families and normal/italic variants; label provider URLs unverified instead of claiming automatic font availability.

- Correct Semi Bold weights across CSS/font tracking, prevent text fill from creating a background, and map Fill sizing to the parent layout axis.
- Preserve native gradient CSS and original gradient paint data; warn when native gradient CSS is unavailable instead of guessing geometry.

- Preserve named Figma paint/text styles and variable bindings in a token catalog with per-node and per-text-range references.
- Retain per-consumer variable values and source values by mode; record unavailable metadata without stopping export.
- Refresh export checkpoints for the new token metadata.

## 0.2.3

- Move the npm package from `@viettran210/figma-handoff-kit` to `figma-handoff-kit`.

- Add `help [command]` and `--version`; simplify help and clarify one-way sync.

- Add GitHub Actions checks and npm trusted publishing after merges to main with a new version.
- Add `figma-handoff start` while retaining `serve`; update plugin copy commands and CLI documentation.

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
