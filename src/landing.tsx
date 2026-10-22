import { Show } from 'solid-js';
import { useTerminalDimensions } from '@opentui/solid';
import { TextAttributes } from '@opentui/core';
import type { Context } from '@opencode/plugin/tui/plugin';
import { isLanding } from './landing-state.ts';

export function registerLanding(context: Context, owns: (sessionID: string) => boolean): void {
  const fresh = (sessionID?: string) => isLanding(context, owns, sessionID);

  context.ui.slot({
    prepend: 'session.composer.top',
    render: input => <LandingHeading context={context} active={() => fresh(input.sessionID)} />,
  });
}

function LandingHeading(props: { context: Context; active: () => boolean }) {
  const dimensions = useTerminalDimensions();
  return (
    <Show when={props.active()}>
      <box alignItems="center" paddingBottom={1} gap={1} flexShrink={0}>
        <text fg={props.context.theme.text.base} attributes={TextAttributes.BOLD}>◇ Temporary chat</text>
        <Show when={dimensions().height >= 14}>
          <text fg={props.context.theme.text.muted} wrapMode="word">
            History will be deleted when you close this tab.
          </text>
        </Show>
      </box>
    </Show>
  );
}
