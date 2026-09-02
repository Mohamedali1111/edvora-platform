import assert from 'node:assert/strict';
import test from 'node:test';
import { locales, translations } from './translations';

test('keeps English and Arabic translation keys aligned', () => {
  assert.deepEqual(Object.keys(translations.ar).sort(), Object.keys(translations.en).sort());
});

test('locale directions are set correctly for RTL handling', () => {
  assert.equal(locales.en.dir, 'ltr');
  assert.equal(locales.ar.dir, 'rtl');
});

// Regression guard for Blocker 2: no translation key may claim a server-confirmed
// "rejected" device state the backend cannot substantiate (see
// device-status-mapping.ts). If this ever starts failing, it means someone added
// a `device.*rejected*` key back — the fix is to remove it, not to re-derive a
// client-side rejected status.
test('no translation key claims a backend-confirmed device-rejected state', () => {
  const deviceKeys = Object.keys(translations.en).filter((key) => key.startsWith('device.'));

  for (const key of deviceKeys) {
    assert.ok(!/rejected/i.test(key), `translation key "${key}" implies a rejected-device state the backend does not expose`);
  }
});
