import type { Context } from '@opencode/plugin/tui/plugin';

export function isLanding(context: Context, owns: (sessionID: string) => boolean, sessionID?: string): boolean {
  return !!sessionID && owns(sessionID) && showLanding(
    context.data.session.root(sessionID) === sessionID,
    context.data.session.message.list(sessionID),
    context.data.session.pending.list(sessionID).length,
    context.data.session.status(sessionID) === 'running',
  );
}

/** Agent/model-selection annotations do not constitute a conversation. */
export function showLanding(
  ownedRoot: boolean,
  messages: readonly { type: string }[],
  pendingCount: number,
  running: boolean,
): boolean {
  return ownedRoot && !running && pendingCount === 0
    && !messages.some(message => ['user', 'assistant', 'shell', 'synthetic'].includes(message.type));
}

export function landingBottomSpace(height: number): number {
  return height < 18 ? 0 : Math.max(0, Math.floor((height - 10) / 2));
}
