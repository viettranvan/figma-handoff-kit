import { existsSync, readFileSync, mkdirSync, writeFileSync, renameSync, statSync } from 'node:fs';
import { resolve, dirname, basename, relative, isAbsolute, join } from 'node:path';
import { homedir } from 'node:os';
import { randomUUID } from 'node:crypto';
import { select, text, isCancel } from '@clack/prompts';

export const registryFile = process.env.FIGMA_EXPORT_REGISTRY || join(homedir(), '.config', 'figma-export', 'projects.json');
export function readProjects() {
  if (!existsSync(registryFile)) return [];
  const data = JSON.parse(readFileSync(registryFile, 'utf8'));
  if (data.version !== 1 || !Array.isArray(data.projects)) throw new Error('Invalid global project registry.');
  return data.projects;
}
export function validateProject(project) {
  const rel = relative(project.root, resolve(project.root, project.outputDir));
  if (!project.projectId || !isAbsolute(project.root) || !project.outputDir || isAbsolute(project.outputDir) || !rel || rel === '..' || rel.startsWith('../') || rel.startsWith('..\\')) throw new Error('Invalid project root or output directory.');
  if (!statSync(project.root).isDirectory()) throw new Error('Project directory does not exist.');
  return project;
}
export function registerProject(project) {
  validateProject(project);
  const projects = readProjects();
  const index = projects.findIndex(p => p.root === project.root);
  if (index >= 0) projects[index] = project; else projects.push(project);
  mkdirSync(dirname(registryFile), { recursive: true });
  const tmp = `${registryFile}.${process.pid}.tmp`;
  writeFileSync(tmp, JSON.stringify({ version: 1, projects }, null, 2) + '\n', { mode: 0o600 });
  renameSync(tmp, registryFile);
  return project;
}
function answer(value) {
  if (isCancel(value)) throw new Error('Cancelled; no bridge was started.');
  return value;
}
export async function addProject(root, outputDir) {
  if (!root) root = resolve(answer(await text({ message: 'Project directory', placeholder: process.cwd(), defaultValue: process.cwd() })));
  const previous = readProjects().find(p => p.root === root);
  if (outputDir === undefined) outputDir = answer(await text({ message: 'Output directory relative to project', placeholder: 'figma/exports', defaultValue: previous?.outputDir || 'figma/exports' }));
  const project = validateProject({ ...previous, root, outputDir: outputDir.trim() || 'figma/exports', projectId: previous?.projectId || randomUUID() });
  mkdirSync(resolve(root, project.outputDir), { recursive: true });
  return registerProject(project);
}
export async function chooseProject(forceSelect = false) {
  const projects = readProjects();
  const matches = projects.filter(p => { const rel = relative(p.root, process.cwd()); return !isAbsolute(rel) && rel !== '..' && !rel.startsWith('../') && !rel.startsWith('..\\'); }).sort((a,b) => b.root.length - a.root.length);
  if (!forceSelect && matches.length) return validateProject(matches[0]);
  if (!process.stdin.isTTY || !process.stdout.isTTY) throw new Error('No current project. Run serve in a terminal to select a project, or run init first.');
  const value = answer(await select({
    message: 'Choose a project',
    options: [...projects.map(p => ({ value: p.root, label: basename(p.root), hint: `${p.root} → ${p.outputDir}` })), { value: '__add__', label: 'Add a new project' }]
  }));
  return value === '__add__' ? addProject() : validateProject(projects.find(p => p.root === value));
}
