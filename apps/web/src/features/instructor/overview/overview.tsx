"use client";

import Link from "next/link";
import type { ReactNode } from "react";
import { useAuthenticatedInstructorSession } from "@/features/instructor/session-context";
import { useI18n } from "@/lib/i18n/i18n";
import type { TranslationKey } from "@/lib/i18n/translations";
import type { CourseStatus, CourseSummary, TenantStudentStatus, TenantStudentSummary } from "@/lib/api/types";
import { NavIcon } from "@/features/instructor/nav-icons";
import { buildHomeViewModel, type HomeAttentionItem, type HomeQuickAction } from "./home-view-model";
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
    </div>
  );
}

function OverviewBody({ data, onRetry }: { data: OverviewSnapshot; onRetry: () => void }) {
  const { t } = useI18n();
  const allFailed = data.courses === null && data.students === null && data.unreadNotifications === null;
  const viewModel = buildHomeViewModel(data);

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
      <section className="home-actions" aria-label={t("overview.quickActionsHeading")}>
        {viewModel.quickActions.map((action) => (
          <HomeActionLink action={action} key={action.id} />
        ))}
      </section>

      <AttentionSection items={viewModel.attention} onRetry={onRetry} />

      <div className="overview-grid">
        <PreviewCard
          headingId="overview-continue-heading"
          heading={t("overview.continueHeading")}
          viewAllHref="/instructor/courses"
          viewAllLabel={t("overview.continueViewAll")}
        >
          {viewModel.continueCourses === null ? (
            <UnavailableNote label={t("overview.coursesUnavailable")} onRetry={onRetry} />
          ) : viewModel.continueCourses.length === 0 ? (
            <EmptyPreview label={t("overview.continueEmpty")} section="courses" />
          ) : (
            <ul className="overview-list">
                {viewModel.continueCourses.map((course) => (
                  <CourseRow key={course.courseId} course={course} />
                ))}
            </ul>
          )}
        </PreviewCard>

        <PreviewCard
          headingId="overview-students-heading"
          heading={t("overview.studentsHeading")}
          viewAllHref="/instructor/students"
          viewAllLabel={t("overview.studentsViewAll")}
        >
          {viewModel.studentPreview === null ? (
            <UnavailableNote label={t("overview.studentsUnavailable")} onRetry={onRetry} />
          ) : viewModel.studentPreview.items.length === 0 ? (
            <EmptyPreview label={t("overview.studentsEmpty")} section="students" />
          ) : (
            <>
              <ul className="overview-list">
                {viewModel.studentPreview.items.map((student) => (
                  <StudentRow key={student.associationId} student={student} />
                ))}
              </ul>
              {viewModel.studentPreview.hasMore ? <p className="overview-more-note">{t("overview.studentsHasMoreNote")}</p> : null}
            </>
          )}
        </PreviewCard>
      </div>
    </>
  );
}

function HomeActionLink({ action }: { action: HomeQuickAction }) {
  const { t } = useI18n();
  const className = action.prominence === "primary" ? "primary-button compact-action" : "secondary-button compact-action";

  return (
    <Link className={className} href={action.href}>
      {t(action.labelKey)}
    </Link>
  );
}

function AttentionSection({ items, onRetry }: { items: HomeAttentionItem[]; onRetry: () => void }) {
  const { t } = useI18n();

  if (items.length === 0) {
    return null;
  }

  return (
    <section className="home-attention" aria-labelledby="overview-attention-heading">
      <div className="home-section-heading">
        <h3 id="overview-attention-heading">{t("overview.attentionHeading")}</h3>
      </div>
      <ul className="home-attention-list">
        {items.map((item) => (
          <li className={`home-attention-item home-attention-${item.tone}`} key={item.id}>
            <span className="notification-bell" aria-hidden="true">
              <NotificationBellIcon />
            </span>
            {item.href ? (
              <Link href={item.href} className="notification-status-link" title={t("overview.notificationsViewAll")}>
                {item.count ? <span className="notification-count">{item.count}</span> : null}
                <span>{t(item.labelKey)}</span>
                <ViewAllArrow />
              </Link>
            ) : (
              <span className="home-attention-copy">{t(item.labelKey)}</span>
            )}
            {item.tone === "warning" ? (
              <button className="ghost-button compact" type="button" onClick={onRetry}>
                {t("shell.retry")}
              </button>
            ) : null}
          </li>
        ))}
      </ul>
    </section>
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

/** Compact, tasteful empty state for a preview card - no illustration, just
    a quiet icon chip (reusing the shell's own nav iconography, not a new
    asset) paired with a clear answer to "what's empty here". */
function EmptyPreview({ label, section }: { label: string; section: "courses" | "students" }) {
  return (
    <div className="overview-empty">
      <span className="overview-empty-icon" aria-hidden="true">
        <NavIcon section={section} />
      </span>
      <p>{label}</p>
    </div>
  );
}

function ViewAllArrow() {
  return <span className="view-all-arrow" aria-hidden="true" />;
}

function NotificationBellIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
      <path d="M6 8.1a4 4 0 0 1 8 0c0 3.65 1.15 4.75 1.15 4.75H4.85S6 11.75 6 8.1Z" />
      <path d="M8.35 15.6a1.75 1.75 0 0 0 3.3 0" />
    </svg>
  );
}
