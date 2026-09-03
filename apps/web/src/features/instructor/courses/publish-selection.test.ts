import assert from "node:assert/strict";
import test from "node:test";
import type { ReadyToPublish } from "../../../lib/api/types";
import {
  buildPublishSelectedRequest,
  defaultSelectedLessonIds,
  deriveRequiredSectionIds,
  formatPublishSummary,
  groupLessonsBySection,
  isSelectionValid,
  toggleLessonSelected,
} from "./publish-selection";

const READY: ReadyToPublish = {
  sections: [
    { sectionId: "sec-draft", title: "Getting Started" },
    { sectionId: "sec-draft-2", title: "Advanced" },
  ],
  lessons: [
    { lessonId: "lesson-1", sectionId: "sec-draft", title: "Welcome", type: "VIDEO" },
    { lessonId: "lesson-2", sectionId: "sec-draft", title: "Setup", type: "DOCUMENT" },
    { lessonId: "lesson-3", sectionId: "sec-live", title: "Quiz time", type: "QUIZ" },
    { lessonId: "lesson-4", sectionId: "sec-draft-2", title: "Deep dive", type: "VIDEO" },
  ],
  quizzes: [],
};

test("default selection is derived only from server readyToPublish.lessons", () => {
  const selected = defaultSelectedLessonIds(READY);
  assert.deepEqual([...selected].sort(), ["lesson-1", "lesson-2", "lesson-3", "lesson-4"]);
});

test("toggling a lesson is a pure add/remove that never mutates the input set", () => {
  const original = new Set(["lesson-1"]);
  const added = toggleLessonSelected(original, "lesson-2");
  assert.deepEqual([...added].sort(), ["lesson-1", "lesson-2"]);
  assert.deepEqual([...original], ["lesson-1"]); // unchanged

  const removed = toggleLessonSelected(added, "lesson-1");
  assert.deepEqual([...removed], ["lesson-2"]);
});

test("selected lessons derive required Draft Chapter selection correctly", () => {
  const selected = new Set(["lesson-1", "lesson-2", "lesson-4"]);
  const required = deriveRequiredSectionIds(selected, READY.lessons, new Set());
  assert.deepEqual(required, ["sec-draft", "sec-draft-2"]);
});

test("a lesson under an already-Live chapter never requires that chapter to be selected", () => {
  const selected = new Set(["lesson-3"]);
  const required = deriveRequiredSectionIds(selected, READY.lessons, new Set(["sec-live"]));
  assert.deepEqual(required, []);
});

test("a mixed selection only requires the Draft chapters of currently-selected lessons", () => {
  const selected = new Set(["lesson-1", "lesson-3"]);
  const required = deriveRequiredSectionIds(selected, READY.lessons, new Set(["sec-live"]));
  assert.deepEqual(required, ["sec-draft"]);
});

test("an unselected ready lesson never appears in the request", () => {
  const selected = new Set(["lesson-1"]);
  const request = buildPublishSelectedRequest(selected, READY.lessons, new Set());
  assert.deepEqual(request.lessonIds, ["lesson-1"]);
  assert.equal(request.lessonIds.includes("lesson-2"), false);
});

test("zero lesson selection is invalid", () => {
  assert.equal(isSelectionValid(new Set()), false);
  assert.equal(isSelectionValid(new Set(["lesson-1"])), true);
});

test("the request contains only sectionIds and lessonIds - no quizIds field", () => {
  const selected = new Set(["lesson-1", "lesson-3"]);
  const request = buildPublishSelectedRequest(selected, READY.lessons, new Set(["sec-live"]));
  assert.deepEqual(Object.keys(request).sort(), ["lessonIds", "sectionIds"]);
  assert.deepEqual(request, { sectionIds: ["sec-draft"], lessonIds: ["lesson-1", "lesson-3"] });
});

test("groupLessonsBySection groups by chapter, preserving first-appearance order", () => {
  const groups = groupLessonsBySection(READY.lessons);
  assert.deepEqual(
    groups.map((group) => group.sectionId),
    ["sec-draft", "sec-live", "sec-draft-2"],
  );
  assert.deepEqual(
    groups.find((group) => group.sectionId === "sec-draft")?.lessons.map((lesson) => lesson.lessonId),
    ["lesson-1", "lesson-2"],
  );
});

test("required section order is deterministic, matching first appearance in lesson (display) order", () => {
  const selected = new Set(["lesson-4", "lesson-1"]); // selected out of display order
  const required = deriveRequiredSectionIds(selected, READY.lessons, new Set());
  // lessons array order is lesson-1 (sec-draft) before lesson-4 (sec-draft-2)
  assert.deepEqual(required, ["sec-draft", "sec-draft-2"]);
});

// ---- Publish summary presentation (decoupled from the mutation request) ----

test("EN: zero chapters omits the chapter phrase entirely and never says '0 chapters'", () => {
  assert.equal(formatPublishSummary(1, 0, "en"), "Publish 1 lesson?");
  assert.equal(formatPublishSummary(2, 0, "en"), "Publish 2 lessons?");
  assert.equal(formatPublishSummary(5, 0, "en"), "Publish 5 lessons?");
});

test("EN: one chapter reads 'in 1 chapter', singular/plural lessons both read naturally", () => {
  assert.equal(formatPublishSummary(1, 1, "en"), "Publish 1 lesson in 1 chapter?");
  assert.equal(formatPublishSummary(3, 1, "en"), "Publish 3 lessons in 1 chapter?");
});

test("EN: two or more chapters reads 'across N chapters'", () => {
  assert.equal(formatPublishSummary(2, 2, "en"), "Publish 2 lessons across 2 chapters?");
  assert.equal(formatPublishSummary(5, 3, "en"), "Publish 5 lessons across 3 chapters?");
});

test("AR: lesson count uses the correct grammatical form for 1 (واحد), 2 (dual - درسين), and 3+ (counted noun - N دروس)", () => {
  assert.equal(formatPublishSummary(1, 0, "ar"), "هل تريد نشر درس واحد؟");
  assert.equal(formatPublishSummary(2, 0, "ar"), "هل تريد نشر درسين؟");
  assert.equal(formatPublishSummary(3, 0, "ar"), "هل تريد نشر 3 دروس؟");
});

test("AR: chapter count uses the same dual/counted-noun forms, always introduced with في (never عبر)", () => {
  assert.equal(formatPublishSummary(1, 1, "ar"), "هل تريد نشر درس واحد في فصل واحد؟");
  assert.equal(formatPublishSummary(2, 1, "ar"), "هل تريد نشر درسين في فصل واحد؟");
  assert.equal(formatPublishSummary(2, 2, "ar"), "هل تريد نشر درسين في فصلين؟");
  assert.equal(formatPublishSummary(3, 2, "ar"), "هل تريد نشر 3 دروس في فصلين؟");
  assert.equal(formatPublishSummary(5, 3, "ar"), "هل تريد نشر 5 دروس في 3 فصول؟");
});

test("AR: zero chapters omits the chapter phrase entirely and never says '0 فصول'", () => {
  assert.equal(formatPublishSummary(2, 0, "ar"), "هل تريد نشر درسين؟");
  assert.ok(!formatPublishSummary(2, 0, "ar").includes("فصل"));
});

test("no rendered EN or AR summary ever mentions a bare zero", () => {
  const scenarios: Array<[number, number]> = [
    [1, 0],
    [5, 0],
    [1, 1],
    [3, 1],
    [2, 2],
    [5, 3],
  ];

  for (const [lessonCount, chapterCount] of scenarios) {
    for (const locale of ["en", "ar"] as const) {
      const rendered = formatPublishSummary(lessonCount, chapterCount, locale);
      assert.equal(/\b0\b/.test(rendered), false, `${locale} rendering (${lessonCount}, ${chapterCount}) unexpectedly mentions zero: "${rendered}"`);
    }
  }
});

test("summary presentation never changes the mutation request - sectionIds still contains only the Draft chapters the backend needs", () => {
  const selected = new Set(["lesson-3"]); // under an already-Live chapter
  const request = buildPublishSelectedRequest(selected, READY.lessons, new Set(["sec-live"]));

  assert.deepEqual(request, { sectionIds: [], lessonIds: ["lesson-3"] });
  assert.equal(formatPublishSummary(selected.size, request.sectionIds.length, "en"), "Publish 1 lesson?");
  assert.equal(formatPublishSummary(selected.size, request.sectionIds.length, "ar"), "هل تريد نشر درس واحد؟");
});
