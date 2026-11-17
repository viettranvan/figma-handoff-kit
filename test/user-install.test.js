import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { installForUser, userInstallPaths } from '../bin/user-install.js';
test('user install keeps stable launchers/manifest, quotes paths, and uses Node from PATH across updates', () => {
 const home=mkdtempSync(join(tmpdir(),"handoff user's "));
 try {
  const paths=userInstallPaths(home);
  let version='0.2.5';
  const run=(command,args,options)=>{
   assert.equal(command,'npm');assert.equal(args[args.indexOf('--prefix')+1],paths.prefix);
   assert.ok(!args.includes('-g'));assert.equal(options.cwd,paths.prefix);
   mkdirSync(join(paths.packageDir,'bin'),{recursive:true});mkdirSync(join(paths.packageDir,'figma-exporter-plugin'),{recursive:true});
   writeFileSync(join(paths.packageDir,'package.json'),JSON.stringify({name:'figma-handoff-kit',version}));
   writeFileSync(join(paths.packageDir,'bin/figma-export.js'),'console.log('+JSON.stringify(version)+')');
   for(const file of ['manifest.json','code.js','ui.html'])writeFileSync(join(paths.packageDir,'figma-exporter-plugin',file),'{}');
  };
  const first=installForUser({home,run,platform:'darwin',packageSpec:'figma-handoff-kit@0.2.5'});
  assert.equal(execFileSync(join(paths.bin,'figma-handoff'),{encoding:'utf8'}).trim(),'0.2.5');
  version='0.2.6';const second=installForUser({home,run,platform:'darwin',packageSpec:'figma-handoff-kit@0.2.5'});
  assert.equal(first.manifest,second.manifest);
  assert.equal(execFileSync(join(paths.bin,'figma-export'),{encoding:'utf8'}).trim(),'0.2.6');
  const shim=readFileSync(join(paths.bin,'figma-handoff'),'utf8');
  assert.match(shim,/exec node /);assert.ok(!shim.includes(process.execPath));
 } finally{rmSync(home,{recursive:true,force:true});}
});
test('failed npm install and conflicting bin files are not overwritten',()=>{
 const home=mkdtempSync(join(tmpdir(),'handoff-install-failure-'));const paths=userInstallPaths(home);
 try{
  assert.throws(()=>installForUser({home,platform:'darwin',packageSpec:'figma-handoff-kit@0.2.5',run(){throw new Error('offline');}}),/offline/);
  assert.equal(existsSync(paths.bin),false);
  mkdirSync(paths.bin,{recursive:true});writeFileSync(join(paths.bin,'figma-handoff'),'another tool');
  assert.throws(()=>installForUser({home,platform:'darwin',packageSpec:'figma-handoff-kit@0.2.5',run(){assert.fail('Must not install');}}),/Existing command/);
  assert.equal(readFileSync(join(paths.bin,'figma-handoff'),'utf8'),'another tool');
  rmSync(join(paths.bin,'figma-handoff'));symlinkSync(join(home,'missing'),join(paths.bin,'figma-handoff'));
  assert.throws(()=>installForUser({home,platform:'darwin',packageSpec:'figma-handoff-kit@0.2.5',run(){assert.fail('Must not install');}}),/Existing command/);
 }finally{rmSync(home,{recursive:true,force:true});}
});

test('setup refuses to downgrade a newer user installation when registry latest lags',()=>{
 const home=mkdtempSync(join(tmpdir(),'handoff-downgrade-'));const paths=userInstallPaths(home);
 try{
  mkdirSync(paths.packageDir,{recursive:true});writeFileSync(join(paths.packageDir,'package.json'),JSON.stringify({name:'figma-handoff-kit',version:'0.2.5'}));
  let calls=0;
  assert.throws(()=>installForUser({home,platform:'darwin',run(command,args){calls++;assert.equal(args[0],'view');return JSON.stringify('0.2.4');}}),/No downgrade/);
  assert.equal(calls,1);assert.equal(existsSync(paths.bin),false);
 }finally{rmSync(home,{recursive:true,force:true});}
});
