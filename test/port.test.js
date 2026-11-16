import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:net';
import { portBusy, ensurePortAvailable } from '../bin/port.js';
test('busy port is detected; noninteractive mode leaves listener alive; free port passes', async () => {
  const server = createServer();
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port;
  try {
    assert.equal(await portBusy(port), true);
    if (!process.stdin.isTTY) await assert.rejects(ensurePortAvailable(port), /interactive|identify/);
    assert.equal(server.listening, true);
  } finally { await new Promise(resolve => server.close(resolve)); }
  assert.equal(await portBusy(port), false);
  await ensurePortAvailable(port);
});
