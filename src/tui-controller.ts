import { randomUUID } from 'node:crypto';
import type { Context } from '@opencode/plugin/tui/plugin';
import type { JSX } from '@opentui/solid';
import { Incognito } from './rpc.ts';
import { HEARTBEAT_MS } from './leases.ts';
import { describeError } from './errors.ts';

export function setupIncognito(
  context: Context,
  renderStatus: (active: () => boolean) => JSX.Element,
  watchTabs: (changed: (sessionIDs: readonly string[]) => void) => void = () => {},
) {
    const owner = randomUUID();
    // Keep location-specific clients, since users may switch projects in one TUI.
    const connections = new Map<string, { location: { directory: string } }>();
    const ownedRoots = new Set<string>();
    const sessionConnections = new Map<string, { location: { directory: string } }>();
    const seenOpen = new Set<string>();
    const pendingClose = new Set<string>();
    const closing = new Set<string>();
    const warnedClose = new Set<string>();
    const rpc = context.client.rpc(Incognito);
    let stopped = false;
    let creating = false;

    const forget = (sessionID: string) => {
      ownedRoots.delete(sessionID);
      seenOpen.delete(sessionID);
      pendingClose.delete(sessionID);
      warnedClose.delete(sessionID);
      sessionConnections.delete(sessionID);
    };

    const closeSession = async (sessionID: string) => {
      const options = sessionConnections.get(sessionID);
      if (!options || stopped || closing.has(sessionID)) return;
      closing.add(sessionID);
      try {
        await rpc.close({ owner, sessionID }, { ...options, signal: AbortSignal.timeout(5_000) });
        forget(sessionID);
      } catch {
        if (!stopped && !warnedClose.has(sessionID)) {
          warnedClose.add(sessionID);
          context.ui.toast.show({ message: 'Could not delete the closed incognito session yet; retrying.', variant: 'error' });
        }
      } finally {
        closing.delete(sessionID);
      }
    };

    watchTabs(sessionIDs => {
      if (stopped) return;
      const open = new Set(sessionIDs);
      for (const sessionID of ownedRoots) {
        if (open.has(sessionID)) {
          seenOpen.add(sessionID);
        } else if (seenOpen.has(sessionID) && !pendingClose.has(sessionID)) {
          pendingClose.add(sessionID);
          void closeSession(sessionID);
        }
      }
    });

    context.ui.slot({
      append: 'prompt.footer.status',
      render: input => renderStatus(() => !!input.sessionID && ownedRoots.has(context.data.session.root(input.sessionID))),
    });

    const openIncognito = async () => {
          if (creating || stopped) return;
          creating = true;
          try {
            const route = context.ui.router.current();
            const previous = route.type === 'session' ? context.data.session.get(route.sessionID) : undefined;
            const location = previous?.location ?? context.location ?? context.data.location.default();
            const options = { location: { directory: location.directory } };
            const locationKey = JSON.stringify(options.location);
            const selected = context.ui.model.current();
            const model = selected
              ? `${selected.providerID}/${selected.modelID}${selected.variant ? `#${selected.variant}` : ''}`
              : undefined;
            const { sessionID } = await rpc.create({ owner, model, agent: previous?.agent }, options) as { sessionID: string };
            connections.set(locationKey, options);
            ownedRoots.add(sessionID);
            sessionConnections.set(sessionID, options);
            if (stopped) {
              await rpc.release({ owner }, options);
              return;
            }
            context.ui.router.navigate({ type: 'session', sessionID });
            context.ui.tabs.focus(sessionID);
          } catch (error) {
            context.ui.toast.show({ message: `Could not create temporary session: ${describeError(error)}`, variant: 'error' });
          } finally {
            creating = false;
          }
    };

    context.keymap.layer(() => ({
      mode: 'global',
      commands: [{
        id: 'incognito.new',
        title: 'New incognito session',
        bind: 'ctrl+alt+i',
        group: 'Incognito',
        palette: true,
        slash: { name: 'incognito' },
        run: () => openIncognito(),
      }],
      bindings: ['incognito.new'],
    }));

    const timer = setInterval(() => {
      for (const options of connections.values()) {
        void rpc.heartbeat({ owner }, options).catch(() => {
          if (!stopped) context.ui.toast.show({
            message: 'Incognito heartbeat failed. Reconnect soon: temporary history expires after ~3 minutes offline.',
            variant: 'error',
          });
        });
      }
    }, HEARTBEAT_MS);
    const retryTimer = setInterval(() => {
      for (const sessionID of pendingClose) void closeSession(sessionID);
    }, 2_000);

    return async () => {
      stopped = true;
      clearInterval(timer);
      clearInterval(retryTimer);
      await Promise.all([...connections.values()].map(options =>
        rpc.release({ owner }, { ...options, signal: AbortSignal.timeout(2_000) }).catch(error => {
          console.error('[opencode-incognito] Exit cleanup failed; lease sweep will retry:', error);
        })));
    };
}
