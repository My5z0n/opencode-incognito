import { Plugin, Model, Agent } from '@opencode/plugin';
import { Session } from '@opencode/schema/session';
import { Incognito } from './rpc.ts';
import { LeaseManager, MARKER, parseLeases } from './leases.ts';

const STORAGE_KEY = 'leases/v1';

export default Plugin.define({
  id: 'opencode-incognito',
  async setup(ctx) {
    const manager = new LeaseManager(parseLeases(await ctx.storage.get(STORAGE_KEY)), {
      save: leases => ctx.storage.set(STORAGE_KEY, leases.map(lease => ({ ...lease }))),
      async ownerOf(sessionID) {
        try {
          const session = await ctx.session.get({ sessionID });
          const owner = session.metadata?.[MARKER];
          return typeof owner === 'string' ? owner : undefined;
        } catch (error) {
          if (error && typeof error === 'object' && '_tag' in error
            && (error._tag === 'SessionNotFoundError' || error._tag === 'Session.NotFoundError')) return undefined;
          throw error;
        }
      },
      remove: sessionID => ctx.session.remove({ sessionID }),
    });

    await ctx.rpc.register(Incognito, {
      async create(input) {
        const { owner, model, agent } = input as { owner: string; model?: string; agent?: string };
        const id = Session.ID.create();
        // Validate optional selections before reserving a session.
        const selectedModel = model ? Model.Ref.parse(model) : undefined;
        await manager.track(owner, id);
        const created = await ctx.session.create({
          id,
          location: { directory: ctx.location.directory },
          title: '[Incognito] Temporary session',
          metadata: { [MARKER]: owner },
          model: selectedModel,
          agent: agent ? Agent.ID.make(agent) : undefined,
        });
        return { sessionID: created.id };
      },
      async heartbeat(input) {
        await manager.heartbeat((input as { owner: string }).owner);
        return null;
      },
      async close(input) {
        const { owner, sessionID } = input as { owner: string; sessionID: string };
        await manager.close(owner, sessionID);
        return null;
      },
      async release(input) {
        try {
          await manager.release((input as { owner: string }).owner);
        } catch (error) {
          console.error('[opencode-incognito] Cleanup incomplete; leases retained for retry');
          throw error;
        }
        return null;
      },
    });

    const sweep = () => manager.sweep().catch(error => console.error('[opencode-incognito]', error));
    await sweep();
    const timer = setInterval(() => void sweep(), 30_000);
    timer.unref?.();
    // Server/plugin reload must not delete sessions whose TUI is still alive.
    return () => clearInterval(timer);
  },
});
