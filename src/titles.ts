import type { Context } from '@opencode/plugin/promise/plugin';
import { isExactRootFallback, withTimestampedFallback } from '@opencode/util/session-title-fallback';
import { MARKER } from './leases.ts';

export const INITIAL_TITLE = '[Incognito] New session';

export function incognitoTitle(title: string): string {
  const label = title.trim().replace(/^(?:\[Incognito\]\s*)+/i, '').trim();
  return `[Incognito] ${label || 'New session'}`;
}

/** Preserve OpenCode's own title generation; only decorate its final title. */
export async function installTitles(ctx: Context): Promise<() => void> {
  await ctx.session.hook('prompt', async event => {
    const session = await ctx.session.get({ sessionID: event.sessionID });
    if (!session.metadata?.[MARKER] || session.parentID || session.fork) return;
    if (session.title !== INITIAL_TITLE && session.title !== '[Incognito] Temporary session') return;
    // A custom title is not "untitled" to OpenCode. Restore its exact native
    // fallback just before first admission so its standard title task can run.
    await ctx.session.update({
      sessionID: session.id,
      title: withTimestampedFallback({ time: { created: session.time.created } }),
    });
  });

  const controller = new AbortController();
  void (async () => {
    for await (const event of ctx.event.subscribe({ signal: controller.signal })) {
      if (event.type !== 'session.renamed') continue;
      if (event.location && event.location.directory.toLowerCase() !== ctx.location.directory.toLowerCase()) continue;
      try {
        const session = await ctx.session.get({ sessionID: event.data.sessionID });
        if (!session.metadata?.[MARKER] || session.parentID || session.fork || isExactRootFallback(session)) continue;
        // Ignore stale events, including a rename superseded by a manual rename.
        if (session.title !== event.data.title) continue;
        const title = incognitoTitle(event.data.title);
        if (title !== session.title) await ctx.session.update({ sessionID: session.id, title });
      } catch (error) {
        if (error && typeof error === 'object' && '_tag' in error
          && (error._tag === 'SessionNotFoundError' || error._tag === 'Session.NotFoundError')) continue;
        console.error('[opencode-incognito] Could not update title prefix');
      }
    }
  })().catch(() => {
    if (!controller.signal.aborted) console.error('[opencode-incognito] Title event stream disconnected');
  });
  return () => controller.abort();
}
