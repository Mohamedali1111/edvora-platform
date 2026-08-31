import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import { instructorSections, resolveInstructorSection } from "./navigation";

test("resolves the active section for every known top-level route", () => {
  for (const section of instructorSections) {
    assert.equal(resolveInstructorSection(section.href), section.id);
  }
});

test("resolves the active section for a nested path under a known route", () => {
  assert.equal(resolveInstructorSection("/instructor/courses/course-123"), "courses");
  assert.equal(resolveInstructorSection("/instructor/students/student-1/detail"), "students");
});

test("returns null for an unknown instructor path instead of guessing a default section", () => {
  assert.equal(resolveInstructorSection("/instructor/does-not-exist"), null);
  assert.equal(resolveInstructorSection("/instructor"), null);
  assert.equal(resolveInstructorSection("/"), null);
});

test("does not confuse one section's href for a prefix match of another", () => {
  // "/instructor/coursesish" must not resolve to "courses" just because it starts with the same letters.
  assert.equal(resolveInstructorSection("/instructor/coursesish"), null);
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
