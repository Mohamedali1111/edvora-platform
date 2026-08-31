import assert from "node:assert/strict";
import test from "node:test";
import { resolveStoredLocale } from "./i18n";
import { locales, translations } from "./translations";

test("resolves persisted language and direction", () => {
  assert.equal(resolveStoredLocale({ getItem: () => "ar" }), "ar");
  assert.equal(resolveStoredLocale({ getItem: () => "en" }), "en");
  assert.equal(resolveStoredLocale({ getItem: () => "fr" }), "en");
  assert.equal(locales.ar.dir, "rtl");
  assert.equal(locales.en.dir, "ltr");
});

test("keeps English and Arabic translation keys aligned", () => {
  assert.deepEqual(Object.keys(translations.ar).sort(), Object.keys(translations.en).sort());
});
