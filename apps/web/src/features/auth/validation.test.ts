import assert from "node:assert/strict";
import test from "node:test";
import { MIN_PASSWORD_LENGTH, validateActivationInput } from "./validation";

function input(overrides: Partial<Parameters<typeof validateActivationInput>[0]> = {}) {
  return {
    activationToken: "a-valid-activation-token",
    newPassword: "a-strong-password-123",
    confirmPassword: "a-strong-password-123",
    ...overrides,
  };
}

test("requires an activation token before submitting", () => {
  assert.deepEqual(validateActivationInput(input({ activationToken: "" })), { activationToken: "required" });
  assert.deepEqual(validateActivationInput(input({ activationToken: "   " })), { activationToken: "required" });
});

test("requires a new password and enforces the backend's exact minimum length", () => {
  assert.deepEqual(validateActivationInput(input({ newPassword: "", confirmPassword: "" })), { newPassword: "required" });
  const tooShort = "a".repeat(MIN_PASSWORD_LENGTH - 1);
  assert.deepEqual(validateActivationInput(input({ newPassword: tooShort, confirmPassword: tooShort })), {
    newPassword: "tooShort",
  });
  const exactlyMin = "a".repeat(MIN_PASSWORD_LENGTH);
  assert.deepEqual(validateActivationInput(input({ newPassword: exactlyMin, confirmPassword: exactlyMin })), {});
});

test("flags a mismatched confirmation only when the password itself is otherwise valid", () => {
  assert.deepEqual(
    validateActivationInput(input({ newPassword: "a-strong-password-123", confirmPassword: "different-password-456" })),
    { confirmPassword: "mismatch" },
  );

  // A too-short password reports its own error rather than a compounding mismatch error - the
  // confirmation check never runs when the primary field already failed.
  const tooShort = "short";
  assert.deepEqual(validateActivationInput(input({ newPassword: tooShort, confirmPassword: "something-else" })), {
    newPassword: "tooShort",
  });
});

test("accepts a fully valid submission with no errors", () => {
  assert.deepEqual(validateActivationInput(input()), {});
});
