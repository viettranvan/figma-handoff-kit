import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, realpathSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
const dir=realpathSync(mkdtempSync(join(tmpdir(),'handoff-project-removal-')));
process.env.FIGMA_EXPORT_REGISTRY=join(dir,'registry.json');
const {registerProject,readProjects,removeProject,addProject}=await import('../bin/projects.js');
const cli=fileURLToPath(new URL('../bin/figma-export.js',import.meta.url));
const a={root:join(dir,'A'),outputDir:'exports',projectId:'A'};
const b={root:join(dir,'B'),outputDir:'exports',projectId:'B'};
mkdirSync(a.root);mkdirSync(b.root);
const noBridge=async()=>null;
test('removal preserves exports and legacy config, blocks automatic legacy import and supports explicit re-add',async()=>{
 try{
  registerProject(a);registerProject(b);
  mkdirSync(join(a.root,'exports'));writeFileSync(join(a.root,'exports','spec.json'),'design');
  const legacy=join(a.root,'figma-export.config.json');writeFileSync(legacy,JSON.stringify(a));
  const before=readFileSync(process.env.FIGMA_EXPORT_REGISTRY,'utf8');
  assert.equal(await removeProject(a.root,{getHealth:noBridge,confirmRemoval:async()=>false}),false);
  assert.equal(readFileSync(process.env.FIGMA_EXPORT_REGISTRY,'utf8'),before);
  let confirmations=0;
  await assert.rejects(removeProject(a.root,{getHealth:async()=>({project_id:'A'}),confirmRemoval:async()=>{confirmations++;return true;}}),/Stop its bridge/);
  assert.equal(confirmations,0);
  let checks=0;
  await assert.rejects(removeProject(a.root,{getHealth:async()=>++checks===1?null:{project_id:'A'},confirmRemoval:async()=>true}),/Stop its bridge/);
  assert.equal(readFileSync(process.env.FIGMA_EXPORT_REGISTRY,'utf8'),before);
  assert.equal(await removeProject(a.root,{getHealth:async()=>({project_id:'B'}),confirmRemoval:async()=>true}),true);
  assert.deepEqual(readProjects(),[b]);assert.ok(existsSync(legacy));
  assert.equal(readFileSync(join(a.root,'exports','spec.json'),'utf8'),'design');
  assert.throws(()=>registerProject(a,{automatic:true}),/unregistered/);
  const run=(...args)=>spawnSync(process.execPath,[cli,...args],{cwd:a.root,env:process.env,encoding:'utf8'});
  assert.equal(run('start').status,1);assert.match(run('start').stderr,/unregistered/);
  assert.match(run('projects').stdout,/Project:.*B/);
  assert.equal(run('projects','remove',b.root).status,1);
  assert.equal(run('projects','oops').status,1);
  const readded=await addProject(a.root,'exports');assert.equal(readded.projectId,'A');
  assert.doesNotThrow(()=>registerProject(a,{automatic:true}));
  // Deleted directories can still be removed from the picker/registry.
  rmSync(b.root,{recursive:true});
  assert.equal(await removeProject(b.root,{getHealth:noBridge,confirmRemoval:async()=>true}),true);
  await removeProject(a.root,{getHealth:noBridge,confirmRemoval:async()=>true});
  assert.match(run('projects').stdout,/No registered projects/);
 }finally{rmSync(dir,{recursive:true,force:true});}
});
