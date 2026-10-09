import { test } from 'node:test';
import assert from 'node:assert/strict';
import { setupIncognito } from '../src/tui-controller.ts';
import type { Context } from '@opencode/plugin/tui/plugin';
import type { KeymapLayer, Route } from '@opencode/plugin/tui/context';

function fixture(initialRoute: Route = { type: 'home' }, createError?: unknown) {
  let layer: KeymapLayer | undefined;
  const created: unknown[] = [];
  const released: unknown[] = [];
  const closed: { owner: string; sessionID: string }[] = [];
  const navigated: unknown[] = [];
  const messages: string[] = [];
  let currentRoute = initialRoute;
  let tabsChanged: ((ids: readonly string[]) => void) | undefined;
  const tabs = new Set<string>();
  let failClose = false;
  const sessions = new Map<string, { id: string; location: { directory: string } }>();
  if (initialRoute.type === 'session') sessions.set(initialRoute.sessionID, { id: initialRoute.sessionID, location: { directory: 'C:/test' } });
  const context = {
    keymap: { layer(factory: () => KeymapLayer) { layer = factory(); } },
    ui: {
      slot() {},
      dialog: { async confirm() { throw new Error('Incognito must not open a confirmation dialog'); } },
      router: {
        current: () => currentRoute,
        navigate: (value: Route) => { currentRoute = value; navigated.push(value); },
      },
      tabs: { focus(id: string) { tabs.add(id); tabsChanged?.([...tabs]); } },
      model: { current: () => ({ providerID: 'test', modelID: 'model', variant: 'high' }) },
      toast: { show(input: { message: string }) { messages.push(input.message); } },
    },
    data: { session: { get: (id: string) => sessions.get(id), root: (id: string) => id }, location: { default: () => ({ directory: 'C:/test' }) } },
    client: { rpc: () => ({
      async create(input: unknown) {
        if (createError) throw createError;
        created.push(input);
        const sessionID = `temporary-${created.length}`;
        sessions.set(sessionID, { id: sessionID, location: { directory: 'C:/test' } });
        return { sessionID };
      },
      async heartbeat() {},
      async close(input: { owner: string; sessionID: string }) {
        closed.push(input);
        if (failClose) throw new Error('offline');
        sessions.delete(input.sessionID);
        return null;
      },
      async release(input: unknown) { released.push(input); return null; },
    }) },
  } as unknown as Context;
  const cleanup = setupIncognito(context, () => null, changed => { tabsChanged = changed; });
  return {
    created, released, closed, navigated, messages, cleanup, sessions,
    layer: () => layer!, run: () => layer!.commands![0].run(),
    closeTab(id: string) { tabs.delete(id); tabsChanged?.([...tabs]); },
    notifyTabs(ids: string[]) { tabsChanged?.(ids); },
    failClose(value: boolean) { failClose = value; },
  };
}

test('slash command creates a normal session view and cleanup releases same owner', async () => {
  const f = fixture();
  await f.run();
  assert.equal(f.created.length, 1);
  assert.equal((f.created[0] as { model: string }).model, 'test/model#high');
  assert.deepEqual(f.navigated, [{ type: 'session', sessionID: 'temporary-1' }]);
  const cleanup = await f.cleanup;
  if (cleanup) await cleanup();
  assert.equal(f.released.length, 1);
  assert.equal((f.released[0] as { owner: string }).owner, (f.created[0] as { owner: string }).owner);
});

test('one shortcut always creates fresh sessions and preserves existing histories', async () => {
  const f = fixture({ type: 'session', sessionID: 'normal' });
  assert.equal(f.layer().commands![0].bind, 'ctrl+alt+i');
  assert.equal(f.layer().commands!.length, 1);
  assert.deepEqual(f.layer().commands![0].slash, { name: 'incognito' });
  assert.deepEqual(f.layer().bindings, ['incognito.new']);
  await f.run();
  await f.run();
  await f.run();
  assert.equal(f.created.length, 3);
  assert.deepEqual(f.navigated, [
    { type: 'session', sessionID: 'temporary-1' },
    { type: 'session', sessionID: 'temporary-2' },
    { type: 'session', sessionID: 'temporary-3' },
  ]);
  assert.deepEqual(f.released, []);
  await f.cleanup();
});

test('shortcut from home creates a fresh incognito session each time', async () => {
  const f = fixture();
  await f.run();
  await f.run();
  assert.deepEqual(f.navigated.at(-1), { type: 'session', sessionID: 'temporary-2' });
  await f.cleanup();
});

test('deleting a temporary session does not prevent creating another', async () => {
  const f = fixture();
  await f.run();
  await f.run();
  f.sessions.delete('temporary-1');
  await f.run();
  assert.equal(f.created.length, 3);
  await f.cleanup();
});

test('closing incognito tab immediately requests deletion of only that session', async () => {
  const f = fixture({ type: 'session', sessionID: 'normal' });
  try {
    await f.run();
    f.closeTab('temporary-1');
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(f.closed.length, 1);
    assert.equal(f.closed[0].sessionID, 'temporary-1');
    assert.equal(f.sessions.has('temporary-1'), false);
    assert.equal(f.sessions.has('normal'), true);
    assert.deepEqual(f.released, []);
  } finally { await f.cleanup(); }
});

test('closing a normal tab or changing focus does not delete incognito', async () => {
  const f = fixture({ type: 'session', sessionID: 'normal' });
  try {
    await f.run();
    await f.run();
    f.closeTab('normal');
    await new Promise(resolve => setImmediate(resolve));
    assert.deepEqual(f.closed, []);
    assert.equal(f.sessions.has('temporary-1'), true);
  } finally { await f.cleanup(); }
});

test('tabs missing during startup are not treated as user-closed', async () => {
  const f = fixture();
  try {
    f.notifyTabs([]);
    assert.deepEqual(f.closed, []);
  } finally { await f.cleanup(); }
});

test('a failed close is retried instead of leaving a hidden session forever', async t => {
  t.mock.timers.enable({ apis: ['setInterval'] });
  const f = fixture();
  try {
    await f.run();
    f.failClose(true);
    f.closeTab('temporary-1');
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(f.closed.length, 1);
    assert.equal(f.sessions.has('temporary-1'), true);
    f.failClose(false);
    t.mock.timers.tick(2_000);
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(f.closed.length, 2);
    assert.equal(f.sessions.has('temporary-1'), false);
  } finally { await f.cleanup(); }
});

test('new incognito shortcut creates a fresh session even from an existing incognito', async () => {
  const f = fixture({ type: 'session', sessionID: 'normal' });
  try {
    assert.equal(f.layer().commands![0].bind, 'ctrl+alt+i');
    await f.run();
    await f.run();
    assert.equal(f.created.length, 2);
    assert.equal(f.sessions.has('temporary-1'), true);
    assert.equal(f.sessions.has('temporary-2'), true);
    assert.deepEqual(f.navigated.at(-1), { type: 'session', sessionID: 'temporary-2' });
    await f.run();
    assert.deepEqual(f.navigated.at(-1), { type: 'session', sessionID: 'temporary-3' });
  } finally { await f.cleanup(); }
});

test('structured RPC errors produce useful messages instead of object Object', async () => {
  const f = fixture({ type: 'home' }, { type: 'rpc.unavailable', message: 'RPC is unavailable' });
  try {
    await f.run();
    assert.match(f.messages[0], /not enabled in this directory/);
    assert.doesNotMatch(f.messages[0], /\[object Object\]/);
    assert.equal(f.sessions.size, 0);
  } finally { await f.cleanup(); }
});
