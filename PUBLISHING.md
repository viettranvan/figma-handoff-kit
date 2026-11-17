# Release 0.2.4

This document describes release validation and npm CI publishing. A version change in source is not proof that the registry release succeeded.

## Validate the release

```sh
npm ci
npm run check:release
npm pack
```

Inspect the archive: it must contain `bin/`, `figma-exporter-plugin/`, README and release documentation, with no credentials, private exports or project registry. Test the packed package in a clean installation before publishing. Both `figma-handoff --help` and the compatibility alias `figma-export --help` must work.

Manual Figma Desktop checks using a disposable design copy:

- Import the updated manifest; opening the plugin must not export anything.
- Check English/Vietnamese labels, logs, help and copy feedback.
- Download ZIP for selected items; extract and inspect screenshots, specs and assets.
- Start bridge, choose Save to project and confirm project/output directory.
- Export once, export unchanged again, edit one screen and export again; confirm skipped/updated results.
- Enable CLI sync, run `figma-handoff sync`, confirm all-page 2× export and terminal counts.
- Disable CLI sync; a new sync request must fail. Re-enable and verify it works.
- Close plugin/restart bridge; verify disconnected errors and fresh opt-in.
- Confirm outputs survive updates and existing manifests retain stable paths.

Shared library/style changes, large-file memory use and Figma browser local-network/download behavior need real-environment checks. Automated tests do not replace these checks.

## Publish npm through GitHub Actions

Configure the npm trusted publisher for `viettranvan/figma-handoff-kit`, workflow
`publish.yml`, environment `npm`, with direct `npm publish` allowed. The GitHub
Environment must allow only `main`; no reviewer gate is needed for automatic
publishing. No npm token or GitHub PAT is required.

1. Update both package versions with `npm version patch --no-git-tag-version`
   (or choose a minor/major version intentionally), then update CHANGELOG.md.
2. Open a PR. CI runs tests, checks package contents and installs the archive in
   a temporary directory to verify both CLI names and plugin discovery.
3. Require the `Package checks` status in the main branch ruleset before merging.
4. Merge the reviewed PR. `publish.yml` checks the merged commit again and
   publishes the tested archive with OIDC. Manual dispatch is restricted to main.
5. Check the Publish npm run and verify the registry version. Registry visibility
   can lag; verification retries for about a minute.

Existing versions are skipped, allowing documentation-only merges and safe
re-runs. Registry errors fail the job. New versions must be stable x.y.z and
newer than all published stable versions. Do not reuse a published version.
Keep release merges sequential: GitHub concurrency retains only one pending
run, so rapid merges can replace a pending run. The running publish is not cancelled.

The package is now `figma-handoff-kit`. Bootstrap its first release manually
before configuring trusted publishing for this new package. The old scoped
package's trusted publisher does not apply to the new name. Keep the same GitHub
environment `npm`, repository and workflow filename.

Existing users: stop the bridge, uninstall `@viettran210/figma-handoff-kit`, install
`figma-handoff-kit`, then run `figma-handoff plugin --open` and import the new
manifest path in Figma Desktop. Project registration and exported files remain
outside the package installation and are preserved. Do not install both packages
at once because they provide the same CLI executable names.

This pipeline publishes npm only. Figma Desktop checks above remain manual;
it does not publish the Figma Community listing or create GitHub release tags.

## Prepare Figma Community

The manifest currently has a development ID (`sit-figma-ai-exporter`). Create/register the plugin through Figma's plugin publishing workflow and use the real ID assigned by Figma; do not invent one. Preserve the assigned ID on future updates.

Upload/use the same `code.js` and `ui.html` tested for this npm release. The plugin has no build step. The manifest currently permits wildcard network access for the local bridge; review and narrow it to the supported loopback origin where accepted by Figma, and verify actual connection behavior before submission. Do not claim Community readiness until Figma has accepted the manifest and the listing has been reviewed.

Prepare a cover/icon, screenshots for both destinations, support/repository link and the following description. Add the real Community URL to README after the listing exists. Do not include internal SIT project screenshots or private design data in public assets.

### Suggested listing description

Figma Handoff Kit exports design bundles for development and AI-assisted implementation: screenshots, JSON/Markdown specs, assets, tokens, font guides and component snippets.

**Download ZIP:** choose your selection, current page or all pages. No CLI needed. Extract the archive into your project.

**Save to project:** install Node.js 20+, run `npm install -g figma-handoff-kit`, then `figma-handoff start` on the same computer as Figma. Choose your project and output folder in the terminal; confirm them in the plugin. Exports are saved locally, with unchanged screens skipped.

**Sync from terminal:** choose Save to project and enable Allow CLI sync in the plugin. Keep Figma, plugin and bridge open, then run `figma-handoff sync` whenever you want an update. It checks all pages except Trash at 2× and exports new/changed screens. Disable the checkbox to revoke access. Sync does not open Figma or delete obsolete local folders.

English and Vietnamese interface. No hosted upload service. File permissions and organization plugin policies apply. ZIP exports render again each time and may use significant memory on large designs.

Support and source: https://github.com/viettranvan/figma-handoff-kit
