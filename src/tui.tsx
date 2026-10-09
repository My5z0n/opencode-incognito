import { Plugin } from '@opencode/plugin/tui';
import { createEffect, Show } from 'solid-js';
import { setupIncognito } from './tui-controller.ts';

export default Plugin.define({
  id: 'opencode-incognito.tui',
  setup(context) {
    return setupIncognito(
      context,
      active => (
        <Show when={active()}>
          <text fg={context.theme.warning}>INCOGNITO</text>
        </Show>
      ),
      changed => {
        // App slot gives the reactive watcher a lifecycle owned by the TUI.
        context.ui.slot({
          append: 'app',
          render: () => {
            createEffect(() => {
              if (context.ui.tabs.enabled()) changed(context.ui.tabs.list().map(tab => tab.sessionID));
            });
            return null;
          },
        });
      },
    );
  },
});
