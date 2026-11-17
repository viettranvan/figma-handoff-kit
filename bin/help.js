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
  figma-handoff start [--select]

Start the local bridge at http://localhost:3055.

OPTIONS
  --select            Choose another project, even inside a registered project.
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
  figma-handoff start
  figma-handoff start --select

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

Run figma-handoff start on this computer, open the plugin, choose Save to project and
check Allow CLI sync. This pairs the current Figma document to the bridge.
Sync exports all pages (excluding Trash), 2x, skipping unchanged screens.
Runs once, from Figma to local files. Does not watch, upload changes or delete
obsolete export folders.
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
  const setup = `USAGE
  figma-handoff setup

Install or update the CLI and plugin at a fixed user path (macOS/Linux):
  ~/.local/share/figma-handoff-kit/node_modules/figma-handoff-kit
Launchers: ~/.local/bin/figma-handoff and ~/.local/bin/figma-export.

Downloads the latest published version. No sudo or npm prefix config changes.
Keep ~/.local/bin before nvm paths. Uses Node >=20 from the current PATH.
Re-import the manifest once after migration; updates keep the same path.
Stop the bridge and close the plugin before updating.

EXAMPLES
  figma-handoff setup
`;
  const projects = `USAGE
  figma-handoff projects
  figma-handoff projects remove [project-path]

List registered projects or select one to unregister. Removal requires an
interactive terminal and confirmation. Stop the selected project's bridge first.
Checks the port from FIGMA_EXPORT_PORT (default 3055); stop any bridge for this
project on other ports too. Exports, project folders and legacy config are kept.
Legacy config cannot silently register a removed project again; use init explicitly.

EXAMPLES
  figma-handoff projects
  figma-handoff projects remove
  figma-handoff projects remove /path/to/project
`;
  const overview = `USAGE
  figma-handoff <command> [options]

COMMANDS
  start               Start the local bridge; select or add a project.
  projects            List projects or remove a registration.
  setup               Install/update at a fixed user path (macOS/Linux).
  plugin              Show the plugin manifest and import instructions.
  sync                Export once from Figma to local files (requires opt-in).
  help [command]      Show general or command-specific help.

OPTIONS
  --version           Print the installed package version.
  -h, --help          Show help. Supported after every command.

QUICK START
  figma-handoff plugin --open
  figma-handoff start

  Import the plugin into Figma Desktop once. Keep the terminal open while
  exporting. Press Ctrl+C to stop. To switch projects: start --select.

ADVANCED
  init                Register the current folder; supports --output-dir.
  open                Start bridge and open Figma (experimental, macOS only).

COMPATIBILITY
  serve               Alias for start.
  figma-export        Alias for figma-handoff.

MORE HELP
  figma-handoff help start
  figma-handoff plugin --help
  figma-handoff sync --help
`;
  return intro + '\n' + (command === 'projects' ? projects : command === 'setup' ? setup : command === 'init' ? init : (command === 'start' || command === 'serve') ? serve : command === 'open' ? open : command === 'sync' ? sync : command === 'plugin' ? plugin : overview);
}
