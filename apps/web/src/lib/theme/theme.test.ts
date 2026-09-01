import assert from "node:assert/strict";
import test from "node:test";
import { resolveStoredTheme, resolveSystemTheme } from "./theme";

test("resolves a persisted theme preference, defaulting unset/invalid values to system", () => {
  assert.equal(resolveStoredTheme({ getItem: () => "light" }), "light");
  assert.equal(resolveStoredTheme({ getItem: () => "dark" }), "dark");
  assert.equal(resolveStoredTheme({ getItem: () => "system" }), "system");
  assert.equal(resolveStoredTheme({ getItem: () => null }), "system");
  assert.equal(resolveStoredTheme({ getItem: () => "auto" }), "system");
  assert.equal(resolveStoredTheme({ getItem: () => "" }), "system");
});

test("resolves the system theme from the dark-mode media query match", () => {
  assert.equal(resolveSystemTheme({ matches: true }), "dark");
  assert.equal(resolveSystemTheme({ matches: false }), "light");
});
