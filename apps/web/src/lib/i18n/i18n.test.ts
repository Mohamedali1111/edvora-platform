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

test("keeps Instructor product vocabulary out of backend/provider language", () => {
  assert.match(translations.en["courses.createDialogCopy"], /chapters/);
  assert.doesNotMatch(translations.en["courses.createDialogCopy"], /sections/i);
  assert.equal(translations.en["lessons.quizStatusPublished"], "Live");
  assert.equal(translations.ar["lessons.quizStatusPublished"], "مباشر");
  assert.doesNotMatch(translations.en["media.uploadStateVideoQueued"], /Bunny|R2|backend/i);
  assert.doesNotMatch(translations.ar["media.uploadStateVideoQueued"], /Bunny|R2|backend/i);
  assert.doesNotMatch(translations.en["quizzes.publishRequirementsIntro"], /backend/i);
});
