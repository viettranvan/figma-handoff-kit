import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
const source = readFileSync(new URL('../figma-exporter-plugin/code.js', import.meta.url), 'utf8');
const weightCode = source.slice(source.indexOf('function fontWeightNumber('), source.indexOf('// Semantic HTML'));
const fontCode = source.slice(source.indexOf('function recordFontUsage('), source.indexOf('// Preserve Figma identities'));
const helpers = vm.runInNewContext(weightCode + fontCode + ';({fontWeightNumber,imageFormat,recordFontUsage,generateFontGuides})');
test('typography preserves same-size variants, units and direct per-range colors', () => {
 const block = source.slice(source.indexOf('  // 3. TEXT & TYPOGRAPHY'), source.indexOf('  try {\n    await extractTokenReferences'));
 const context = { fontsUsed: {}, designTokens: { typography: {} } };
 for (const unit of ['PIXELS', 'PERCENT']) {
  const fills = [{ type: 'SOLID', color: { r: 1, g: 0, b: 0 } }];
  const run = { start: 0, end: 1, fontName: { family: 'Inter', style: 'Regular Italic' }, fontWeight: 400, fontSize: 12, lineHeight: { unit, value: 18 }, letterSpacing: { unit, value: 2 }, fills, textDecoration: 'UNDERLINE' };
  const nodeItem = {};
  vm.runInNewContext(block, { ...helpers, figma: { mixed: Symbol() }, node: { type: 'TEXT', characters: 'A', ...run, getStyledTextSegments: fields => { assert.ok(fields.includes('fills')); assert.ok(fields.includes('textDecoration')); return [run]; } }, nodeItem, context, computedCss: {} });
  assert.equal(nodeItem.typography.lineHeight.unit, unit);
  assert.equal(nodeItem.typography.letterSpacing.unit, unit);
  assert.equal(nodeItem.textRuns[0].fills, fills);
  assert.equal(nodeItem.textRuns[0].textDecoration, 'UNDERLINE');
 }
 assert.equal(Object.keys(context.designTokens.typography).length, 4);
 assert.equal(context.fontsUsed.Inter['400'].italic, true);
});
test('font guides use actual families and italic variants without asserting provider availability', () => {
 const fonts = {};
 helpers.recordFontUsage(fonts, { family: 'Private Brand Font', style: 'Italic' }, '400');
 helpers.recordFontUsage(fonts, { family: 'Inter', style: 'Semi Bold' }, '600');
 const guide = helpers.generateFontGuides(fonts);
 assert.ok(guide.cssFontFamilyStack.startsWith('"Private Brand Font"'));
 assert.ok(!guide.cssFontFamilyStack.includes('IBM Plex'));
 assert.match(guide.googleFontsCandidateUrl, /Private\+Brand\+Font:ital,wght@1,400/);
 assert.equal(guide.googleFontUrl, null);
 assert.ok(!guide.htmlLinkTag.includes('<link'));
 assert.equal(helpers.generateFontGuides({}).cssFontFamilyStack, 'sans-serif');
});
test('original JPEG metadata retains crop and actual dimensions instead of masquerading as PNG', async () => {
 const block = source.slice(source.indexOf('  // 6a. Preserve original'), source.indexOf('  // 6b.'));
 const fill = { type: 'IMAGE', imageHash: 'fullhash', scaleMode: 'CROP', imageTransform: [[2, 0, -0.5], [0, 2, 0]], opacity: 0.6 };
 const context = { assets: [], assetsManifest: [] }, nodeItem = {};
 const fn = vm.runInNewContext('(async () => {' + block + '})', { ...helpers, metadataOnly: false, node: { id: '1:2', name: 'Avatar', width: 40, height: 40, fills: [fill, { ...fill, visible: false }] }, context, nodeItem, sanitizeFilename: x => x, bufferToBase64: bytes => Buffer.from(bytes).toString('base64'), figma: { getImageByHash: () => ({ getBytesAsync: async () => new Uint8Array([255, 216, 255, 0]), getSizeAsync: async () => ({ width: 800, height: 600 }) }) } });
 await fn();
 assert.match(nodeItem.assetImage, /fullhash.jpg$/);
 assert.equal(nodeItem.imageFills.length, 1);
 assert.equal(nodeItem.imageFills[0].imageTransform, fill.imageTransform);
 assert.equal(nodeItem.imageFills[0].opacity, 0.6);
 assert.equal(context.assetsManifest[0].dimensions, '800×600px');
 assert.equal(context.assetsManifest[0].nodeDimensions, '40×40px');
 assert.equal(helpers.imageFormat(new Uint8Array([1, 2])).extension, 'bin');
 assert.equal(helpers.imageFormat(new Uint8Array([137,80,78,71])).extension, 'png');
});
