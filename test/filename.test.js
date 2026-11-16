import { test } from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
test('asset names are bounded in UTF-8, stable, and distinguish long names', () => {
 const code = readFileSync(new URL('../figma-exporter-plugin/code.js', import.meta.url), 'utf8');
 const sanitize = vm.runInNewContext(code.slice(code.indexOf('function sanitizeFilename('), code.indexOf('function bufferToBase64(')) + '\nsanitizeFilename');
 assert.equal(sanitize('Button icon'), 'Button_icon');
 for (const name of ['a'.repeat(1000), '界😀'.repeat(200)]) {
  const result = sanitize(name);
  assert.ok(Buffer.byteLength(result) <= 90);
  assert.equal(sanitize(name), result);
  assert.notEqual(sanitize(name+'x'), result);
  const filename = result+'_'+sanitize(name)+'.svg';
  assert.ok(Buffer.byteLength(filename) < 255);
 }
});
