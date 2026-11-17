# Figma Handoff Kit

Export Figma screens into developer-friendly design bundles: screenshots, SVG/PNG assets, JSON/Markdown specs, design tokens, font guides and component snippets.

Two export destinations are available in the Figma plugin:

- **Download ZIP** — no CLI, Node.js or local bridge required. Export a selection, page or file, then extract the archive into your project.
- **Save to project** — run the local CLI to write directly into a project folder and skip screens whose design and output files have not changed.

## Install the CLI (for Save to project)

Requires **Node.js 20 or later** on macOS, Windows or Linux. Python is not required.

```sh
npm install -g figma-handoff-kit
figma-handoff start
```

Choose a registered project, or **Add a new project** and enter its folder and output directory. The default output is `figma/exports`; for an ignored docs folder, choose `docs/figma`.

Optional registration from a repository root:

```sh
cd /path/to/project
figma-handoff init --output-dir docs/figma
figma-handoff start
```

To choose a different project from anywhere:

```sh
figma-handoff start --select
```

`figma-export` remains a compatibility alias for `figma-handoff`.

## Install the Figma plugin

The plugin is **not yet published to Figma Community**. For now, use Figma Desktop:

1. Run `figma-handoff plugin --open` to show setup instructions and open the installed plugin folder. No clone or build is needed.
2. Open an editable Design file in **Figma Desktop** (macOS/Windows). Choose **Plugins → Development → Import plugin from manifest…** and select the displayed `manifest.json`.
3. On macOS press **Cmd+Shift+G** in the file picker and paste the full path. On Windows paste it into **File name**. `figma-handoff plugin --path` prints just that path.
4. Run **Plugins → Development → Figma Handoff Kit**. Keep `manifest.json`, `code.js` and `ui.html` together.
5. Choose Download ZIP, or run `figma-handoff start`, choose your project and select Save to project.

Development import is once per computer and requires Desktop; the browser does not import local manifests. If you only have Can view, use an editable file/copy or ask for edit access. Organization plugin policy may require administrator approval. After npm updates, restart the bridge and reopen the plugin. If a Node version manager changes the package location, import the manifest again from the new path.

Installing the CLI does not automatically install the Figma plugin. A Community installation link will be added after publication. Browser downloads and local-network access may behave differently across Figma Desktop and browsers; verify in your environment.

## Export a ZIP

1. Choose **Download ZIP** in the plugin (default).
2. Choose selected items, the current page, or every page in the file.
3. Select screenshot size: 1× for smaller files, 2× recommended, 3× for larger images.
4. Export. If the automatic download does not start, click **Download ZIP file**.
5. Extract into your project.

Every ZIP export renders the selected screens again. ZIP mode does not read local files, perform incremental skipping or generate the bridge's project-wide catalog/font summary. Screen-level component/font/token files are included. ZIP uses uncompressed storage and is assembled in memory; for large files export smaller selections or use the local bridge. A new ZIP contains the latest names; existing local folders are not synchronized or deleted.

## Save directly into a project

1. Run `figma-handoff start` on the **same computer** as Figma and leave the terminal open.
2. Choose **Save to project** in the plugin.
3. Check the displayed project and output directory before exporting.
4. Choose scope and image size, then export. Stop the bridge with Ctrl+C when finished.

The bridge listens on loopback port 3055. If busy, the CLI offers Stop or Exit; it never force-kills a listener automatically. If a browser blocks local access, allow local-network access or use Figma Desktop. The plugin includes Retry and copyable setup commands.

## Storage and incremental export

- Project registry: `~/.config/figma-export/projects.json` (outside your repositories).
- Export data: your selected project/output directory, not the npm installation directory or a cloud server.
- `export-manifest.json`: maps document/node IDs to stable folders, preserving paths after renames.
- `.export-checkpoint.json`: stores the screen design hash and output file hashes.

An unchanged screen is skipped only if its output files remain intact. Missing/modified output triggers another export. **Re-export all** bypasses skipping within the selected scope. Section notes are uploaded separately. Existing legacy root configs remain supported. Keep manifests/checkpoints when reusing an output folder.

Shared library/style change detection still needs live Figma verification. Component usage counts in the local catalog retain cumulative behavior on repeated exports. When no Figma file key is available, document identity falls back to plugin data; duplicated documents may copy that identity.

## Help and updates

```sh
figma-handoff --help
figma-handoff init --help
figma-handoff start --help
npm install -g figma-handoff-kit
```

Restart the bridge and reload the development plugin after updating.

## Development

```sh
npm ci
npm test
npm pack --dry-run
npm install -g .
```

The Node bridge and plugin live in this repository. Legacy Python scripts are reference-only and excluded from the npm package. The plugin and CLI are distributed together in npm; update Figma Community separately when published.

Source and issues: https://github.com/viettranvan/figma-handoff-kit

Version 0.2.0 adds ZIP downloads, CLI sync, updated setup guidance and export fixes. See [CHANGELOG.md](CHANGELOG.md).

## Open a project in Figma Desktop (macOS, experimental)

```sh
figma-handoff open --url "https://www.figma.com/design/FILE_KEY/Design?node-id=1-2"
figma-handoff open
figma-handoff open --select
```

Stores the URL in the project's global registry, starts the bridge, and opens the file/section in Figma Desktop. The plugin must already be imported/installed. Quick Actions searches for Figma Handoff Kit and attempts to activate an exact accessible button/menu result. If the result cannot be identified, confirm it manually with Enter. No design is exported until you click Export in the plugin.

macOS may request Accessibility permission for the hosting terminal and Automation permission for System Events. File load speed, localization and Figma's accessibility structure can affect automatic plugin launch; this is not a supported Figma launch API. If it fails, launch the plugin manually. This command has not been verified end-to-end against Figma Desktop yet.

## Sync changes with one command

1. Run `figma-handoff start` in your registered project and leave this terminal open.
2. Open the updated plugin in the target Figma file, select **Save to project** and enable **Allow CLI sync for this file (all pages, 2×)**.
3. From another terminal inside the registered project, run `figma-handoff sync` (or `figma-handoff sync --select`).

Sync sends one explicit request to the paired plugin. It exports all pages except Trash at 2× with incremental skipping, then prints checked/saved/skipped counts. The bridge and plugin must remain running. Pairing is session-only and must be enabled again after restart; disabling the checkbox immediately revokes the pairing. Only one active document may pair with a bridge. A second sync is rejected while one is queued/running. Failed/disconnected syncs are reported; no export is triggered by merely opening the plugin. Ctrl+C only stops the CLI waiting, not a running Figma export. Runtime timeout is 15 minutes. Automated protocol tests cover pairing, dispatch and completion; verify the real Figma workflow before publishing.


```sh
# Terminal 1 — leave running
cd /path/to/project
figma-handoff start

# Enable Allow CLI sync in the plugin, then use terminal 2 whenever needed
cd /path/to/project
figma-handoff sync
```

Sync uses the plugin's full export pipeline, not the REST API. It always checks all pages except Trash at 2×; the manual scope, screenshot size and Re-export all controls do not change CLI sync. It does not launch Figma, open files, install plugins, or duplicate designs. No PAT, sudo, Accessibility or Automation permission is needed for this connected-plugin workflow. Keep the computer awake and Figma, plugin and bridge running.

Sync updates new/changed screens and recreates missing or modified outputs. It does **not** remove local folders when screens are deleted in Figma. An enabled plugin may still finish an export after you disable pairing or stop the CLI.

## Permissions and troubleshooting

- **Can view on the original file:** this Design plugin needs permission to run in the file. Ask for edit access, have the designer export, or duplicate into your Drafts if the owner permits copying. A copy does not receive later changes from the original automatically.
- **Cannot reach bridge:** run `figma-handoff start` on the same computer, check port 3055 and local-network permissions, then Retry in the plugin.
- **Enable CLI sync first:** choose Save to project, verify the destination and enable Allow CLI sync. Repeat after restarting the bridge or plugin.
- **Different project:** stop the old bridge, run `figma-handoff start --select` and select the intended project. Reconnect the plugin before enabling sync.
- **Already paired/running:** only one plugin session and one sync job are supported per bridge. Disable pairing in the other plugin, or restart the bridge if that session is unavailable.
- **Plugin disconnected / timeout:** inspect Figma and its export log before retrying. Ctrl+C does not cancel the Figma export. Restart the bridge if an abandoned job blocks future requests.
- **Digest error or older behavior:** update the npm package, restart the bridge and reload the updated plugin. Update both parts together.
- **ZIP too large:** export a smaller selection or save through the bridge. ZIP assembly uses memory.

## Release and privacy

The plugin sends design data to the local loopback bridge only when Save to project is selected. ZIP mode assembles the archive inside the plugin UI. This project has no hosted upload service or telemetry. Exported designs and the project registry remain on your computer; take care when sharing export folders.

The npm package includes the CLI and plugin source. Figma Community distributes the plugin separately; npm installation does not register it with Figma. For release instructions, the Community description and manual validation checklist, see [PUBLISHING.md](PUBLISHING.md).


### Variant metadata recovery

If Figma throws while reading variant properties, the exporter tries the main component's name (not a renamed instance). It removes leading `=` characters and accepts only unique, nonempty `Property=Value` pairs. Recovered metadata is marked `variantMetadataSource: "normalized-name"`, with original/normalized names and the original `variantWarning`. For one unassigned value, the exporter can infer a missing key only if all other sibling components have a consistent, fully named schema, exactly one key is missing, and the result does not duplicate a sibling combination. Such results use `variantMetadataSource: "sibling-schema"`. If siblings only define Compare, `=Compare=Off, Nobody started` preserves Compare and stores Nobody started in `unassignedVariantLabels`, with `variantMetadataSource: "partial-name"`; the exporter does not invent State. This does not repair or rename anything in Figma. Re-export affected screens with Re-export all to refresh existing checkpoints after upgrading.


### Quick import: manifest discovery

Use `figma-handoff plugin --open` to open the installed plugin folder and display import instructions, or `figma-handoff plugin --path` for the absolute manifest path. The CLI resolves the path relative to its own installed module, not the current project or a hardcoded npm root; this also works with Node version managers.

On macOS, copy the path with `figma-handoff plugin --path | pbcopy`. In Figma Desktop choose Plugins → Development → Import plugin from manifest, press Cmd+Shift+G, paste the path and select it. On Windows, paste the path into the file picker's File name field. Import is a manual Figma registration step; the CLI does not bypass it or request Accessibility access.

Keep using the files in the installed package rather than copying only manifest.json: code.js and ui.html must remain beside it. Updating that installation updates those files; restart the plugin and bridge. Switching Node installations changes the path and requires re-importing. A future Community release removes this local import step. The plugin command is available from npm 0.2.2.

`figma-handoff serve` remains available as a compatibility alias for `figma-handoff start`.

### Everyday commands

```sh
figma-handoff start           # Start bridge; select or add a project
figma-handoff start --select  # Choose another project
figma-handoff plugin         # Show import instructions
figma-handoff plugin --open  # Open the plugin folder
figma-handoff plugin --path  # Print only the manifest path
figma-handoff sync           # Export once from Figma; requires CLI sync opt-in
figma-handoff help start     # Help for a command
figma-handoff --version      # Installed package version
```

Sync is one-way from Figma to local files, not a continuous watcher; it does not
delete obsolete export folders. `init` is optional for interactive onboarding:
`start` can register a project. `open` is an experimental macOS-only shortcut
that starts the bridge and opens Figma. Keep the terminal open; Ctrl+C stops it.

### Migrating from the scoped package

Stop the bridge before switching:

```sh
npm uninstall -g @viettran210/figma-handoff-kit
npm install -g figma-handoff-kit
figma-handoff plugin --open
```

Import the new manifest path in Figma Desktop, then reopen the plugin and run
`figma-handoff start`. Existing project registration and exported files are
preserved. The old package does not automatically upgrade to the new name.

### Named Figma colors and typography

`design_tokens.json` keeps resolved CSS color/typography inventories and adds
`namedTokens`, keyed by `style:<id>` or `variable:<id>`. Entries retain original
names, keys and source IDs. Paint styles include paints; Text Styles include
font metrics. Variables include collection ID and original values by mode,
including alias IDs. Aliases are expanded across source modes with cycle and
missing-variable diagnostics. This catalogs encountered bindings and their
dependencies, rather than every unused token in the design system.

`spec.json` adds `tokenReferences` to nodes: property, token ID, optional text
range (`start` inclusive / `end` exclusive), and variable `resolvedValue` for that
consumer. CSS and typography remain the resolved visual values, including local
overrides. Use references to identify source styles; do not infer identity from
matching hex values. Several names may intentionally share a color or font size.
Mixed text styles/fills are inspected per range even with identical font metrics.
Unavailable styles/variables retain references and `tokenWarnings` without
stopping export. Raw unbound values do not receive invented names.

The extractor checkpoint version changes to refresh existing exports once.
After future library token changes, use Re-export all if a screen is skipped.

### CSS extraction fidelity

Font weights prefer Figma numeric values, then native CSS, then a shared style-name
fallback (including Semi Bold = 600). Text fills set glyph color without adding a
background. Fill sizing uses the parent auto-layout axis: remaining-space growth
on the main axis and stretch on the cross axis; absolute children do not flex.

Gradient CSS is retained from Figma rather than regenerated with a fixed angle.
`spec.json` also retains visible gradient paints as `gradientFills`, including
transforms and stops. If native gradient CSS is unavailable, `cssWarnings` explains
that the gradient needs the original metadata/screenshot or an exported asset.
The exporter does not claim a guessed gradient is accurate.

### Image sources and rich text

Original image files retain their detected format (PNG/JPEG/GIF/WebP, otherwise
`.bin`). `spec.json.imageFills` records each visible image paint, original hash,
scale mode, crop transform, rotation, opacity/filters when supplied by Figma,
source image size and node size. Assets are original bytes: apply those paint
settings to reproduce the crop; source dimensions are not the node dimensions.
`assetImage` remains a compatibility pointer to the first available source;
use `imageFills` for nodes with multiple image paints. Missing source data gets
a per-fill warning. This does not bake the crop into a new image.

Typography lineHeight/letterSpacing now retain `{unit, value}` (or `{unit: AUTO}`
for automatic line height), rather than ambiguous numbers. Typography inventory
keys encode the full record; readers should use record fields rather than parse
keys. Text nodes always include `textRuns`, retaining fills, decoration, case,
style IDs and font metrics for each range, including direct unbound colors.

Font guides use encountered family names and normal/italic variants. They do not
assume private fonts exist on Google Fonts. `googleFontUrl` is null; the optional
`googleFontsCandidateUrl` must be verified before use. Supply licensed font files
or a verified stylesheet. The suggested stack ends with sans-serif and includes
no invented default family. Consumers of the previous typography/font-guide
schema need to handle these richer fields.

### Exporting one Figma file to two projects

Register A and B separately and keep their output directories separate. The same
Figma document can be exported to both; each destination owns its manifest and
checkpoints. Stop the bridge for A, then start B and review the destination shown
in the plugin. If the project changed since the last health check, export asks
you to review the new destination and click again.

Do not copy an export manifest from A into a newly registered B: it belongs to
A's project ID. A change-check error now reports the actual bridge rejection.
`Project changed` means the plugin/request targets a different project;
`Output belongs to another project` means the output manifest belongs to another
registration. Use a fresh output folder for an independent B export; preserve the
old folder rather than deleting or editing its manifest to bypass the check.

### Stroke, component properties and SVG metadata

`spec.json.stroke` retains every stroke paint (including visibility), alignment,
weight/side weights, dash pattern, cap, join and miter limit. Native border CSS
wins. The CSS fallback only maps one solid inside stroke on box-like nodes;
complex strokes retain their metadata and a warning instead of becoming black
or a guessed dashed border. SVG/rendered assets remain the visual reference.

Component instances export official `componentProperties` and
`componentPropertyDefinitions` with full property names (including # IDs),
types, values, defaults and preferred swaps where available. Node-level
`componentPropertyReferences` retain links to those definitions. `inferredTextProps`
records layer-name guesses separately, retaining multiple text layers. Nested
instances keep their own properties. Missing getters produce warnings.
`sampleUsages.props` now means official Figma properties; the previous
`extractedProps` guesses are replaced by `inferredTextProps`. Recommended usage
requires mapping the Figma component to the verified code API, rather than
assuming a Figma property name is a valid React/Vue prop.

Named variables recursively include aliases from all source modes. Collection
names/modes/default mode IDs are included when available. Cycles and unavailable
variables are recorded; alias traversal is capped at 64 levels and warns on
truncation. Consumer values still resolve via Figma for the actual node.
SVG assets retain `sourceChildren`: source-only metadata with tokens, typography
and component properties inside the SVG. These children are not additional DOM
or assets to render. Export remains limited to visible nodes in the selected
scope and their variable dependencies, not the entire unused library.
