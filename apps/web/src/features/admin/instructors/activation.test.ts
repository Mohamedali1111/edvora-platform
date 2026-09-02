import assert from "node:assert/strict";
import test from "node:test";
import type { InstructorActivationState } from "@/lib/api/types";
import { canReissueActivation, INSTRUCTOR_ACTIVATION_STATE_KEY } from "./activation";

test("offers reissue for both not-yet-activated states, mirroring the backend's own gate exactly", () => {
  assert.equal(canReissueActivation("PENDING_ACTIVATION"), true);
  assert.equal(canReissueActivation("ACTIVATION_EXPIRED"), true);
});

test("never offers reissue for an already-activated instructor", () => {
  assert.equal(canReissueActivation("ACTIVATED"), false);
});

test("every InstructorActivationState has a distinct translation key", () => {
  const states: InstructorActivationState[] = ["PENDING_ACTIVATION", "ACTIVATED", "ACTIVATION_EXPIRED"];
  const keys = states.map((state) => INSTRUCTOR_ACTIVATION_STATE_KEY[state]);

  assert.equal(keys.every((key) => typeof key === "string" && key.length > 0), true);
  assert.equal(new Set(keys).size, states.length);
});
