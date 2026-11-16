import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { text, isCancel } from '@clack/prompts';
import { registerProject } from './projects.js';
const execute = promisify(execFile);
export function figmaLink(input) {
  const url = new URL(input);
  if (url.protocol !== 'https:' || !['figma.com','www.figma.com'].includes(url.hostname) || !/^\/(design|file)\/[a-zA-Z0-9]+(?:\/|$)/.test(url.pathname)) throw new Error('Enter a Figma design/file HTTPS URL, optionally including node-id.');
  return url.toString();
}
export function desktopLink(input) {
  const url = new URL(figmaLink(input));
  return `figma://file/${url.pathname.split('/')[2]}${url.search}`;
}
export async function configureFigma(project, supplied) {
  let value = supplied || project.figmaUrl;
  if (!value) {
    if (!process.stdin.isTTY) throw new Error('Use open --url <Figma URL> to configure this project.');
    value = await text({ message: 'Figma file or section URL', validate: input => { try { figmaLink(input); } catch { return 'Enter a valid Figma design/file URL.'; } } });
    if (isCancel(value)) throw new Error('Cancelled.');
  }
  const figmaUrl = figmaLink(value);
  return registerProject({ ...project, figmaUrl });
}
export async function openFigma(project) {
  // Pass URL as an argument, never interpolate it into AppleScript or a shell.
  const deepLink = desktopLink(project.figmaUrl);
  await execute('/usr/bin/open', ['-a', 'Figma', deepLink]);
  try {
    const result = await execute('/usr/bin/osascript', ['-e', `
      tell application "Figma" to activate
      tell application "System Events"
        repeat 40 times
          if exists process "Figma" then exit repeat
          delay 0.25
        end repeat
        tell process "Figma"
          set frontmost to true
          delay 3
          keystroke "/" using {command down}
          delay 1
          keystroke "Figma Handoff Kit"
          delay 1
          repeat with uiItem in (entire contents)
            try
              if name of uiItem is "Figma Handoff Kit" then
                if role of uiItem is "AXButton" or role of uiItem is "AXMenuItem" then
                  perform action "AXPress" of uiItem
                  return "launched"
                end if
              end if
            end try
          end repeat
          return "manual"
        end tell
      end tell
    `], { timeout: 20000 });
    if (result.stdout.trim() === 'launched') { console.log('Plugin launch requested. Choose options in the Figma popup; export requires your click.'); return; }
    console.log('Figma Quick Actions is open with “Figma Handoff Kit”. Confirm the matching plugin with Enter. No export has started.');
  } catch (error) {
    console.error(`Plugin launch failed: ${(error.stderr || error.message).trim()}`);
    console.error('System Settings → Privacy & Security → Accessibility: allow the terminal hosting this CLI. Also approve Automation → System Events when prompted.');
    console.error('In Figma, use Quick Actions (⌘/) and run Figma Handoff Kit. Import the plugin first if missing.');
  }
}
