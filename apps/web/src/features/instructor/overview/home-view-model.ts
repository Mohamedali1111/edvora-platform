import type { CourseSummary, TenantStudentSummary } from "@/lib/api/types";
import type { TranslationKey } from "@/lib/i18n/translations";
import type { OverviewSnapshot, PreviewList } from "./overview-service";

export type HomeQuickAction = {
  id: "create-course" | "add-student" | "upload-content" | "create-quiz";
  href: string;
  labelKey: TranslationKey;
  prominence: "primary" | "secondary";
};

export type HomeAttentionItem = {
  id: "unread-notifications" | "courses-unavailable" | "students-unavailable" | "notifications-unavailable";
  labelKey: TranslationKey;
  href?: string;
  count?: number;
  tone: "accent" | "muted" | "warning";
};

export type HomeViewModel = {
  attention: HomeAttentionItem[];
  continueCourses: CourseSummary[] | null;
  studentPreview: PreviewList<TenantStudentSummary> | null;
  quickActions: HomeQuickAction[];
};

export function buildHomeViewModel(data: OverviewSnapshot): HomeViewModel {
  return {
    attention: buildAttentionItems(data),
    continueCourses: data.courses === null ? null : data.courses.items.filter((course) => course.status === "DRAFT").slice(0, 3),
    studentPreview: data.students,
    quickActions: [
      { id: "create-course", href: "/instructor/courses", labelKey: "overview.actionCreateCourse", prominence: "primary" },
      { id: "add-student", href: "/instructor/students", labelKey: "overview.actionAddStudent", prominence: "secondary" },
      { id: "upload-content", href: "/instructor/library", labelKey: "overview.actionUploadContent", prominence: "secondary" },
      { id: "create-quiz", href: "/instructor/library/quizzes", labelKey: "overview.actionCreateQuiz", prominence: "secondary" },
    ],
  };
}

function buildAttentionItems(data: OverviewSnapshot): HomeAttentionItem[] {
  const items: HomeAttentionItem[] = [];

  if (data.unreadNotifications === null) {
    items.push({ id: "notifications-unavailable", labelKey: "overview.notificationsUnavailable", tone: "warning" });
  } else if (data.unreadNotifications > 0) {
    items.push({
      id: "unread-notifications",
      labelKey: "overview.notificationsUnreadLabel",
      href: "/instructor/notifications",
      count: data.unreadNotifications,
      tone: "accent",
    });
  }

  if (data.courses === null) {
    items.push({ id: "courses-unavailable", labelKey: "overview.coursesUnavailable", tone: "warning" });
  }

  if (data.students === null) {
    items.push({ id: "students-unavailable", labelKey: "overview.studentsUnavailable", tone: "warning" });
  }

  return items;
}
