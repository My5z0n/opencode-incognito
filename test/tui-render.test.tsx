import { test, expect } from 'bun:test';
import { createSignal } from 'solid-js';
import { testRender } from '@opentui/solid';
import { RGBA, type BoxRenderable, type TextareaRenderable } from '@opentui/core';
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
      session: {
        root: (id: string) => id, get() {}, status: () => 'idle',
        message: { list: () => [{ type: 'user' }] }, pending: { list: () => [] },
      },
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

test('empty incognito centers the native composer and restores it after the first message', async () => {
  const claims = new Map<string, SlotClaim>();
  let layer: KeymapLayer | undefined;
  const [sessionID, setSessionID] = createSignal('normal');
  const [messages, setMessages] = createSignal<{ type: string }[]>([]);
  const [pending, setPending] = createSignal<object[]>([]);
  const [status, setStatus] = createSignal('idle');
  const [tabs, setTabs] = createSignal<string[]>([]);
  const context = {
    theme: {
      warning: RGBA.fromHex('#ffcc00'),
      text: { base: RGBA.fromHex('#eeeeee'), muted: RGBA.fromHex('#999999') },
    },
    keymap: { layer(factory: () => KeymapLayer) { layer = factory(); } },
    ui: {
      slot(value: SlotClaim) {
        const key = value.append ?? value.prepend ?? value.after ?? value.before ?? value.replace;
        claims.set(key!, value);
      },
      router: { current: () => ({ type: 'home' }), navigate: (route: { sessionID: string }) => setSessionID(route.sessionID) },
      tabs: { enabled: () => true, list: () => tabs().map(sessionID => ({ sessionID })), focus: (id: string) => setTabs([id]) },
      model: { current() {} },
      toast: { show() {} },
    },
    data: {
      session: {
        root: (id: string) => id, get() {}, status,
        message: { list: () => messages() }, pending: { list: pending },
      },
      location: { default: () => ({ directory: 'C:/test' }) },
    },
    client: { rpc: () => ({
      async create() { return { sessionID: 'temporary' }; },
      async heartbeat() {}, async close() {}, async release() {},
    }) },
  } as unknown as Context;
  const cleanup = await plugin.setup(context);
  const footerInput = { get sessionID() { return sessionID(); }, mode: 'normal' as const, showDetails: true };
  const headerInput = { get sessionID() { return sessionID(); } };
  let composer: BoxRenderable | undefined;
  let textarea: TextareaRenderable | undefined;
  const renderer = await testRender(() => (
    <box width="100%" height="100%">
      {(claims.get('app') as SlotClaim<'app'>).render({})}
      <box flexGrow={1} minHeight={0} />
      <box id="native-composer" ref={element => { composer = element; }} flexShrink={0}>
        {(claims.get('session.composer.top') as SlotClaim<'session.composer.top'>).render(headerInput)}
        <box height={5} border={["left"]} padding={1}>
          <textarea id="native-prompt" ref={element => { textarea = element; }} focused minHeight={1} placeholder="Ask anything" />
        </box>
        <box flexDirection="row" justifyContent="space-between">
          <text>Build · test model</text>
          {(claims.get('prompt.footer.status') as SlotClaim<'prompt.footer.status'>).render(footerInput)}
          {(claims.get('prompt.footer') as SlotClaim<'prompt.footer'>).render(footerInput)}
        </box>
      </box>
    </box>
  ), { width: 120, height: 40 });
  try {
    await renderer.renderOnce();
    expect(composer!.width).toBe(120);
    await layer!.commands![0].run();
    await renderer.renderOnce();
    expect(renderer.captureCharFrame()).toContain('Temporary chat');
    expect(renderer.captureCharFrame()).toContain('History will be deleted when you close this tab.');
    expect(renderer.captureCharFrame()).not.toContain('INCOGNITO');
    expect(composer!.width).toBe(75);
    expect(composer!.x).toBeGreaterThan(0);
    expect(textarea!.y).toBeGreaterThan(10);
    expect(textarea!.y).toBeLessThan(25);
    setSessionID('normal');
    await renderer.renderOnce();
    expect(renderer.captureCharFrame()).not.toContain('Temporary chat');
    expect(composer!.width).toBe(120);
    expect(composer!.x).toBe(0);
    setSessionID('temporary');
    await renderer.renderOnce();
    expect(renderer.captureCharFrame()).toContain('Temporary chat');
    expect(composer!.width).toBe(75);
    setPending([{}]);
    await renderer.renderOnce();
    expect(renderer.captureCharFrame()).not.toContain('Temporary chat');
    expect(composer!.width).toBe(120);
    setPending([]);
    setStatus('running');
    await renderer.renderOnce();
    expect(renderer.captureCharFrame()).not.toContain('Temporary chat');
    setStatus('idle');
    await renderer.renderOnce();
    expect(renderer.captureCharFrame()).toContain('Temporary chat');
    const originalInput = textarea;
    textarea!.insertText('Test pierwszej wiadomości');
    setMessages([{ type: 'user' }]);
    await renderer.renderOnce();
    expect(renderer.captureCharFrame()).not.toContain('Temporary chat');
    expect(renderer.captureCharFrame()).toContain('INCOGNITO');
    expect(composer!.width).toBe(120);
    expect(textarea).toBe(originalInput);
    expect(textarea!.plainText).toBe('Test pierwszej wiadomości');
    expect(textarea!.y).toBeGreaterThan(30);
    setMessages([]);
    renderer.resize(50, 14);
    await renderer.renderOnce();
    expect(textarea!.y).toBeGreaterThanOrEqual(0);
    expect(textarea!.y).toBeLessThan(14);
    expect(composer!.width).toBe(50);
    setSessionID('normal');
    renderer.resize(120, 40);
    await renderer.renderOnce();
    expect(composer!.width).toBe(120);
    expect(composer!.x).toBe(0);
  } finally {
    renderer.renderer.destroy();
    if (cleanup) await cleanup();
  }
});
