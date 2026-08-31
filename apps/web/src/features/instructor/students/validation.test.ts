import assert from "node:assert/strict";
import test from "node:test";
import { validateAddStudentInput } from "./validation";

test("requires an email before submitting the add-student form", () => {
  assert.deepEqual(validateAddStudentInput("", ""), { email: "required" });
  assert.deepEqual(validateAddStudentInput("   ", ""), { email: "required" });
});

test("rejects a malformed email", () => {
  assert.deepEqual(validateAddStudentInput("not-an-email", ""), { email: "invalid" });
});

test("trims the email before validating and accepts a well-formed one", () => {
  assert.deepEqual(validateAddStudentInput("  student@example.test  ", ""), {});
});

test("rejects an email longer than the backend's 320-character limit", () => {
  const longEmail = `${"a".repeat(313)}@test.com`; // > 320 chars total
  assert.equal(longEmail.length > 320, true);
  assert.deepEqual(validateAddStudentInput(longEmail, ""), { email: "invalid" });
});

test("flags a display name longer than the backend's 160-character limit", () => {
  assert.deepEqual(validateAddStudentInput("student@example.test", "a".repeat(161)), { displayName: "tooLong" });
});

test("accepts an empty display name and one within the limit", () => {
  assert.deepEqual(validateAddStudentInput("student@example.test", ""), {});
  assert.deepEqual(validateAddStudentInput("student@example.test", "a".repeat(160)), {});
});
