"use client";

import Link from "next/link";
import type { ReactNode } from "react";
import { useAuthenticatedInstructorSession } from "@/features/instructor/session-context";
import { useI18n } from "@/lib/i18n/i18n";
import type { TranslationKey } from "@/lib/i18n/translations";
import type { CourseStatus, CourseSummary, TenantStudentStatus, TenantStudentSummary } from "@/lib/api/types";
import { useInstructorOverview, type OverviewSnapshot } from "./overview-service";

const COURSE_STATUS_KEY: Record<CourseStatus, TranslationKey> = {
  DRAFT: "status.courseDraft",
  PUBLISHED: "status.coursePublished",
  ARCHIVED: "status.courseArchived",
};

const STUDENT_STATUS_KEY: Record<TenantStudentStatus, TranslationKey> = {
  ACTIVE: "status.studentActive",
  INACTIVE: "status.studentInactive",
  REMOVED: "status.studentRemoved",
};

export function Overview() {
  const { user, tenant } = useAuthenticatedInstructorSession();
  const { t } = useI18n();
  const { state, retry } = useInstructorOverview(tenant.tenantId);

  return (
    <div className="overview">
      <header className="overview-intro">
        <p>{tenant.name}</p>
        <h2 id="overview-title">
          {t("overview.welcome")}, {user.displayName ?? user.email}
        </h2>
        <p className="overview-subtitle">{t("overview.copy")}</p>
      </header>

      {state.status === "loading" ? (
        <p className="overview-loading" role="status">
          {t("overview.loading")}
        </p>
      ) : (
        <OverviewBody data={state.data} onRetry={retry} />
      )}

      <div className="security-note">{t("overview.security")}</div>
    </div>
  );
}

function OverviewBody({ data, onRetry }: { data: OverviewSnapshot; onRetry: () => void }) {
  const { t } = useI18n();
  const allFailed = data.courses === null && data.students === null && data.unreadNotifications === null;

  if (allFailed) {
    return (
      <div className="overview-error" role="alert">
        <p>{t("overview.unavailable")}</p>
        <button className="secondary-button compact-action" type="button" onClick={onRetry}>
          {t("shell.retry")}
        </button>
      </div>
    );
  }

  return (
    <>
      <section className="notification-status" aria-label={t("overview.notificationsHeading")}>
        {data.unreadNotifications === null ? (
          <UnavailableNote label={t("overview.notificationsUnavailable")} onRetry={onRetry} />
        ) : (
          <Link href="/instructor/notifications" className="notification-status-link" title={t("overview.notificationsViewAll")}>
            {data.unreadNotifications === 0 ? (
              <span>{t("overview.notificationsAllCaughtUp")}</span>
            ) : (
              <>
                <span className="notification-count">{data.unreadNotifications}</span>
                <span>{t("overview.notificationsUnreadLabel")}</span>
              </>
            )}
            <ViewAllArrow />
          </Link>
        )}
      </section>

      <div className="overview-grid">
        <PreviewCard
          headingId="overview-courses-heading"
          heading={t("overview.coursesHeading")}
          viewAllHref="/instructor/courses"
          viewAllLabel={t("overview.coursesViewAll")}
        >
          {data.courses === null ? (
            <UnavailableNote label={t("overview.coursesUnavailable")} onRetry={onRetry} />
          ) : data.courses.items.length === 0 ? (
            <p className="overview-empty">{t("overview.coursesEmpty")}</p>
          ) : (
            <>
              <ul className="overview-list">
                {data.courses.items.map((course) => (
                  <CourseRow key={course.courseId} course={course} />
                ))}
              </ul>
              {data.courses.hasMore ? <p className="overview-more-note">{t("overview.coursesHasMoreNote")}</p> : null}
            </>
          )}
        </PreviewCard>

        <PreviewCard
          headingId="overview-students-heading"
          heading={t("overview.studentsHeading")}
          viewAllHref="/instructor/students"
          viewAllLabel={t("overview.studentsViewAll")}
        >
          {data.students === null ? (
            <UnavailableNote label={t("overview.studentsUnavailable")} onRetry={onRetry} />
          ) : data.students.items.length === 0 ? (
            <p className="overview-empty">{t("overview.studentsEmpty")}</p>
          ) : (
            <>
              <ul className="overview-list">
                {data.students.items.map((student) => (
                  <StudentRow key={student.associationId} student={student} />
                ))}
              </ul>
              {data.students.hasMore ? <p className="overview-more-note">{t("overview.studentsHasMoreNote")}</p> : null}
            </>
          )}
        </PreviewCard>
      </div>
    </>
  );
}

function PreviewCard({
  headingId,
  heading,
  viewAllHref,
  viewAllLabel,
  children,
}: {
  headingId: string;
  heading: string;
  viewAllHref: string;
  viewAllLabel: string;
  children: ReactNode;
}) {
  return (
    <section className="overview-card" aria-labelledby={headingId}>
      <div className="overview-card-header">
        <h3 id={headingId}>{heading}</h3>
        <Link href={viewAllHref} className="overview-view-all">
          {viewAllLabel}
          <ViewAllArrow />
        </Link>
      </div>
      {children}
    </section>
  );
}

function CourseRow({ course }: { course: CourseSummary }) {
  const { t } = useI18n();

  return (
    <li className="overview-list-item">
      <strong>{course.title}</strong>
      <span className={`status-badge status-badge-${course.status.toLowerCase()}`}>
        {t(COURSE_STATUS_KEY[course.status])}
      </span>
    </li>
  );
}

function StudentRow({ student }: { student: TenantStudentSummary }) {
  const { t } = useI18n();

  return (
    <li className="overview-list-item">
      <strong>{student.displayName ?? student.email}</strong>
      <span className={`status-badge status-badge-${student.status.toLowerCase()}`}>
        {t(STUDENT_STATUS_KEY[student.status])}
      </span>
    </li>
  );
}

function UnavailableNote({ label, onRetry }: { label: string; onRetry: () => void }) {
  const { t } = useI18n();

  return (
    <p className="overview-unavailable">
      {label}{" "}
      <button className="ghost-button compact" type="button" onClick={onRetry}>
        {t("shell.retry")}
      </button>
    </p>
  );
}

function ViewAllArrow() {
  return <span className="view-all-arrow" aria-hidden="true" />;
}
