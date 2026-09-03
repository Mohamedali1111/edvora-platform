import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import { instructorMobileSections, instructorPrimarySections, resolveInstructorSection } from "./navigation";

test("resolves the active section for every known top-level route", () => {
  for (const section of instructorPrimarySections) {
    assert.equal(resolveInstructorSection(section.href), section.id);
  }
});

test("resolves home routes through the existing overview destination", () => {
  assert.equal(resolveInstructorSection("/instructor"), "home");
  assert.equal(resolveInstructorSection("/instructor/overview"), "home");
});

test("resolves course list, detail, and edit descendants to Courses", () => {
  assert.equal(resolveInstructorSection("/instructor/courses"), "courses");
  assert.equal(resolveInstructorSection("/instructor/courses/course-123"), "courses");
  assert.equal(resolveInstructorSection("/instructor/courses/course-123/edit"), "courses");
});

test("resolves student list and detail descendants to Students", () => {
  assert.equal(resolveInstructorSection("/instructor/students"), "students");
  assert.equal(resolveInstructorSection("/instructor/students/student-1"), "students");
});

test("resolves library root and content descendants to Library", () => {
  assert.equal(resolveInstructorSection("/instructor/library"), "library");
  assert.equal(resolveInstructorSection("/instructor/library/videos"), "library");
  assert.equal(resolveInstructorSection("/instructor/library/documents/document-1"), "library");
  assert.equal(resolveInstructorSection("/instructor/library/quizzes/quiz-1"), "library");
});

test("keeps legacy media and quiz routes active under Library", () => {
  assert.equal(resolveInstructorSection("/instructor/media"), "library");
  assert.equal(resolveInstructorSection("/instructor/media/upload"), "library");
  assert.equal(resolveInstructorSection("/instructor/quizzes"), "library");
  assert.equal(resolveInstructorSection("/instructor/quizzes/quiz-1"), "library");
});

test("resolves progress and report descendants to Progress", () => {
  assert.equal(resolveInstructorSection("/instructor/progress"), "progress");
  assert.equal(resolveInstructorSection("/instructor/progress/course-1"), "progress");
  assert.equal(resolveInstructorSection("/instructor/reports/course-1"), "progress");
});

test("resolves secondary destinations to More", () => {
  assert.equal(resolveInstructorSection("/instructor/more"), "more");
  assert.equal(resolveInstructorSection("/instructor/notifications"), "more");
  assert.equal(resolveInstructorSection("/instructor/settings"), "more");
  assert.equal(resolveInstructorSection("/instructor/account/profile"), "more");
});

test("returns null for an unknown instructor path instead of guessing a default section", () => {
  assert.equal(resolveInstructorSection("/instructor/does-not-exist"), null);
  assert.equal(resolveInstructorSection("/"), null);
});

test("does not confuse one section's href for a prefix match of another", () => {
  // "/instructor/coursesish" must not resolve to "courses" just because it starts with the same letters.
  assert.equal(resolveInstructorSection("/instructor/coursesish"), null);
});

test("mobile navigation contains exactly the approved five destinations with no duplicate ids or routes", () => {
  assert.deepEqual(
    instructorMobileSections.map((section) => section.id),
    ["home", "courses", "students", "library", "more"],
  );
  assert.equal(new Set(instructorMobileSections.map((section) => section.id)).size, instructorMobileSections.length);
  assert.equal(new Set(instructorMobileSections.map((section) => section.href)).size, instructorMobileSections.length);
  assert.equal(instructorMobileSections.some((section) => section.id === "progress"), false);
});

test("desktop navigation has no duplicate ids or routes", () => {
  assert.equal(new Set(instructorPrimarySections.map((section) => section.id)).size, instructorPrimarySections.length);
  assert.equal(new Set(instructorPrimarySections.map((section) => section.href)).size, instructorPrimarySections.length);
});

test("navigation metadata has no runtime dependency on auth/session bootstrap, so a pathname change can never trigger it", () => {
  // Read the compiled output sitting next to this test (not the .ts source,
  // which isn't copied into .test-dist). Check for actual require() calls
  // rather than scanning prose/comments: this module has zero runtime
  // imports, so it cannot possibly reach into auth/session/bootstrap code -
  // pathname resolution and session bootstrap are fully separate modules.
  const compiled = readFileSync(join(__dirname, "navigation.js"), "utf8");
  assert.equal(/require\(/.test(compiled), false);
});
