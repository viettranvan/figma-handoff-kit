import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
const s=readFileSync(new URL('../figma-exporter-plugin/code.js',import.meta.url),'utf8');
const block=s.slice(s.indexOf('function bufferToBase64('),s.indexOf('function decodeUtf8('));
test('base64 uses the Figma API and preserves arbitrary binary bytes, with compatible fallback',()=>{
 let calls=0;const native=vm.runInNewContext(block+';bufferToBase64',{figma:{base64Encode:bytes=>{calls++;return Buffer.from(bytes).toString('base64');}},btoa:()=>{throw new Error('Fallback must not run');}});
 const fallback=vm.runInNewContext(block+';bufferToBase64',{figma:{},btoa:x=>Buffer.from(x,'binary').toString('base64')});
 for(const bytes of [new Uint8Array(),new Uint8Array(Array.from({length:4096},(_,i)=>i%256))]){
  const expected=Buffer.from(bytes).toString('base64');assert.equal(native(bytes),expected);assert.equal(fallback(bytes),expected);
 }
 assert.equal(calls,2);
});
test('phase measurement records elapsed wall time on success and failure without changing the result',async()=>{
 let now=0;const measured=vm.runInNewContext(block+';measured',{Date:{now:()=>now},figma:{}});const profile={renderMs:0};
 assert.equal(await measured(profile,'renderMs',async()=>{now+=12;return 42;}),42);assert.equal(profile.renderMs,12);
 await assert.rejects(measured(profile,'renderMs',async()=>{now+=5;throw new Error('failed');}),/failed/);assert.equal(profile.renderMs,17);
});

test('native export keeps handoff metadata and skips CSS and HTML generation', async () => {
 const start = s.indexOf('// Deep recursive DOM Tree Extractor');
 const end = s.indexOf('function generateMarkdownDoc(', start);
 const screen = s.slice(s.indexOf('async function exportScreenNode('), s.indexOf('// Recursive section walker'));
 const identity = s.slice(s.indexOf('function exportIdentity('), s.indexOf('// Figma to AI Agent Exporter'));
 const node = {
   id: '1:2', name: 'Screen', type: 'FRAME', width: 390, height: 844,
   x: 0, y: 0, layoutMode: 'VERTICAL', children: [], fills: [],
   constraints: { horizontal: 'STRETCH', vertical: 'MIN' },
   exportAsync: async () => new Uint8Array([1]),
   getCSSAsync: async () => assert.fail('Mobile export must not read native CSS')
 };
 const messages = [];
 const run = vm.runInNewContext(s.slice(start, end) + screen + identity + ';exportScreenNode', {
   figma: {fileKey: 'file', root: {name: 'Design'}}, exportProfile: {platform: 'android', screens: []},
   forceExport: false, checkScreen: async (id, snapshot) => {
     assert.equal(id.document.id, 'file:android');
     assert.equal(JSON.parse(snapshot).platform, 'android');
     return {unchanged: false, hash: 'hash'};
   },
   sendUI: message => messages.push(message),
   measured: async (_profile, _phase, action) => action(),
   computeFullCSS: async () => ({}), detectSemanticTag: () => 'div',
   inspectStrokes: () => null, extractTokenReferences: async () => {},
   createNativeCssReader: () => assert.fail('Mobile export must skip the CSS reader'),
   generateMarkdownDoc: () => assert.fail('Mobile export must skip the web spec'),
   generateComponentSnippetsHtml: () => assert.fail('Mobile export must skip HTML'),
   generateFontGuides: () => ({fonts: [], htmlLinkTag: '<link>'}),
   bufferToBase64: () => 'AQ==', finishReuseDiagnostic: () => {},
   waitForUploadAck: async () => true
 });
 await run(node, [], 2);
 const upload = messages.find(message => message.type === 'UPLOAD_SCREEN_BATCH');
 assert.equal(upload.document.id, 'file:android');
 const files = new Map(upload.files.map(file => [file.name, file.content]));
 assert.equal(files.has('component_snippets.html'), false);
 const spec = JSON.parse(files.get('spec.json'));
 assert.equal('css' in spec, false);
 assert.equal(spec.native.constraints.horizontal, 'STRETCH');
 assert.equal(spec.autoLayout.mode, 'VERTICAL');
 assert.equal(JSON.parse(files.get('mobile_handoff.json')).targets.android.textUnit, 'sp');
 assert.equal('htmlLinkTag' in JSON.parse(files.get('fonts_guide.json')), false);
});
