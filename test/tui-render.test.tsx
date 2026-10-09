import { test, expect } from 'bun:test';
import { createSignal } from 'solid-js';
import { testRender } from '@opentui/solid';
import { RGBA } from '@opentui/core';
import type { Context } from '@opencode/plugin/tui/plugin';
import type { KeymapLayer, SlotClaim } from '@opencode/plugin/tui/context';
import plugin from '../src/tui.tsx';

test('incognito footer mounts inside a box without orphan text and hides on normal sessions', async () => {
  let layer: KeymapLayer | undefined;
  let claim: SlotClaim<'prompt.footer.status'> | undefined;
  let app: SlotClaim<'app'> | undefined;
  const [sessionID, setSessionID] = createSignal('normal');
  const [tabs, setTabs] = createSignal<string[]>(['normal']);
  const closed: string[] = [];
  const context = {
    theme: { warning: RGBA.fromHex('#ffcc00') },
    keymap: { layer(factory: () => KeymapLayer) { layer = factory(); } },
    ui: {
      slot(value: SlotClaim) {
        if (value.append === 'app') app = value as SlotClaim<'app'>;
        if (value.append === 'prompt.footer.status') claim = value as SlotClaim<'prompt.footer.status'>;
      },
      dialog: { async confirm() { throw new Error('No informational dialogs'); } },
      router: {
        current: () => ({ type: 'home' }),
        navigate: (route: { sessionID: string }) => setSessionID(route.sessionID),
      },
      tabs: {
        enabled: () => true,
        list: () => tabs().map(sessionID => ({ sessionID })),
        focus(id: string) { setTabs(ids => ids.includes(id) ? ids : [...ids, id]); },
      },
      model: { current() {} },
      toast: { show() {} },
    },
    data: {
      session: { root: (id: string) => id, get() {} },
      location: { default: () => ({ directory: 'C:/test' }) },
    },
    client: { rpc: () => ({
      async create() { return { sessionID: 'temporary' }; },
      async heartbeat() {},
      async close(input: { sessionID: string }) { closed.push(input.sessionID); return null; },
      async release() { return null; },
    }) },
  } as unknown as Context;
  const cleanup = await plugin.setup(context);
  let renderer: Awaited<ReturnType<typeof testRender>> | undefined;
  try {
    const input = {
      get sessionID() { return sessionID(); },
      mode: 'normal' as const,
      showDetails: true,
    };
    renderer = await testRender(() => <box>{app!.render({})}{claim!.render(input)}</box>, { width: 60, height: 4 });
    await renderer.renderOnce();
    expect(renderer.captureCharFrame()).not.toContain('INCOGNITO');
    await layer!.commands![0].run();
    await renderer.renderOnce();
    expect(renderer.captureCharFrame()).toContain('INCOGNITO');
    setSessionID('normal');
    await renderer.renderOnce();
    expect(renderer.captureCharFrame()).not.toContain('INCOGNITO');
    setTabs(['normal']);
    await renderer.renderOnce();
    expect(closed).toEqual(['temporary']);
  } finally {
    renderer?.renderer.destroy();
    if (cleanup) await cleanup();
  }
});
