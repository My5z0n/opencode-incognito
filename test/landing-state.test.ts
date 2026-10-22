import { test } from 'node:test';
import assert from 'node:assert/strict';
import { showLanding } from '../src/landing-state.ts';

test('landing is only shown before the first actual message in an owned root', () => {
  assert.equal(showLanding(true, [], 0, false), true);
  assert.equal(showLanding(true, [{ type: 'model_selected' }, { type: 'agent_selected' }], 0, false), true);
  for (const type of ['user', 'assistant', 'shell', 'synthetic']) {
    assert.equal(showLanding(true, [{ type }], 0, false), false);
  }
  assert.equal(showLanding(false, [], 0, false), false);
  assert.equal(showLanding(true, [], 1, false), false);
  assert.equal(showLanding(true, [], 0, true), false);
});
