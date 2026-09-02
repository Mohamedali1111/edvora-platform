import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';

// Regression guard for Blocker 2: device-context.tsx must not persist any
// client-derived "rejected" authorization inference anywhere. This locks out the
// specific removed pattern (an AsyncStorage-backed last-known-status marker used
// to infer rejection from a CHANGE_PENDING -> CHANGE_REQUIRED transition) at the
// source level, in addition to device-status-mapping.test.ts's behavioral check
// on the actual mapping function.
test('device-context.tsx does not persist or infer a rejected-device state', () => {
  const source = readFileSync(join(process.cwd(), 'src/features/device/device-context.tsx'), 'utf8');

  assert.ok(!/AsyncStorage/.test(source), 'device-context.tsx must not read/write AsyncStorage');
  assert.ok(!/REJECTED/.test(source), 'device-context.tsx must not reference an invented REJECTED state');
  assert.ok(!/change_rejected/.test(source), 'device-context.tsx must not expose a change_rejected UI status');
});
