import { Agent, Model, Plugin, Provider } from '@opencode/plugin';

/** Integration-test-only provider. All generation goes to the local test server. */
export default Plugin.define({
  id: 'incognito-test.mock-provider',
  async setup(ctx) {
    const providerID = Provider.ID.make('incognito-test');
    const modelID = Model.ID.make('mock-model');
    await ctx.provider.transform(editor => {
      editor.add({
        info: {
          ...Provider.Info.empty(providerID),
          name: 'Local test provider',
          activation: 'enabled',
          package: '@opencode/ai/providers/openai-compatible',
          settings: { baseURL: ctx.options.baseURL },
        },
        models: [{
          ...Model.Info.default(providerID, modelID),
          name: 'Mock model',
          limit: { context: 32_768, input: 32_768, output: 1_024 },
        }],
      });
    });
    await ctx.agent.transform(editor => {
      editor.update(Agent.ID.make('title'), agent => {
        agent.model = { providerID, id: modelID };
      });
    });
  },
});
