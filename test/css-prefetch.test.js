import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
const source=readFileSync(new URL('../figma-exporter-plugin/code.js',import.meta.url),'utf8');
const create=vm.runInNewContext(source.slice(source.indexOf('function instanceCssKey('),source.indexOf('// Deep recursive DOM Tree Extractor'))+';createNativeCssReader');
test('CSS prefetch overlaps reads with at most four requests, preserving DFS values and excluding hidden subtrees',async()=>{
 let active=0,peak=0;const calls=[];
 const make=id=>({id,getCSSAsync:async()=>{calls.push(id);peak=Math.max(peak,++active);await new Promise(r=>setTimeout(r,2));active--;return {name:id};}});
 const root=make('root'),a=make('a'),b=make('b'),c=make('c'),d=make('d'),hidden=make('hidden');
 const extra=Array.from({length:12},(_,i)=>make('extra'+i));
 hidden.visible=false;root.children=[a,hidden,c,d,...extra];a.children=[b];
 const read=create(root);const values=[];
 for(const node of [root,a,b,c,d,...extra])values.push((await read(node)).name);
 assert.deepEqual(values,['root','a','b','c','d',...extra.map(n=>n.id)]);assert.deepEqual(calls,values);assert.equal(peak,4);assert.equal(active,0);
});
test('CSS failures retain empty fallback and scene edits fall back to sequential reads',async()=>{
 const root={id:'root',getCSSAsync:async()=>{throw new Error('unavailable');}},newChild={id:'new',getCSSAsync:async()=>({color:'red'})};
 const read=create(root);assert.equal(Object.keys(await read(root)).length,0);
 assert.equal((await read(newChild)).color,'red');
});

test('CSS warmup reads during screenshot with at most four active requests', async () => {
 let active = 0, peak = 0, calls = 0;
 const make = id => ({id, getCSSAsync: async () => {
   calls++;
   peak = Math.max(peak, ++active);
   await new Promise(resolve => setTimeout(resolve, 1));
   active--;
   return {id};
 }});
 const root = make('root');
 root.children = Array.from({length: 80}, (_, index) => make(String(index)));
 let finishScreenshot;
 const screenshot = new Promise(resolve => { finishScreenshot = resolve; });
 const read = create(root, null, screenshot);
 while (calls < 8) await new Promise(resolve => setTimeout(resolve, 1));
 finishScreenshot();
 for (const node of [root, ...root.children]) assert.equal((await read(node)).id, node.id);
 assert.equal(calls, 81);
 assert.equal(peak, 4);
});

test('instance CSS verification excludes the entire group after a native mismatch', async () => {
 const root = {id: 'root', type: 'FRAME'};
 const colors = ['red', 'red', 'blue', 'green'];
 root.children = colors.map((color, index) => {
   const parent = {id: String(index), type: 'INSTANCE', parent: root, mainComponent: {id: 'master'}};
   parent.children = [{id: `I${index};leaf`, type: 'RECTANGLE', parent, strokeWeight: index === 3 ? 2 : 1, getCSSAsync: async () => ({color})}];
   return parent;
 });
 const profile = {};
 const read = create(root, profile);
 await read(root);
 for (const [index, parent] of root.children.entries()) {
   await read(parent);
   assert.equal((await read(parent.children[0])).color, colors[index]);
 }
 assert.equal(profile.instanceCssGroups, 2);
 assert.equal(profile.instanceCssRepeated, 2);
 assert.equal(profile.instanceCssReusable, 0);
 assert.equal(profile.instanceCssConflictingGroups, 1);
});

test('instance CSS reuse retries failures and caches successful native results', async () => {
 const root = {id: 'root', type: 'FRAME'};
 let calls = 0;
 root.children = Array.from({length: 10}, (_, index) => {
   const parent = {id: String(index), type: 'INSTANCE', parent: root, mainComponent: {id: 'master'}};
   parent.children = [{id: `I${index};leaf`, type: 'RECTANGLE', parent, getCSSAsync: async () => {
     if (++calls === 1) throw new Error('unavailable');
     return {color: 'red'};
   }}];
   return parent;
 });
 const profile = {};
 const read = create(root, profile, null, 'reuse');
 await read(root);
 for (const [index, parent] of root.children.entries()) {
   await read(parent);
   assert.equal((await read(parent.children[0])).color, index === 0 ? undefined : 'red');
 }
 assert.equal(profile.cssApiFailures, 1);
 assert.equal(profile.instanceCssCacheHits, 8);
 assert.equal(calls, 2);
});

test('generated CSS uses node properties for plain spacers and falls back for bound nodes', async () => {
 const parent = {id: 'parent', layoutMode: 'HORIZONTAL'};
 let nativeCalls = 0;
 const node = {
   id: 'spacer', type: 'FRAME', parent, layoutMode: 'NONE', layoutPositioning: 'AUTO',
   layoutSizingHorizontal: 'FILL', layoutSizingVertical: 'FIXED', layoutGrow: 1,
   height: 1, opacity: 1, rotation: 0, blendMode: 'PASS_THROUGH',
   fills: [], strokes: [], effects: [], children: [], fillStyleId: '', strokeStyleId: '',
   topLeftRadius: 0, topRightRadius: 0, bottomLeftRadius: 0, bottomRightRadius: 0,
   getCSSAsync: async () => { nativeCalls++; return {height: '1px', flex: '1 0 0'}; }
 };
 const verified = {};
 await create(node, verified, null, 'off', 'verify')(node);
 assert.equal(verified.generatedCssMatches, 1);
 const used = {};
 const result = await create(node, used, null, 'off', 'use')(node);
 assert.equal(result.flex, '1 0 0');
 assert.equal(used.generatedCssUses, 1);
 assert.equal(nativeCalls, 1);
 node.boundVariables = {height: {id: 'variable'}};
 await create(node, {}, null, 'off', 'use')(node);
 assert.equal(nativeCalls, 2);
});
