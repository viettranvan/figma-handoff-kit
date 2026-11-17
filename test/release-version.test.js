import { test } from 'node:test';
import assert from 'node:assert/strict';
import { shouldPublish } from '../scripts/release-version.mjs';
test('release gate skips existing versions and rejects invalid or backwards releases', () => {
  assert.equal(shouldPublish('0.2.3', ['0.2.2']), true);
  assert.equal(shouldPublish('0.2.2', ['0.2.2', '0.2.3']), false);
  assert.equal(shouldPublish('0.10.0', ['0.9.0']), true);
  assert.throws(() => shouldPublish('0.2.1', ['0.2.2']), /older/);
  assert.throws(() => shouldPublish('0.3.0-beta.1', ['0.2.2']), /stable/);
  assert.throws(() => shouldPublish('0.2.3', {}), /Invalid/);
});
