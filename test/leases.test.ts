import { test } from 'node:test';
import assert from 'node:assert/strict';
import { LeaseManager, LEASE_MS, parseLeases, type Lease } from '../src/leases.ts';

function fixture(initial: Lease[] = []) {
  let now = 1_000;
  let saved = initial;
  const sessions = new Map(initial.map(lease => [lease.sessionID, lease.owner]));
  const removed: string[] = [];
  let failing: string | undefined;
  const backend = {
    async save(leases: Lease[]) { saved = structuredClone(leases); },
    async ownerOf(id: string) { return sessions.get(id); },
    async remove(id: string) {
      if (id === failing) throw new Error('server unavailable');
      removed.push(id);
      sessions.delete(id);
    },
  };
  return {
    manager: new LeaseManager(initial, backend, () => now),
    backend, sessions, removed,
    saved: () => saved,
    advance: (ms: number) => { now += ms; },
    fail: (id?: string) => { failing = id; },
  };
}

test('normal exit deletes only this client\'s tracked sessions', async () => {
  const f = fixture();
  await f.manager.track('client-a', 'temp-a');
  await f.manager.track('client-b', 'temp-b');
  f.sessions.set('temp-a', 'client-a');
  f.sessions.set('temp-b', 'client-b');
  f.sessions.set('normal', '');
  await f.manager.release('client-a');
  assert.deepEqual(f.removed, ['temp-a']);
  assert.ok(f.sessions.has('normal'));
  assert.ok(f.sessions.has('temp-b'));
  assert.equal(f.saved().length, 1);
});

test('heartbeat protects a live client while stale clients are cleaned', async () => {
  const f = fixture();
  for (const owner of ['a', 'b']) {
    await f.manager.track(owner, owner);
    f.sessions.set(owner, owner);
  }
  f.advance(LEASE_MS - 1);
  await f.manager.heartbeat('a');
  f.advance(1);
  await f.manager.sweep();
  assert.deepEqual(f.removed, ['b']);
  assert.equal(f.saved()[0].owner, 'a');
});

test('mismatched ownership is never deleted', async () => {
  const f = fixture();
  await f.manager.track('a', 'normal');
  f.sessions.set('normal', 'someone-else');
  await f.manager.release('a');
  assert.deepEqual(f.removed, []);
  assert.ok(f.sessions.has('normal'));
});

test('missing sessions and reservations for failed creates are dropped safely', async () => {
  const f = fixture();
  await f.manager.track('a', 'missing');
  await f.manager.release('a');
  assert.deepEqual(f.saved(), []);
  assert.deepEqual(f.removed, []);
});

test('failed deletion stays registered and is retried', async () => {
  const f = fixture();
  await f.manager.track('a', 'temp');
  f.sessions.set('temp', 'a');
  f.fail('temp');
  await assert.rejects(f.manager.release('a'));
  assert.equal(f.saved().length, 1);
  f.fail();
  f.advance(LEASE_MS);
  await f.manager.sweep();
  assert.deepEqual(f.removed, ['temp']);
  assert.deepEqual(f.saved(), []);
});

test('sweeper resumes from persisted leases after a server restart', async () => {
  const f = fixture([{ owner: 'a', sessionID: 'temp', expiresAt: 999 }]);
  await f.manager.sweep();
  assert.deepEqual(f.removed, ['temp']);
});

test('concurrent creates and heartbeats cannot lose registry entries', async () => {
  const f = fixture();
  await Promise.all(Array.from({ length: 30 }, (_, i) => f.manager.track('a', `temp-${i}`)));
  await Promise.all([f.manager.heartbeat('a'), f.manager.track('b', 'other'), f.manager.sweep()]);
  assert.equal(f.saved().length, 31);
});

test('storage failure prevents registration from succeeding', async () => {
  const f = fixture();
  f.backend.save = async () => { throw new Error('disk full'); };
  await assert.rejects(f.manager.track('a', 'temp'));
});

test('unknown owners cannot clean other clients', async () => {
  const f = fixture([{ owner: 'a', sessionID: 'temp', expiresAt: 99_000 }]);
  await f.manager.release('b');
  assert.deepEqual(f.removed, []);
});

test('corrupt persistent registry fails closed', () => {
  assert.deepEqual(parseLeases(undefined), []);
  assert.throws(() => parseLeases([{ sessionID: 'normal' }]));
  assert.throws(() => parseLeases([{ owner: 'a', sessionID: 'temp', expiresAt: NaN }]));
});

test('close deletes one temporary root, not other roots owned by the same client', async () => {
  const f = fixture();
  await f.manager.track('a', 'one');
  await f.manager.track('a', 'two');
  f.sessions.set('one', 'a');
  f.sessions.set('two', 'a');
  await f.manager.close('a', 'one');
  assert.deepEqual(f.removed, ['one']);
  assert.equal(f.sessions.has('two'), true);
  await f.manager.close('b', 'two');
  assert.equal(f.sessions.has('two'), true);
});

test('failed tab-close intent survives heartbeats and is retried by the sweeper', async () => {
  const f = fixture();
  await f.manager.track('a', 'one');
  f.sessions.set('one', 'a');
  f.fail('one');
  await assert.rejects(f.manager.close('a', 'one'));
  await f.manager.heartbeat('a');
  assert.equal(f.saved()[0].expiresAt, 0);
  f.fail();
  await f.manager.sweep();
  assert.deepEqual(f.removed, ['one']);
});
