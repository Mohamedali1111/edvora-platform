import assert from "node:assert/strict";
import test from "node:test";
import type { CourseReadinessReasonCode, ReadinessIssue } from "../../../lib/api/types";
import { translations } from "../../../lib/i18n/translations";
import { groupIssuesByLessonId, lessonContentReadiness, readinessIssueMessage, readinessReasonKey } from "./readiness-copy";

const ALL_REASON_CODES: CourseReadinessReasonCode[] = [
  "SECTION_EMPTY",
  "LESSON_AVAILABILITY_WINDOW_ELAPSED",
  "VIDEO_PREPARING",
  "VIDEO_FAILED",
  "VIDEO_ASSET_ARCHIVED",
  "DOCUMENT_PREPARING",
  "DOCUMENT_FAILED",
  "DOCUMENT_ASSET_ARCHIVED",
  "QUIZ_ARCHIVED",
  "QUIZ_NOT_PUBLISHABLE_NO_QUESTIONS",
  "QUIZ_NOT_PUBLISHABLE_MISSING_CORRECT_OPTION",
  "QUIZ_NOT_PUBLISHABLE_INVALID_POINTS",
  "SECTION_NOT_SELECTABLE",
  "LESSON_NOT_SELECTABLE",
  "LESSON_SECTION_NOT_INCLUDED",
];

const JARGON_PATTERNS = [
  /bunny/i,
  /\bR2\b/,
  /processingStatus/i,
  /relation missing/i,
  /QUIZ_ARCHIVED/,
  /_NOT_PUBLISHABLE_/,
  /reasonCode/i,
];

test("every CourseReadinessReasonCode has a mapped translation key", () => {
  for (const code of ALL_REASON_CODES) {
    assert.equal(typeof readinessReasonKey(code), "string");
  }
});

test("no reason code's EN or AR copy leaks a raw backend/provider term", () => {
  for (const code of ALL_REASON_CODES) {
    const key = readinessReasonKey(code);
    const en = translations.en[key];
    const ar = translations.ar[key];

    for (const pattern of JARGON_PATTERNS) {
      assert.equal(pattern.test(en), false, `EN copy for ${code} matched forbidden pattern ${pattern}: "${en}"`);
      assert.equal(pattern.test(ar), false, `AR copy for ${code} matched forbidden pattern ${pattern}: "${ar}"`);
    }
  }
});

test("readinessIssueMessage fills {title} with the issue's own real title, not a placeholder", () => {
  const issue: ReadinessIssue = {
    reasonCode: "VIDEO_FAILED",
    entityType: "VIDEO_ASSET",
    entityId: "asset-1",
    parentLessonId: "lesson-1",
    title: "Intro to Algebra",
  };

  const message = readinessIssueMessage(issue, (key) => translations.en[key]);
  assert.equal(message.includes("Intro to Algebra"), true);
  assert.equal(message.includes("{title}"), false);
});

test("lessonContentReadiness returns null for a lesson with no blockers", () => {
  assert.equal(lessonContentReadiness([]), null);
});

test("lessonContentReadiness prioritizes failed over needsAttention and processing", () => {
  const blockers: ReadinessIssue[] = [
    { reasonCode: "VIDEO_PREPARING", entityType: "VIDEO_ASSET", entityId: "a", parentLessonId: "l" },
    { reasonCode: "QUIZ_NOT_PUBLISHABLE_NO_QUESTIONS", entityType: "QUIZ", entityId: "q", parentLessonId: "l" },
    { reasonCode: "VIDEO_FAILED", entityType: "VIDEO_ASSET", entityId: "a", parentLessonId: "l" },
  ];

  assert.equal(lessonContentReadiness(blockers), "failed");
});

test("lessonContentReadiness prioritizes needsAttention over processing", () => {
  const blockers: ReadinessIssue[] = [
    { reasonCode: "VIDEO_PREPARING", entityType: "VIDEO_ASSET", entityId: "a", parentLessonId: "l" },
    { reasonCode: "QUIZ_ARCHIVED", entityType: "QUIZ", entityId: "q", parentLessonId: "l" },
  ];

  assert.equal(lessonContentReadiness(blockers), "needsAttention");
});

test("lessonContentReadiness reports processing when that's the only issue", () => {
  const blockers: ReadinessIssue[] = [{ reasonCode: "DOCUMENT_PREPARING", entityType: "DOCUMENT_ASSET", entityId: "d", parentLessonId: "l" }];
  assert.equal(lessonContentReadiness(blockers), "processing");
});

test("groupIssuesByLessonId groups only issues that carry a parentLessonId", () => {
  const issues: ReadinessIssue[] = [
    { reasonCode: "VIDEO_FAILED", entityType: "VIDEO_ASSET", entityId: "a", parentLessonId: "lesson-1" },
    { reasonCode: "SECTION_EMPTY", entityType: "SECTION", entityId: "s" },
    { reasonCode: "DOCUMENT_PREPARING", entityType: "DOCUMENT_ASSET", entityId: "d", parentLessonId: "lesson-1" },
    { reasonCode: "VIDEO_PREPARING", entityType: "VIDEO_ASSET", entityId: "b", parentLessonId: "lesson-2" },
  ];

  const grouped = groupIssuesByLessonId(issues);
  assert.equal(grouped.size, 2);
  assert.equal(grouped.get("lesson-1")?.length, 2);
  assert.equal(grouped.get("lesson-2")?.length, 1);
});
