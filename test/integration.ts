import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { createServer } from 'node:net';
import { setTimeout as delay } from 'node:timers/promises';
import { OpenCode } from '@opencode/client';
import { Incognito } from '../src/rpc.ts';

// This test NEVER connects to the user's shared service/database or runs a model.
const binary = process.env.OPENCODE_TEST_BINARY;
if (!binary) throw new Error('Set OPENCODE_TEST_BINARY to the OpenCode executable');
const tempRoot = process.env.OPENCODE_TEST_TEMP ?? resolve('integration-artifacts');
await mkdir(tempRoot, { recursive: true });
const scratch = await mkdtemp(join(tempRoot, 'incognito-test-'));
await mkdir(join(scratch, 'config', 'opencode'), { recursive: true });
await writeFile(join(scratch, 'config', 'opencode', 'opencode.jsonc'), JSON.stringify({
  plugins: [pathToFileURL(resolve('.')).href],
}));
const port = await new Promise<number>((done, reject) => {
  const server = createServer();
  server.once('error', reject);
  server.listen(0, '127.0.0.1', () => {
    const address = server.address();
    if (!address || typeof address === 'string') return reject(new Error('No test port'));
    server.close(() => done(address.port));
  });
});
const env: NodeJS.ProcessEnv = {
  ...process.env,
  OPENCODE_DB: join(scratch, 'test.db'),
  XDG_CONFIG_HOME: join(scratch, 'config'),
  XDG_DATA_HOME: join(scratch, 'data'),
  XDG_STATE_HOME: join(scratch, 'state'),
  XDG_CACHE_HOME: join(scratch, 'cache'),
};
delete env.OPENCODE_CONFIG_CONTENT;
delete env.OPENCODE_CLI_CONFIG_CONTENT;
delete env.OPENCODE_CONFIG;
const processHandle = spawn(binary, ['serve', '--hostname', '127.0.0.1', '--port', String(port), '--log-level', 'debug', '--print-logs'], {
  cwd: scratch, env, stdio: ['ignore', 'pipe', 'pipe'],
});
let output = '';
processHandle.stdout?.on('data', data => { output += data.toString(); });
processHandle.stderr?.on('data', data => { output += data.toString(); });
processHandle.on('error', error => { output += String(error); });
const client = OpenCode.make({
  baseUrl: `http://127.0.0.1:${port}`,
  fetch: ((input, init) => {
    const password = output.match(/server password (\S+)/)?.[1];
    const headers = new Headers(init?.headers);
    if (password) headers.set('authorization', `Basic ${Buffer.from(`opencode:${password}`).toString('base64')}`);
    return fetch(input, { ...init, headers });
  }) as typeof fetch,
});
const safeOutput = () => output.replace(/server password \S+/g, 'server password [redacted]');
const location = { directory: scratch };
try {
  let ready = false;
  for (let i = 0; i < 100; i++) {
    try { await client.server.info({ signal: AbortSignal.timeout(500) }); ready = true; break; }
    catch { await delay(200); }
    if (processHandle.exitCode !== null) break;
  }
  assert.ok(ready, `Test server did not start:\n${safeOutput()}`);
  const normal = await client.session.create({ title: 'Do not delete', location });
  const rpc = client.rpc(Incognito);
  const a = randomUUID();
  const b = randomUUID();
  const { sessionID } = await rpc.create({ owner: a }, { location }) as { sessionID: string };
  const plugins = await client.plugin.list({ location });
  assert.ok(JSON.stringify(plugins).includes('opencode-incognito'), JSON.stringify(plugins));
  const other = await rpc.create({ owner: b }, { location }) as { sessionID: string };
  const child = await client.session.create({ parentID: sessionID, location });
  await rpc.heartbeat({ owner: a }, { location });
  await rpc.release({ owner: a }, { location });
  await assert.rejects(client.session.get({ sessionID }));
  await assert.rejects(client.session.get({ sessionID: child.id }));
  assert.equal((await client.session.get({ sessionID: normal.id })).id, normal.id);
  assert.equal((await client.session.get({ sessionID: other.sessionID })).id, other.sessionID);
  // Idempotent cleanup and manually-deleted temporary sessions.
  await rpc.release({ owner: a }, { location });
  await client.session.remove({ sessionID: other.sessionID });
  await rpc.release({ owner: b }, { location });
  const first = await rpc.create({ owner: a }, { location }) as { sessionID: string };
  const second = await rpc.create({ owner: a }, { location }) as { sessionID: string };
  const firstChild = await client.session.create({ parentID: first.sessionID, location });
  await rpc.close({ owner: b, sessionID: first.sessionID }, { location });
  assert.equal((await client.session.get({ sessionID: first.sessionID })).id, first.sessionID);
  await rpc.close({ owner: a, sessionID: first.sessionID }, { location });
  await assert.rejects(client.session.get({ sessionID: first.sessionID }));
  await assert.rejects(client.session.get({ sessionID: firstChild.id }));
  assert.equal((await client.session.get({ sessionID: second.sessionID })).id, second.sessionID);
  assert.equal((await client.session.get({ sessionID: normal.id })).id, normal.id);
  await rpc.release({ owner: a }, { location });
  // Reproduce opening an existing session in a different directory while the
  // plugin is configured globally, rather than only in the launch project.
  const otherLocation = { directory: join(scratch, 'another-project') };
  await mkdir(otherLocation.directory);
  const ordinaryElsewhere = await client.session.create({ title: 'Existing session elsewhere', location: otherLocation });
  const temporaryElsewhere = await rpc.create({ owner: a }, { location: otherLocation }) as { sessionID: string };
  assert.equal((await client.session.get({ sessionID: temporaryElsewhere.sessionID })).location.directory, otherLocation.directory);
  await rpc.close({ owner: a, sessionID: temporaryElsewhere.sessionID }, { location: otherLocation });
  await assert.rejects(client.session.get({ sessionID: temporaryElsewhere.sessionID }));
  assert.equal((await client.session.get({ sessionID: ordinaryElsewhere.id })).id, ordinaryElsewhere.id);
  console.log('PASS: real OpenCode server loads plugin; release and individual tab-close remove parent/children, preserve ordinary/sibling/other-owner sessions; repeated/missing cleanup works.');
} catch (error) {
  console.error(safeOutput());
  throw error;
} finally {
  processHandle.kill();
  console.log(`Isolated test artifacts: ${scratch}`);
}
