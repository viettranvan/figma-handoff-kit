import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
const source = readFileSync(new URL('../figma-exporter-plugin/code.js', import.meta.url), 'utf8');
const colors = source.slice(source.indexOf('function colorToRgba('), source.indexOf('// Semantic HTML'));
const css = source.slice(source.indexOf('async function computeFullCSS('), source.indexOf('function formatCssBlock('));
const { computeFullCSS, fontWeightNumber } = vm.runInNewContext(colors + css + ';({computeFullCSS,fontWeightNumber})', { figma: { mixed: Symbol('mixed') } });
const text = { type: 'TEXT', fontName: { family: 'Inter', style: 'Semi Bold' }, fills: [{ type: 'SOLID', color: { r: 1, g: 0, b: 0 } }] };
test('text fill colors glyphs without adding background; weights preserve numeric/native values', async () => {
 const result = await computeFullCSS(text);
 assert.equal(result.color, '#ff0000');
 assert.equal(result['background-color'], undefined);
 assert.equal(result['font-weight'], '600');
 assert.equal((await computeFullCSS(text, { 'font-weight': '650' }))['font-weight'], '650');
 assert.equal((await computeFullCSS({ ...text, fontWeight: 625 }, { 'font-weight': '700' }))['font-weight'], '625');
 assert.equal(fontWeightNumber({ style: 'SemiBold' }), '600');
 assert.equal(fontWeightNumber({ style: 'Extra Bold' }), '800');
 assert.equal(fontWeightNumber({ style: 'Extra Light' }), '200');
 assert.equal((await computeFullCSS({ ...text, type: 'RECTANGLE' }))['background-color'], '#ff0000');
});
test('Fill respects both parent directions and main-axis siblings', async () => {
 for (const direction of ['HORIZONTAL', 'VERTICAL']) {
  const horizontal = direction === 'HORIZONTAL';
  const main = horizontal ? 'width' : 'height';
  const cross = horizontal ? 'height' : 'width';
  const mainSizing = horizontal ? 'layoutSizingHorizontal' : 'layoutSizingVertical';
  const crossSizing = horizontal ? 'layoutSizingVertical' : 'layoutSizingHorizontal';
  const child = { type: 'FRAME', width: 200, height: 40, [mainSizing]: 'FILL' };
  const result = await computeFullCSS(child, {}, { layoutMode: direction });
  assert.equal(result['flex-grow'], '1');
  assert.equal(result['flex-basis'], '0');
  assert.equal(result[main], '0px');
  const stretched = await computeFullCSS({ type: 'FRAME', [crossSizing]: 'FILL' }, {}, { layoutMode: direction });
  assert.equal(stretched[cross], 'auto');
  assert.equal(stretched['align-self'], 'stretch');
  assert.equal(stretched['flex-grow'], undefined);
  const absolute = await computeFullCSS({ ...child, layoutPositioning: 'ABSOLUTE', x: 0, y: 0 }, {}, { layoutMode: direction });
  assert.equal(absolute['flex-grow'], undefined);
 }
});
test('gradient geometry from native CSS survives and missing CSS is never guessed', async () => {
 for (const type of ['GRADIENT_LINEAR', 'GRADIENT_RADIAL', 'GRADIENT_ANGULAR']) {
  const node = { type: 'RECTANGLE', fills: [{ type, gradientStops: [] }] };
  const value = type === 'GRADIENT_LINEAR' ? 'linear-gradient(90deg, red, blue)' : 'radial-gradient(ellipse at 20% 30%, red, blue)';
  assert.equal((await computeFullCSS(node, { background: value })).background, value);
  assert.equal((await computeFullCSS(node)).background, undefined);
 }
});
