import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
const source = readFileSync(new URL('../figma-exporter-plugin/code.js', import.meta.url), 'utf8');
const helpers = source.slice(source.indexOf('function colorToRgba('), source.indexOf('// Semantic HTML'));
const css = source.slice(source.indexOf('async function computeFullCSS('), source.indexOf('function formatCssBlock('));
const { computeFullCSS, inspectStrokes } = vm.runInNewContext(helpers + css + ';({computeFullCSS,inspectStrokes})', { figma:{mixed:Symbol()} });
const solid = { type:'SOLID',color:{r:1,g:0,b:0} };
test('inside box borders retain zero and individual weights; native CSS wins', async () => {
 const node={type:'RECTANGLE',strokes:[solid],strokeAlign:'INSIDE',strokeWeight:2,strokeTopWeight:0};
 const css=await computeFullCSS(node);
 assert.equal(css['border-top'],'0px solid #ff0000');
 assert.equal(css['border-right'],'2px solid #ff0000');
 assert.equal((await computeFullCSS(node,{border:'3px solid blue'})).border,'3px solid blue');
 assert.equal((await computeFullCSS(node,{border:'3px solid blue'}))['border-right'],undefined);
});
test('outside, dashed, multiple and gradient strokes preserve metadata without fake borders', async () => {
 for(const extra of [{strokeAlign:'OUTSIDE'},{dashPattern:[4,2]},{strokes:[solid,solid]},{strokes:[{type:'GRADIENT_LINEAR',gradientStops:[]}]}]) {
  const node={type:'RECTANGLE',strokes:[solid],strokeAlign:'INSIDE',strokeWeight:1,...extra};
  const css=await computeFullCSS(node);
  assert.equal(css.border,undefined);assert.equal(css['border-top'],undefined);
  const info=inspectStrokes(node);assert.ok(info.warning);assert.equal(info.paints,node.strokes);
 }
});
