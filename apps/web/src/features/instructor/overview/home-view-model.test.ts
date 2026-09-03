import assert from "node:assert/strict";
import test from "node:test";
import type { CourseStatus, CourseSummary, TenantStudentStatus, TenantStudentSummary } from "@/lib/api/types";
import { buildHomeViewModel } from "./home-view-model";
import type { OverviewSnapshot } from "./overview-service";

function course(courseId: string, status: CourseStatus): CourseSummary {
  return {
    courseId,
    tenantId: "tenant-1",
    createdByUserId: "user-1",
    title: courseId,
    description: null,
    thumbnailAssetRef: null,
    status,
    visibility: "PRIVATE",
    publishedAt: status === "PUBLISHED" ? "2026-01-01T00:00:00.000Z" : null,
    archivedAt: status === "ARCHIVED" ? "2026-01-02T00:00:00.000Z" : null,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-03T00:00:00.000Z",
  };
}

function student(associationId: string, status: TenantStudentStatus): TenantStudentSummary {
  return {
    associationId,
    tenantId: "tenant-1",
    userId: `user-${associationId}`,
    email: `${associationId}@example.test`,
    displayName: null,
    accountStatus: "ACTIVE",
    status,
    activatedAt: null,
    createdAt: "2026-01-01T00:00:00.000Z",
  };
}

test("bounded Draft preview can populate Continue building without deriving unsupported metrics", () => {
  const snapshot: OverviewSnapshot = {
    courses: { items: [course("draft-1", "DRAFT"), course("live-1", "PUBLISHED"), course("draft-2", "DRAFT")], hasMore: true },
    students: { items: [student("student-1", "ACTIVE")], hasMore: false },
    unreadNotifications: 0,
  };

  const model = buildHomeViewModel(snapshot);

  assert.deepEqual(
    model.quickActions.map((action) => action.id),
    ["create-course", "add-student", "upload-content", "create-quiz"],
  );
  assert.deepEqual(
    model.continueCourses?.map((item) => item.courseId),
    ["draft-1", "draft-2"],
  );
  assert.equal(Object.hasOwn(model, "courseCount"), false);
  assert.equal(Object.hasOwn(model, "studentCount"), false);
  assert.equal(Object.hasOwn(model, "completionRate"), false);
});

test("surfaces unread notifications and unavailable preview data as attention", () => {
  const snapshot: OverviewSnapshot = {
    courses: null,
    students: { items: [], hasMore: false },
    unreadNotifications: 3,
  };

  const model = buildHomeViewModel(snapshot);

  assert.deepEqual(
    model.attention.map((item) => item.id),
    ["unread-notifications", "courses-unavailable"],
  );
  assert.equal(model.attention[0]?.count, 3);
  assert.equal(model.continueCourses, null);
});

test("bounded Course data never produces an authoritative all-clear attention claim", () => {
  const snapshot: OverviewSnapshot = {
    courses: { items: [course("live-preview", "PUBLISHED")], hasMore: true },
    students: { items: [], hasMore: false },
    unreadNotifications: 0,
  };

  const model = buildHomeViewModel(snapshot);

  assert.deepEqual(model.attention, []);
});

test("empty bounded Course preview does not mean no Draft Courses exist globally", () => {
  const snapshot: OverviewSnapshot = {
    courses: { items: [], hasMore: true },
    students: { items: [], hasMore: false },
    unreadNotifications: 0,
  };

  const model = buildHomeViewModel(snapshot);

  assert.deepEqual(model.continueCourses, []);
  assert.deepEqual(model.attention, []);
});
