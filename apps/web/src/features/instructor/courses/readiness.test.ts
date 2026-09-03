import assert from "node:assert/strict";
import test from "node:test";
import { deriveCourseReadiness, resolveContentReadiness, type ReadinessSectionInput } from "./readiness";

function section(overrides: Partial<ReadinessSectionInput> = {}): ReadinessSectionInput {
  return { sectionId: "s1", title: "Section", status: "PUBLISHED", lessons: [], ...overrides };
}

test("a fully published course with all content READY produces a clean, empty readiness state", () => {
  const readiness = deriveCourseReadiness({
    sections: [
      section({
        lessons: [
          { lessonId: "l1", title: "Intro video", status: "PUBLISHED", type: "VIDEO", contentReadiness: "READY" },
          { lessonId: "l2", title: "Handout", status: "PUBLISHED", type: "DOCUMENT", contentReadiness: "READY" },
          { lessonId: "l3", title: "Quiz", status: "PUBLISHED", type: "QUIZ", contentReadiness: "READY" },
        ],
      }),
    ],
  });

  assert.equal(readiness.ready, true);
  assert.deepEqual(readiness.blockers, []);
});

test("a course with no sections at all is trivially ready (nothing to block on)", () => {
  assert.deepEqual(deriveCourseReadiness({ sections: [] }), { ready: true, blockers: [] });
});

test("identifies a Draft section as a single blocker and does not also report its lessons", () => {
  const readiness = deriveCourseReadiness({
    sections: [
      section({
        title: "Week 1",
        status: "DRAFT",
        lessons: [{ lessonId: "l1", title: "Should not appear", status: "DRAFT", type: "VIDEO", contentReadiness: "NOT_READY" }],
      }),
    ],
  });

  assert.deepEqual(readiness.ready, false);
  assert.deepEqual(readiness.blockers, [{ kind: "draftSection", sectionTitle: "Week 1" }]);
});

test("identifies a Draft lesson under an otherwise-published section", () => {
  const readiness = deriveCourseReadiness({
    sections: [
      section({
        lessons: [{ lessonId: "l1", title: "Week 1 PDF", status: "DRAFT", type: "DOCUMENT", contentReadiness: "READY" }],
      }),
    ],
  });

  assert.deepEqual(readiness.blockers, [{ kind: "draftLesson", lessonTitle: "Week 1 PDF" }]);
});

test("identifies a still-processing video as a blocker, distinct from a draft lesson", () => {
  const readiness = deriveCourseReadiness({
    sections: [
      section({
        lessons: [{ lessonId: "l1", title: "Welcome", status: "PUBLISHED", type: "VIDEO", contentReadiness: "NOT_READY" }],
      }),
    ],
  });

  assert.deepEqual(readiness.blockers, [{ kind: "contentNotReady", lessonTitle: "Welcome", contentType: "VIDEO" }]);
});

test("identifies an unpublished quiz behind a published lesson as a blocker", () => {
  const readiness = deriveCourseReadiness({
    sections: [
      section({
        lessons: [{ lessonId: "l1", title: "Basics", status: "PUBLISHED", type: "QUIZ", contentReadiness: "NOT_READY" }],
      }),
    ],
  });

  assert.deepEqual(readiness.blockers, [{ kind: "contentNotReady", lessonTitle: "Basics", contentType: "QUIZ" }]);
});

test("surfaces an unverifiable content reference as its own honest 'unknown' blocker, never as ready", () => {
  const readiness = deriveCourseReadiness({
    sections: [
      section({
        lessons: [{ lessonId: "l1", title: "Mystery video", status: "PUBLISHED", type: "VIDEO", contentReadiness: "UNKNOWN" }],
      }),
    ],
  });

  assert.equal(readiness.ready, false);
  assert.deepEqual(readiness.blockers, [{ kind: "contentUnknown", lessonTitle: "Mystery video", contentType: "VIDEO" }]);
});

test("archived sections and lessons are excluded entirely - not a blocker, not evidence of readiness", () => {
  const readiness = deriveCourseReadiness({
    sections: [
      section({ status: "ARCHIVED", lessons: [{ lessonId: "l1", title: "Old", status: "DRAFT", type: "VIDEO", contentReadiness: "NOT_READY" }] }),
      section({
        sectionId: "s2",
        lessons: [{ lessonId: "l2", title: "Retired lesson", status: "ARCHIVED", type: "DOCUMENT", contentReadiness: "NOT_READY" }],
      }),
    ],
  });

  assert.deepEqual(readiness, { ready: true, blockers: [] });
});

test("derivation is deterministic - the same input always produces the same blocker list, in the same order", () => {
  const input = {
    sections: [
      section({ status: "DRAFT", title: "Draft section" }),
      section({
        sectionId: "s2",
        lessons: [
          { lessonId: "l1", title: "Draft lesson", status: "DRAFT" as const, type: "DOCUMENT" as const, contentReadiness: "READY" as const },
          { lessonId: "l2", title: "Processing video", status: "PUBLISHED" as const, type: "VIDEO" as const, contentReadiness: "NOT_READY" as const },
        ],
      }),
    ],
  };

  assert.deepEqual(deriveCourseReadiness(input), deriveCourseReadiness(input));
});

test("resolveContentReadiness maps a READY video/document and a PUBLISHED quiz to READY, everything else to NOT_READY", () => {
  const lookups = {
    videoStatus: new Map([
      ["v-ready", "READY" as const],
      ["v-processing", "PROCESSING" as const],
    ]),
    documentStatus: new Map([["d-ready", "READY" as const]]),
    quizStatus: new Map([
      ["q-published", "PUBLISHED" as const],
      ["q-draft", "DRAFT" as const],
    ]),
  };

  assert.equal(
    resolveContentReadiness({ type: "VIDEO", videoAssetId: "v-ready", documentAssetId: null, quizId: null }, lookups),
    "READY",
  );
  assert.equal(
    resolveContentReadiness({ type: "VIDEO", videoAssetId: "v-processing", documentAssetId: null, quizId: null }, lookups),
    "NOT_READY",
  );
  assert.equal(
    resolveContentReadiness({ type: "DOCUMENT", videoAssetId: null, documentAssetId: "d-ready", quizId: null }, lookups),
    "READY",
  );
  assert.equal(
    resolveContentReadiness({ type: "QUIZ", videoAssetId: null, documentAssetId: null, quizId: "q-published" }, lookups),
    "READY",
  );
  assert.equal(
    resolveContentReadiness({ type: "QUIZ", videoAssetId: null, documentAssetId: null, quizId: "q-draft" }, lookups),
    "NOT_READY",
  );
});

test("resolveContentReadiness reports UNKNOWN for a reference not found in the fetched lookups, never guessing READY", () => {
  const emptyLookups = { videoStatus: new Map(), documentStatus: new Map(), quizStatus: new Map() };

  assert.equal(
    resolveContentReadiness({ type: "VIDEO", videoAssetId: "missing", documentAssetId: null, quizId: null }, emptyLookups),
    "UNKNOWN",
  );
  assert.equal(resolveContentReadiness({ type: "QUIZ", videoAssetId: null, documentAssetId: null, quizId: null }, emptyLookups), "UNKNOWN");
});
