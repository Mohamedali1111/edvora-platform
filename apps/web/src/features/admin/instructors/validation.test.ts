import assert from "node:assert/strict";
import test from "node:test";
import { normalizeTenantSlug, validateCreateInstructorInput } from "./validation";

function input(overrides: Partial<Parameters<typeof validateCreateInstructorInput>[0]> = {}) {
  return {
    email: "instructor@example.test",
    displayName: "",
    tenantName: "Example Academy",
    tenantSlug: "example-academy",
    ...overrides,
  };
}

test("requires an email before submitting the onboarding form", () => {
  assert.deepEqual(validateCreateInstructorInput(input({ email: "" })), { email: "required" });
  assert.deepEqual(validateCreateInstructorInput(input({ email: "   " })), { email: "required" });
});

test("rejects a malformed or overlong email", () => {
  assert.deepEqual(validateCreateInstructorInput(input({ email: "not-an-email" })), { email: "invalid" });
  const longEmail = `${"a".repeat(313)}@test.com`;
  assert.equal(longEmail.length > 320, true);
  assert.deepEqual(validateCreateInstructorInput(input({ email: longEmail })), { email: "invalid" });
});

test("flags a display name longer than the backend's 160-character limit, but accepts empty/within-limit", () => {
  assert.deepEqual(validateCreateInstructorInput(input({ displayName: "a".repeat(161) })), { displayName: "tooLong" });
  assert.deepEqual(validateCreateInstructorInput(input({ displayName: "a".repeat(160) })), {});
});

test("requires a tenant/academy name and rejects one over 160 characters", () => {
  assert.deepEqual(validateCreateInstructorInput(input({ tenantName: "" })), { tenantName: "required" });
  assert.deepEqual(validateCreateInstructorInput(input({ tenantName: "   " })), { tenantName: "required" });
  assert.deepEqual(validateCreateInstructorInput(input({ tenantName: "a".repeat(161) })), { tenantName: "tooLong" });
});

test("requires a tenant slug and enforces the backend's exact pattern/length", () => {
  assert.deepEqual(validateCreateInstructorInput(input({ tenantSlug: "" })), { tenantSlug: "required" });
  assert.deepEqual(validateCreateInstructorInput(input({ tenantSlug: "ab" })), { tenantSlug: "invalid" }); // < 3 chars
  assert.deepEqual(validateCreateInstructorInput(input({ tenantSlug: "a".repeat(121) })), { tenantSlug: "invalid" }); // > 120 chars
  assert.deepEqual(validateCreateInstructorInput(input({ tenantSlug: "Not_Valid!" })), { tenantSlug: "invalid" });
  assert.deepEqual(validateCreateInstructorInput(input({ tenantSlug: "--leading" })), { tenantSlug: "invalid" });
  assert.deepEqual(validateCreateInstructorInput(input({ tenantSlug: "trailing-" })), { tenantSlug: "invalid" });
});

test("accepts a well-formed slug after trim+lowercase normalization, matching the backend's own normalization", () => {
  assert.deepEqual(validateCreateInstructorInput(input({ tenantSlug: "  Example-Academy  " })), {});
});

test("accepts a fully valid submission with no errors", () => {
  assert.deepEqual(validateCreateInstructorInput(input()), {});
});

test("normalizeTenantSlug trims and lowercases exactly like the backend's own normalization", () => {
  assert.equal(normalizeTenantSlug("  Example-Academy  "), "example-academy");
});
