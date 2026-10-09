import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { createServer } from 'node:net';
import { createServer as createHttpServer } from 'node:http';
import { setTimeout as delay } from 'node:timers/promises';
import { OpenCode } from '@opencode/client';
import { Incognito } from '../src/rpc.ts';
import { INITIAL_TITLE } from '../src/titles.ts';

// This test NEVER connects to the user's shared service/database or runs a model.
const binary = process.env.OPENCODE_TEST_BINARY;
if (!binary) throw new Error('Set OPENCODE_TEST_BINARY to the OpenCode executable');
const tempRoot = process.env.OPENCODE_TEST_TEMP ?? resolve('integration-artifacts');
await mkdir(tempRoot, { recursive: true });
const scratch = await mkdtemp(join(tempRoot, 'incognito-test-'));
let mockRequests = 0;
const mock = createHttpServer(async (request, response) => {
  for await (const _chunk of request) { /* Drain locally; never log prompt contents. */ }
  mockRequests++;
  response.writeHead(200, { 'content-type': 'text/event-stream' });
  const chunk = (delta: object, finish_reason: string | null) => ({
    id: 'chatcmpl-local-test', object: 'chat.completion.chunk', created: 0, model: 'mock-model',
    choices: [{ index: 0, delta, finish_reason }],
    ...(finish_reason ? { usage: { prompt_tokens: 1, completion_tokens: 3, total_tokens: 4 } } : {}),
  });
  response.write(`data: ${JSON.stringify(chunk({ role: 'assistant', content: 'Fix login form' }, null))}\n\n`);
  response.write(`data: ${JSON.stringify(chunk({}, 'stop'))}\n\n`);
  response.end('data: [DONE]\n\n');
});
await new Promise<void>(done => mock.listen(0, '127.0.0.1', done));
const mockAddress = mock.address();
if (!mockAddress || typeof mockAddress === 'string') throw new Error('Mock server has no port');
await mkdir(join(scratch, 'config', 'opencode'), { recursive: true });
await writeFile(join(scratch, 'config', 'opencode', 'opencode.jsonc'), JSON.stringify({
  plugins: [pathToFileURL(resolve('.')).href, {
    package: pathToFileURL(resolve('test/fixtures/mock-provider')).href,
    options: { baseURL: `http://127.0.0.1:${mockAddress.port}/v1` },
  }],
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
  assert.equal((await client.session.get({ sessionID })).title, INITIAL_TITLE);
  await client.session.update({ sessionID, title: 'Fix login form' });
  let prefixed = false;
  for (let i = 0; i < 40; i++) {
    if ((await client.session.get({ sessionID })).title === '[Incognito] Fix login form') { prefixed = true; break; }
    await delay(50);
  }
  assert.equal(prefixed, true, 'Generated/native title must receive incognito prefix');
  await client.session.update({ sessionID: normal.id, title: 'Ordinary title' });
  await delay(100);
  assert.equal((await client.session.get({ sessionID: normal.id })).title, 'Ordinary title');
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
  const autoTitle = await rpc.create({ owner: a, model: 'incognito-test/mock-model' }, { location }) as { sessionID: string };
  await client.session.prompt({ sessionID: autoTitle.sessionID, text: 'Fix login form' });
  await client.session.wait({ sessionID: autoTitle.sessionID }, { signal: AbortSignal.timeout(10_000) });
  let generatedTitle = '';
  for (let i = 0; i < 100; i++) {
    generatedTitle = (await client.session.get({ sessionID: autoTitle.sessionID })).title ?? '';
    if (generatedTitle === '[Incognito] Fix login form') break;
    await delay(50);
  }
  assert.equal(generatedTitle, '[Incognito] Fix login form', 'Native title generation must work with the prefix');
  assert.ok(mockRequests >= 2, 'Primary response and title must both use the local mock provider');
  await rpc.close({ owner: a, sessionID: autoTitle.sessionID }, { location });
  console.log('PASS: real OpenCode server loads plugin; release and individual tab-close remove parent/children, preserve ordinary/sibling/other-owner sessions; repeated/missing cleanup works.');
  console.log('PASS: native automatic title generation uses the local mock provider and preserves the incognito prefix.');
} catch (error) {
  console.error(safeOutput());
  throw error;
} finally {
  processHandle.kill();
  mock.closeAllConnections();
  await new Promise<void>(done => mock.close(() => done()));
  console.log(`Isolated test artifacts: ${scratch}`);
}
