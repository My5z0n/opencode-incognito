import { Rpc } from '@opencode/plugin/rpc';

const ownerInput = {
  type: 'object',
  properties: { owner: { type: 'string', minLength: 16, maxLength: 128 } },
  required: ['owner'],
  additionalProperties: false,
} as const;

export const Incognito = Rpc.define({
  id: 'opencode-incognito',
  events: {},
  methods: {
    create: {
      input: {
        ...ownerInput,
        properties: {
          ...ownerInput.properties,
          model: { type: 'string', maxLength: 512 },
          agent: { type: 'string', maxLength: 128 },
        },
      },
      output: {
        type: 'object',
        properties: { sessionID: { type: 'string' } },
        required: ['sessionID'],
        additionalProperties: false,
      },
    },
    heartbeat: { input: ownerInput, output: { type: 'null' } },
    close: {
      input: {
        ...ownerInput,
        properties: {
          ...ownerInput.properties,
          sessionID: { type: 'string', minLength: 1, maxLength: 128 },
        },
        required: ['owner', 'sessionID'],
      },
      output: { type: 'null' },
    },
    release: { input: ownerInput, output: { type: 'null' } },
  },
});
