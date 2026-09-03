import assert from "node:assert/strict";
import test from "node:test";
import { getLibraryTab, legacyMediaDestination, libraryTabs, resolveLibraryContentType } from "./library";

test("library supports videos, documents, and quizzes in the intended order", () => {
  assert.deepEqual(
    libraryTabs.map((tab) => tab.id),
    ["videos", "documents", "quizzes"],
  );
});

test("resolves library content type from canonical Library paths", () => {
  assert.equal(resolveLibraryContentType("/instructor/library"), "videos");
  assert.equal(resolveLibraryContentType("/instructor/library/videos"), "videos");
  assert.equal(resolveLibraryContentType("/instructor/library/documents"), "documents");
  assert.equal(resolveLibraryContentType("/instructor/library/quizzes"), "quizzes");
});

test("legacy media compatibility uses the neutral Library destination", () => {
  assert.equal(legacyMediaDestination, "/instructor/library");
  assert.equal(resolveLibraryContentType(legacyMediaDestination), "videos");
});

test("resolves legacy quiz paths to the matching Library tab", () => {
  assert.equal(resolveLibraryContentType("/instructor/quizzes"), "quizzes");
  assert.equal(resolveLibraryContentType("/instructor/quizzes/quiz-1"), "quizzes");
});

test("returns the current tab metadata for the active Library content type", () => {
  assert.equal(getLibraryTab("videos").href, "/instructor/library/videos");
  assert.equal(getLibraryTab("documents").actionKey, "media.uploadDocumentAction");
  assert.equal(getLibraryTab("quizzes").actionKey, "quizzes.createAction");
});
