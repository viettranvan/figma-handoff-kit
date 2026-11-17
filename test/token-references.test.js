import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
const source = readFileSync(new URL('../figma-exporter-plugin/code.js', import.meta.url), 'utf8');
const helper = source.slice(source.indexOf('async function extractTokenReferences('), source.indexOf('// Deep recursive DOM Tree Extractor'));
const alias = id => ({ type: 'VARIABLE_ALIAS', id });
function setup(styles = {}) {
 const figma = {
  getStyleByIdAsync: async id => styles[id] || null,
  variables: { getVariableByIdAsync: async id => id === 'missing' ? null : ({
   id, key: `key-${id}`, name: `Colors/${id}`, resolvedType: 'COLOR', variableCollectionId: 'collection',
   valuesByMode: { light: { r: 1, g: 0, b: 0 }, dark: alias('primitive') },
   resolveForConsumer: node => ({ value: node.dark ? { r: 0, g: 0, b: 0 } : { r: 1, g: 0, b: 0 } })
  }) }
 };
 return vm.runInNewContext(helper + '\nextractTokenReferences', { figma });
}
test('color names and source identities survive equal values and consumer modes', async () => {
 const extract = setup({ brand: { id: 'brand', name: 'Utility/Brand/600', type: 'PAINT', paints: [{ type: 'SOLID', color: { r: 1, g: 0, b: 0 }, boundVariables: { color: alias('brand') } }] } });
 const context = { designTokens: { colors: { '#ff0000': true } } };
 const first = {}, second = {};
 await extract({ fillStyleId: 'brand', fills: [{ boundVariables: { color: alias('other') } }] }, first, context);
 await extract({ dark: true, fills: [{ boundVariables: { color: alias('brand') } }] }, second, context);
 assert.equal(context.designTokens.namedTokens['style:brand'].name, 'Utility/Brand/600');
 assert.equal(context.designTokens.namedTokens['variable:other'].name, 'Colors/other');
 assert.equal(first.tokenReferences.find(r => r.tokenId === 'variable:brand').resolvedValue.r, 1);
 assert.equal(second.tokenReferences[0].resolvedValue.r, 0);
 assert.equal(context.designTokens.namedTokens['variable:brand'].valuesByMode.dark.id, 'primitive');
 assert.equal(context.designTokens.colors['#ff0000'], true);
});
test('uniform font metrics still preserve distinct text style ranges and fill variables', async () => {
 const extract = setup({ a: { id: 'a', name: 'Text xs/Regular', type: 'TEXT', fontName: { family: 'Inter', style: 'Regular' }, fontSize: 12, lineHeight: { unit: 'PIXELS', value: 18 } }, b: { id: 'b', name: 'Caption', type: 'TEXT', fontSize: 12, boundVariables: { fontSize: alias('size') } } });
 const node = { type: 'TEXT', characters: 'AB', getStyledTextSegments: () => [
  { start: 0, end: 1, textStyleId: 'a', fills: [{ boundVariables: { color: alias('text') } }] },
  { start: 1, end: 2, textStyleId: 'b' }
 ] };
 const item = {}, context = { designTokens: {} };
 await extract(node, item, context);
 assert.equal(context.designTokens.namedTokens['style:a'].name, 'Text xs/Regular');
 assert.equal(context.designTokens.namedTokens['style:a'].lineHeight.value, 18);
 assert.ok(item.tokenReferences.some(r => r.tokenId === 'style:b' && r.start === 1 && r.end === 2));
 assert.ok(item.tokenReferences.some(r => r.tokenId === 'variable:text' && r.start === 0));
 assert.ok(item.tokenReferences.some(r => r.tokenId === 'variable:size' && r.property === 'textStyle.fontSize'));
 assert.doesNotThrow(() => JSON.stringify({ item, context }));
});
test('missing tokens retain references and warnings; raw colors receive no invented names', async () => {
 const extract = setup();
 const context = { designTokens: {} }, item = {};
 await extract({ fillStyleId: 'missing', fills: [{ boundVariables: { color: alias('missing') } }] }, item, context);
 assert.equal(item.tokenReferences.length, 2);
 assert.equal(item.tokenWarnings.length, 2);
 const raw = {};
 await extract({ fills: [{ type: 'SOLID', color: { r: 1, g: 0, b: 0 } }], fillStyleId: Symbol('mixed') }, raw, context);
 assert.equal(raw.tokenReferences, undefined);
});

test('alias graph includes every mode, missing dependencies and cycles without hanging', async () => {
 const aliases = {
  root:{ light:alias('primitive'), dark:alias('loop'), extra:alias('missing') },
  primitive:{light:12}, loop:{light:alias('root')}
 };
 const calls = [];
 const figma = { variables:{
  getVariableByIdAsync:async id=>{ calls.push(id);return aliases[id] ? {id,name:id,variableCollectionId:'c',valuesByMode:aliases[id],resolveForConsumer:()=>({value:12})}:null; },
  getVariableCollectionByIdAsync:async()=>({id:'c',name:'Theme',defaultModeId:'light',modes:[{modeId:'light',name:'Light'}]})
 } };
 const extract=vm.runInNewContext(helper+';extractTokenReferences',{figma});
 const context={designTokens:{}}, item={};
 await extract({boundVariables:{fontSize:alias('root')}},item,context);
 assert.equal(context.designTokens.namedTokens['variable:primitive'].valuesByMode.light,12);
 assert.equal(context.designTokens.namedTokens['variable:missing'].unavailable,true);
 assert.match(context.designTokens.namedTokens['variable:root'].warnings[0],/cycle/);
 assert.equal(context.designTokens.variableCollections.c.name,'Theme');
 assert.equal(item.tokenReferences[0].resolvedValue,12);
 assert.equal(calls.filter(id=>id==='root').length,1);
 assert.ok(item.tokenWarnings.some(w=>w.includes('missing')));
});
