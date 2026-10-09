import { createEffect, createMemo, onCleanup, onMount, Show } from 'solid-js';
import { useTerminalDimensions } from '@opentui/solid';
import { type BoxRenderable, type Renderable, TextAttributes, Yoga } from '@opentui/core';
import type { Context } from '@opencode/plugin/tui/plugin';
import { isLanding, landingBottomSpace } from './landing-state.ts';

/** Temporary layout adapter for the native OpenCode 2.0.26 composer container. */
function centerComposer(container: Renderable): () => void {
  const node = container.getLayoutNode();
  const width = node.getWidth();
  const maxWidth = node.getMaxWidth();
  const align = node.getAlignSelf();
  const value = (size: { unit: Yoga.Unit; value: number }): number | `${number}%` | undefined =>
    size.unit === Yoga.Unit.Point ? size.value
      : size.unit === Yoga.Unit.Percent ? `${size.value}%` : undefined;
  const alignments = ['auto', 'flex-start', 'center', 'flex-end', 'stretch', 'baseline', 'space-between', 'space-around', 'space-evenly'] as const;
  container.width = '100%';
  container.maxWidth = 75;
  container.alignSelf = 'center';
  return () => {
    if (container.isDestroyed) return;
    container.width = value(width) ?? 'auto';
    container.maxWidth = value(maxWidth);
    container.alignSelf = alignments[align] ?? 'auto';
  };
}

export function registerLanding(context: Context, owns: (sessionID: string) => boolean): void {
  const fresh = (sessionID?: string) => isLanding(context, owns, sessionID);

  context.ui.slot({
    prepend: 'session.composer.top',
    render: input => <LandingHeading context={context} active={() => fresh(input.sessionID)} />,
  });
  // The native footer is a row. A zero-width spacer grows that row vertically,
  // lifting the ORIGINAL composer; no replacement textarea or private imports.
  context.ui.slot({
    after: 'prompt.footer',
    render: input => {
      const dimensions = useTerminalDimensions();
      return <box width={0} height={fresh(input.sessionID) ? landingBottomSpace(dimensions().height) : 0} flexShrink={0} />;
    },
  });
}

function LandingHeading(props: { context: Context; active: () => boolean }) {
  const dimensions = useTerminalDimensions();
  const active = createMemo(props.active);
  let anchor: BoxRenderable | undefined;
  let container: Renderable | undefined;
  let restore: (() => void) | undefined;
  onMount(() => {
    // Slots render as siblings, so this anchor's parent is the native composer.
    container = anchor?.parent ?? undefined;
    createEffect(() => {
      if (active() && container && !restore) restore = centerComposer(container);
      if (!active() && restore) { restore(); restore = undefined; }
    });
  });
  onCleanup(() => restore?.());
  return (
    <box ref={element => { anchor = element; }} flexShrink={0}>
      <Show when={active()}>
        <box alignItems="center" paddingBottom={1} gap={1}>
          <text fg={props.context.theme.text.base} attributes={TextAttributes.BOLD}>◇ Temporary chat</text>
          <Show when={dimensions().height >= 14}>
            <text fg={props.context.theme.text.muted} wrapMode="word">
              History will be deleted when you close this tab.
            </text>
          </Show>
        </box>
      </Show>
    </box>
  );
}
