import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';

// Regression guard for Blocker 1 (activation token must never live in a URL): a
// one-time activation secret must only ever come from explicit runtime user
// input on this screen, never a route/query param or a deep link. Component
// rendering isn't exercised by this harness (see the Tests section of the
// milestone report), so this locks the specific forbidden pattern out of the
// source directly — if someone reintroduces `useLocalSearchParams`/route-param
// prefill here, this test fails immediately rather than only in manual QA.
test('activate-screen.tsx never sources the activation token from route/query params', () => {
  const source = readFileSync(join(process.cwd(), 'src/features/auth/activate-screen.tsx'), 'utf8');

  assert.ok(!/useLocalSearchParams/.test(source), 'must not read the activation token from expo-router search params');
  assert.ok(!/useSearchParams/.test(source), 'must not read the activation token from search params');
  assert.ok(!/params\.token/.test(source), 'must not prefill the activation token from a route param');
});
