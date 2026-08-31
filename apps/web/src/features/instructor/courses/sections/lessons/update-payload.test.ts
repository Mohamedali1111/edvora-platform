import assert from "node:assert/strict";
import test from "node:test";
import { buildLessonUpdatePayload, type LessonAvailabilitySnapshot } from "./update-payload";

const UNTOUCHED_TIMESTAMP: LessonAvailabilitySnapshot = {
  // Minute-precision seed, as `toDateTimeLocalValue` would produce for a
  // server value that actually carries seconds (e.g. "...T14:37:22.000Z").
  // The point under test is that this snapshot value is never resent as-is.
  availableFromInput: "2026-09-01T14:37",
  availableUntilInput: "2026-10-01T09:00",
};

const NULL_SNAPSHOT: LessonAvailabilitySnapshot = {
  availableFromInput: "",
  availableUntilInput: "",
};

test("title-only edit omits availableFrom/availableUntil entirely - it does not resend or replace the existing server timestamp", () => {
  const payload = buildLessonUpdatePayload(UNTOUCHED_TIMESTAMP, {
    title: "New title",
    description: "",
    availableFromInput: UNTOUCHED_TIMESTAMP.availableFromInput,
    availableUntilInput: UNTOUCHED_TIMESTAMP.availableUntilInput,
  });

  assert.equal(payload.title, "New title");
  assert.equal("availableFrom" in payload, false);
  assert.equal("availableUntil" in payload, false);
});

test("unchanged existing availability is never serialized, even when the input was re-entered at the same seeded value", () => {
  const payload = buildLessonUpdatePayload(UNTOUCHED_TIMESTAMP, {
    title: "Unrelated title edit",
    description: "Unrelated description edit",
    availableFromInput: "2026-09-01T14:37",
    availableUntilInput: "2026-10-01T09:00",
  });

  assert.equal("availableFrom" in payload, false);
  assert.equal("availableUntil" in payload, false);
});

test("clearing an existing availability value sends an explicit null", () => {
  const payload = buildLessonUpdatePayload(UNTOUCHED_TIMESTAMP, {
    title: "Title",
    description: "",
    availableFromInput: "",
    availableUntilInput: UNTOUCHED_TIMESTAMP.availableUntilInput,
  });

  assert.equal(payload.availableFrom, null);
  assert.equal("availableUntil" in payload, false);
});

test("changing an availability value sends a full ISO instant, not the raw local input string", () => {
  const payload = buildLessonUpdatePayload(UNTOUCHED_TIMESTAMP, {
    title: "Title",
    description: "",
    availableFromInput: "2026-09-01T16:15",
    availableUntilInput: UNTOUCHED_TIMESTAMP.availableUntilInput,
  });

  assert.equal("availableFrom" in payload, true);
  assert.notEqual(payload.availableFrom, "2026-09-01T16:15");
  assert.match(payload.availableFrom as string, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
  assert.equal(new Date(payload.availableFrom as string).getTime(), new Date("2026-09-01T16:15").getTime());
});

test("a lesson with no existing availability that is left untouched still omits both fields", () => {
  const payload = buildLessonUpdatePayload(NULL_SNAPSHOT, {
    title: "Title",
    description: "",
    availableFromInput: "",
    availableUntilInput: "",
  });

  assert.equal("availableFrom" in payload, false);
  assert.equal("availableUntil" in payload, false);
});

test("entering a value on a previously-null availability field sends the converted ISO instant", () => {
  const payload = buildLessonUpdatePayload(NULL_SNAPSHOT, {
    title: "Title",
    description: "",
    availableFromInput: "2026-11-01T08:30",
    availableUntilInput: "",
  });

  assert.equal("availableFrom" in payload, true);
  assert.equal(new Date(payload.availableFrom as string).getTime(), new Date("2026-11-01T08:30").getTime());
  assert.equal("availableUntil" in payload, false);
});

test("description is trimmed and empty description is sent as null, independent of availability handling", () => {
  const payload = buildLessonUpdatePayload(UNTOUCHED_TIMESTAMP, {
    title: "Title",
    description: "   ",
    availableFromInput: UNTOUCHED_TIMESTAMP.availableFromInput,
    availableUntilInput: UNTOUCHED_TIMESTAMP.availableUntilInput,
  });

  assert.equal(payload.description, null);
});
