import { existsSync, readFileSync, mkdirSync, writeFileSync, renameSync, statSync, realpathSync } from 'node:fs';
import { resolve, dirname, basename, relative, isAbsolute, join } from 'node:path';
import { homedir } from 'node:os';
import { randomUUID } from 'node:crypto';
import { select, text, confirm, isCancel } from '@clack/prompts';

export const registryFile = process.env.FIGMA_EXPORT_REGISTRY || join(homedir(), '.config', 'figma-export', 'projects.json');
function readRegistry() {
  if (!existsSync(registryFile)) return { version: 1, projects: [], removedProjects: [] };
  const data = JSON.parse(readFileSync(registryFile, 'utf8'));
  if (data.version !== 1 || !Array.isArray(data.projects) || (data.removedProjects !== undefined && !Array.isArray(data.removedProjects))) throw new Error('Invalid global project registry.');
  return { ...data, removedProjects: data.removedProjects || [] };
}
export function readProjects() { return readRegistry().projects; }
function writeRegistry(data) {
  mkdirSync(dirname(registryFile), { recursive: true });
  const tmp = `${registryFile}.${process.pid}.tmp`;
  writeFileSync(tmp, JSON.stringify(data, null, 2) + "\n", { mode: 0o600 });
  renameSync(tmp, registryFile);
}
export function validateProject(project) {
  const rel = relative(project.root, resolve(project.root, project.outputDir));
  if (!project.projectId || !isAbsolute(project.root) || !project.outputDir || isAbsolute(project.outputDir) || !rel || rel === '..' || rel.startsWith('../') || rel.startsWith('..\\')) throw new Error('Invalid project root or output directory.');
  if (!statSync(project.root).isDirectory()) throw new Error('Project directory does not exist.');
  return project;
}
export function registerProject(project, { automatic = false } = {}) {
  project = { ...project, root: realpathSync(project.root) };
  validateProject(project);
  const state = readRegistry();
  if (automatic && state.removedProjects.some(p => p.root === project.root)) {
    throw new Error('This project was unregistered. Run figma-handoff init here to register it again explicitly.');
  }
  const index = state.projects.findIndex(p => p.root === project.root);
  if (index >= 0) state.projects[index] = project; else state.projects.push(project);
  state.removedProjects = state.removedProjects.filter(p => p.root !== project.root);
  writeRegistry(state);
  return project;
}

function answer(value) {
  if (isCancel(value)) throw new Error('Cancelled; no bridge was started.');
  return value;
}
export async function addProject(root, outputDir) {
  if (!root) root = resolve(answer(await text({ message: 'Project directory', placeholder: process.cwd(), defaultValue: process.cwd() })));
  root = realpathSync(root);
  const state = readRegistry();
  const previous = [...state.projects, ...state.removedProjects].find(p => p.root === root);
  if (outputDir === undefined) outputDir = answer(await text({ message: 'Output directory relative to project', placeholder: 'figma/exports', defaultValue: previous?.outputDir || 'figma/exports' }));
  const project = validateProject({ ...previous, root, outputDir: outputDir.trim() || 'figma/exports', projectId: previous?.projectId || randomUUID() });
  mkdirSync(resolve(root, project.outputDir), { recursive: true });
  return registerProject(project);
}
export async function chooseProject(forceSelect = false) {
  const projects = readProjects();
  const matches = projects.filter(p => { const rel = relative(p.root, process.cwd()); return !isAbsolute(rel) && rel !== '..' && !rel.startsWith('../') && !rel.startsWith('..\\'); }).sort((a,b) => b.root.length - a.root.length);
  if (!forceSelect && matches.length) return validateProject(matches[0]);
  if (!process.stdin.isTTY || !process.stdout.isTTY) throw new Error('No current project. Run figma-handoff start in a terminal to select a project, or run init first.');
  const value = answer(await select({
    message: 'Choose a project',
    options: [...projects.map(p => ({ value: p.root, label: basename(p.root), hint: `${p.root} → ${p.outputDir}` })), { value: '__add__', label: 'Add a new project' }]
  }));
  return value === '__add__' ? addProject() : validateProject(projects.find(p => p.root === value));
}

async function bridgeHealth() {
  const port = Number(process.env.FIGMA_EXPORT_PORT || 3055);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('Invalid bridge port.');
  try {
    const response = await fetch(`http://127.0.0.1:${port}/health`, { signal: AbortSignal.timeout(3000) });
    if (!response.ok) throw new Error(`Bridge health returned HTTP ${response.status}; stop the bridge before removing a project.`);
    return await response.json();
  } catch (error) {
    if (error.cause?.code === 'ECONNREFUSED') return null;
    throw error;
  }
}

export async function removeProject(root, { confirmRemoval = confirm, getHealth = bridgeHealth } = {}) {
  const requestedRoot = existsSync(resolve(root)) ? realpathSync(resolve(root)) : resolve(root);
  const selected = readProjects().find(project => project.root === requestedRoot);
  if (!selected) throw new Error('Project is not registered. Run figma-handoff projects to see registered paths.');
  async function ensureStopped() {
    const health = await getHealth();
    if (health && (health.project_id === selected.projectId || health.project_root === selected.root)) {
      throw new Error('This project is being served. Stop its bridge with Ctrl+C, then retry.');
    }
  }
  await ensureStopped();
  const approved = await confirmRemoval({
    message: `Unregister ${basename(selected.root)}?\nProject: ${selected.root}\nExports kept: ${resolve(selected.root, selected.outputDir)}\nLegacy configuration stays on disk but will not auto-register this project.`,
    initialValue: false
  });
  if (isCancel(approved) || !approved) return false;
  await ensureStopped();
  const state = readRegistry();
  const current = state.projects.find(project => project.root === selected.root);
  if (!current || JSON.stringify(current) !== JSON.stringify(selected)) throw new Error('Project registration changed; retry removal.');
  state.projects = state.projects.filter(project => project.root !== selected.root);
  state.removedProjects = [...state.removedProjects.filter(project => project.root !== selected.root), selected];
  writeRegistry(state);
  return true;
}

export async function showProjects(args) {
  if (args.length && (args[0] !== 'remove' || args.length > 2 || args[1]?.startsWith('-'))) {
    throw new Error('Usage: figma-handoff projects [remove [project-path]]');
  }
  const projects = readProjects();
  if (!projects.length) { console.log('No registered projects. Run figma-handoff start to add a project, or figma-handoff init in its directory.'); return; }
  if (!args.length) {
    for (const project of projects) console.log(`${basename(project.root)}\n  Project: ${project.root}\n  Exports: ${resolve(project.root, project.outputDir)}\n`);
    return;
  }
  if (!process.stdin.isTTY || !process.stdout.isTTY) throw new Error('Project removal requires an interactive terminal for confirmation.');
  const root = args[1] ? resolve(args[1]) : await select({ message: 'Choose a project to unregister (exports are kept)', options: projects.map(project => ({ value: project.root, label: basename(project.root), hint: project.root })) });
  if (isCancel(root)) { console.log('Cancelled; no project was removed.'); return; }
  const removed = await removeProject(root);
  console.log(removed ? 'Project unregistered. Export files and legacy configuration were kept.' : 'Cancelled; no project was removed.');
}
