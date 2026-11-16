export function help(command) {
  const intro = 'Figma Handoff Kit — export Figma designs to a local project folder.\nRequires Node.js 20 or newer. No Python or cloud server required.\n';
  const init = `USAGE
  figma-handoff init [--output-dir <relative-path>]

Register the current directory as a project in the global registry.

OPTIONS
  --output-dir <path>  Output folder inside the project (e.g. docs/figma).
                       Prompts when omitted in a terminal; Enter uses
                       figma/exports. Non-interactive default: figma/exports.
  -h, --help           Show this help without creating files.

EXAMPLES
  cd /path/to/repository
  figma-handoff init
  figma-handoff init --output-dir docs/figma

NOTES
  Creates the output folder and stores project registration outside the repo.
  Re-registering the same project keeps its project ID.
  A legacy figma-export.config.json is imported if present and left unchanged;
  --output-dir does not override that legacy file.
`;
  const serve = `USAGE
  figma-handoff serve [--select]

Start the local bridge at http://localhost:3055.

OPTIONS
  --select            Always open the project picker, even inside a project.
  -h, --help          Show this help without starting a server.

PROJECT SELECTION
  Inside a registered project: selects it automatically.
  Outside projects: choose a registered project or add a new one.
  Legacy config in the current directory or its ancestors takes precedence
  unless --select is supplied.
  Interactive selection requires a terminal; scripts should run inside
  a registered project.

PORT CONFLICTS
  Shows the listener and offers Stop or Exit in an interactive terminal.
  Stopping requires confirmation. No automatic force kill.

EXAMPLES
  figma-handoff serve
  figma-handoff serve --select

WHILE RUNNING
  Open the Figma Handoff Kit plugin on this same computer.
  Check the project and output directory before exporting.
  Keep this terminal open. Press Ctrl+C to stop.
`;
  const open = `USAGE
  figma-handoff open [--select] [--url <Figma HTTPS URL>]

macOS + Figma Desktop only. Starts the bridge and opens the project's saved
Figma file/section. First use asks for a URL; --url replaces it.
The URL is stored in the global project registry, not your repository.

The plugin must be installed/imported first. macOS Accessibility and
Automation → System Events permissions may be required for Quick Actions.
Quick Actions searches for Figma Handoff Kit; confirm the exact result with
Enter. No automatic export is performed. Keep this terminal open.

EXAMPLES
  figma-handoff open --url "https://www.figma.com/design/FILE_KEY/Design?node-id=1-2"
  figma-handoff open
  figma-handoff open --select
`;
  const sync = `USAGE
  figma-handoff sync [--select]

Run serve on this computer, open the plugin, choose Save to project and
check Allow CLI sync. This pairs the current Figma document to the bridge.
Sync exports all pages (excluding Trash), 2x, skipping unchanged screens.
Keep Figma, plugin and bridge running. Permission expires on plugin/bridge
restart. Ctrl+C stops waiting, not an export already running in Figma.
Timeout: 15 minutes. Results: checked, saved, skipped. No REST API is used.
`;
  const plugin = `USAGE
  figma-handoff plugin [--path | --open]

Show the installed manifest path and Figma Desktop import instructions.
  --path  Print only the absolute manifest path for copying or scripts.
  --open  Also open the folder in Finder or Windows Explorer.

EXAMPLES
  figma-handoff plugin
  figma-handoff plugin --open

Requires Figma Desktop on macOS/Windows for development import.
Import manually once; npm cannot register the plugin automatically.
`;
  const overview = `USAGE
  figma-handoff <command> [options]

ALIASES
  figma-export        Compatibility alias for figma-handoff.

COMMANDS
  plugin              Locate plugin files and show Figma import instructions.
  init                Register the current folder as a project.
  serve               Start the local bridge; choose a project when needed.
  sync                Sync all pages (2×) through an explicitly paired plugin.
  open                Open saved Figma file and prepare plugin launch (macOS).

OPTIONS
  -h, --help          Show help. Supported after every command.

QUICK START
  figma-handoff plugin --open
  cd /path/to/repository
  figma-handoff init --output-dir docs/figma
  figma-handoff serve

  From any other directory:
  figma-handoff serve --select

STORAGE
  Registry: ~/.config/figma-export/projects.json
  Designs:  the selected project's output directory (default: figma/exports).
  No new configuration file is created in your repository.
  Keep export-manifest.json and per-screen checkpoints for stable paths
  and incremental export. Unchanged screens are skipped unless the plugin's
  Re-export all switch is enabled.

FIGMA PLUGIN
  The CLI and Figma plugin are installed separately.
  For development, import figma-exporter-plugin/manifest.json in Figma Desktop.
  Installing this CLI does not install the Figma plugin automatically.

MORE HELP
  figma-handoff init --help
  figma-handoff serve --help
  figma-handoff sync --help
`;
  return intro + '\n' + (command === 'init' ? init : command === 'serve' ? serve : command === 'open' ? open : command === 'sync' ? sync : command === 'plugin' ? plugin : overview);
}
