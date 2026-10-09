import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { Context } from '@opencode/plugin/promise/plugin';
import type { OpenCodeEvent } from '@opencode/client';
import { incognitoTitle, INITIAL_TITLE, installTitles } from '../src/titles.ts';
import { MARKER } from '../src/leases.ts';

test('prefix is idempotent and preserves the generated title', () => {
  assert.equal(incognitoTitle('Fix login form'), '[Incognito] Fix login form');
  assert.equal(incognitoTitle('[Incognito] Fix login form'), '[Incognito] Fix login form');
  assert.equal(incognitoTitle('[Incognito] [Incognito] Fix login form'), '[Incognito] Fix login form');
});

test('first prompt restores native untitled state and rename adds prefix without a loop', async () => {
  const session = {
    id: 'temporary', title: INITIAL_TITLE, parentID: undefined as string | undefined,
    metadata: { [MARKER]: 'owner' }, time: { created: 1_000 },
  };
  const updates: string[] = [];
  let prompt: ((event: { sessionID: string }) => Promise<void>) | undefined;
  let next: ((event?: OpenCodeEvent) => void) | undefined;
  const ctx = {
    location: { directory: 'C:/test' },
    session: {
      async hook(_name: string, hook: typeof prompt) { prompt = hook; },
      async get() { return { ...session }; },
      async update(input: { title: string }) { session.title = input.title; updates.push(input.title); },
    },
    event: {
      async *subscribe({ signal }: { signal: AbortSignal }) {
        const abort = () => next?.();
        signal.addEventListener('abort', abort);
        try {
          while (!signal.aborted) {
            const event = await new Promise<OpenCodeEvent | undefined>(resolve => { next = resolve; });
            if (event) yield event;
          }
        } finally { signal.removeEventListener('abort', abort); }
      },
    },
  } as unknown as Context;
  const stop = await installTitles(ctx);
  const rename = (title: string) => next?.({
    type: 'session.renamed', location: { directory: 'C:/test' }, data: { sessionID: session.id, title },
  } as OpenCodeEvent);
  try {
    await prompt!({ sessionID: session.id });
    assert.equal(session.title, 'New session - 1970-01-01T00:00:01.000Z');
    rename(session.title);
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(updates.length, 1);
    session.title = 'Fix login form';
    rename(session.title);
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(session.title, '[Incognito] Fix login form');
    rename(session.title);
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(updates.length, 2);
  } finally { stop(); }
});
