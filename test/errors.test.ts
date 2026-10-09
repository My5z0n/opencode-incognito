import { test } from 'node:test';
import assert from 'node:assert/strict';
import { describeError } from '../src/errors.ts';

test('RPC and domain errors show their code and message', () => {
  assert.equal(describeError({ type: 'rpc.internal', message: 'Call failed' }), 'rpc.internal: Call failed');
  assert.equal(describeError({ _tag: 'InvalidRequestError', message: 'Invalid model' }), 'InvalidRequestError: Invalid model');
  assert.equal(describeError(new Error('Offline')), 'Offline');
  assert.equal(describeError('Disconnected'), 'Disconnected');
  assert.equal(describeError({}), 'Unknown server error');
});
