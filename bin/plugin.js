import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

export const pluginManifest = fileURLToPath(new URL('../figma-exporter-plugin/manifest.json', import.meta.url));

export async function showPlugin(args) {
  if (args.some(arg => !['--path', '--open'].includes(arg))) throw new Error('Usage: figma-handoff plugin [--path | --open]');
  if (args.includes('--path') && args.includes('--open')) throw new Error('Choose --path or --open, not both.');
  for (const name of ['manifest.json', 'code.js', 'ui.html']) {
    if (!existsSync(fileURLToPath(new URL('../figma-exporter-plugin/' + name, import.meta.url)))) {
      throw new Error(`Plugin file missing: ${name}. Reinstall figma-handoff-kit.`);
    }
  }
  if (args.includes('--path')) { console.log(pluginManifest); return; }
  console.log(`Figma Handoff Kit — plugin setup

Manifest: ${pluginManifest}

1. Open Figma Desktop (macOS or Windows), then a Design file you can edit.
2. Plugins → Development → Import plugin from manifest…
3. Select the manifest above. Keep code.js and ui.html beside it.
   macOS file picker: press Cmd+Shift+G and paste the full manifest path.
   Windows file picker: paste the full manifest path into File name.
4. Plugins → Development → Figma Handoff Kit.
5. Download ZIP, or run figma-handoff start and choose Save to project.

Import once per computer. npm installation does not register plugins in Figma.
After updating: restart the bridge and reopen the plugin. User installation
(figma-handoff setup) keeps this path stable across Node changes. Re-import
once when migrating from npm global, or if you move/remove the installation.
Can view only? Use an editable file/copy or ask the owner for edit access.
Organization policy may also require plugin approval.

Print just the path: figma-handoff plugin --path
Open its folder:    figma-handoff plugin --open`);
  if (args.includes('--open')) {
    const commands = { darwin: ['open', [dirname(pluginManifest)]], win32: ['explorer.exe', [dirname(pluginManifest)]] };
    const command = commands[process.platform];
    if (!command) { console.log('Open the manifest folder manually; development import requires Figma Desktop on macOS/Windows.'); return; }
    try { await promisify(execFile)(...command); }
    catch { console.error('Could not open the folder automatically. Use the manifest path above.'); }
  }
}
