import assert from "node:assert/strict";
import test from "node:test";
import { validateCourseInput } from "./validation";

test("requires a title before submitting", () => {
  assert.deepEqual(validateCourseInput("", ""), { title: "required" });
  assert.deepEqual(validateCourseInput("   ", ""), { title: "required" });
});

test("trims the title before validating and accepts a well-formed one", () => {
  assert.deepEqual(validateCourseInput("  Intro to Algebra  ", ""), {});
});

test("rejects a title longer than the backend's 240-character limit", () => {
  assert.deepEqual(validateCourseInput("a".repeat(241), ""), { title: "tooLong" });
  assert.deepEqual(validateCourseInput("a".repeat(240), ""), {});
});

test("flags a description longer than the backend's 5000-character limit", () => {
  assert.deepEqual(validateCourseInput("Title", "a".repeat(5001)), { description: "tooLong" });
  assert.deepEqual(validateCourseInput("Title", "a".repeat(5000)), {});
});

test("accepts an empty description", () => {
  assert.deepEqual(validateCourseInput("Title", ""), {});
});
