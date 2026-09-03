"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import { useAuthenticatedInstructorSession } from "@/features/instructor/session-context";
import { DocumentsPanel } from "@/features/instructor/media/documents-panel";
import { UploadDocumentDialog } from "@/features/instructor/media/upload-document-dialog";
import { UploadVideoDialog } from "@/features/instructor/media/upload-video-dialog";
import { VideosPanel } from "@/features/instructor/media/videos-panel";
import { CreateQuizDialog } from "@/features/instructor/quizzes/create-quiz-dialog";
import { QuizzesList } from "@/features/instructor/quizzes/quizzes-list";
import { useI18n } from "@/lib/i18n/i18n";
import { getLibraryTab, libraryTabs, resolveLibraryContentType, type LibraryContentType } from "./library";

type DialogType = "video" | "document" | "quiz" | null;

export function LibraryPage({ contentType }: { contentType?: LibraryContentType }) {
  const pathname = usePathname();
  const { tenant } = useAuthenticatedInstructorSession();
  const { t } = useI18n();
  const activeType = contentType ?? resolveLibraryContentType(pathname);
  const activeTab = getLibraryTab(activeType);
  const [dialog, setDialog] = useState<DialogType>(null);
  const [refreshKey, setRefreshKey] = useState(0);

  function openPrimaryAction() {
    if (activeType === "videos") {
      setDialog("video");
    } else if (activeType === "documents") {
      setDialog("document");
    } else {
      setDialog("quiz");
    }
  }

  function handleUploaded() {
    setDialog(null);
    setRefreshKey((value) => value + 1);
  }

  return (
    <div className="library-page">
      <div className="page-header">
        <div>
          <h2>{t("nav.library")}</h2>
          <p className="page-subtitle">{t("library.subtitle")}</p>
        </div>
        <button className="primary-button" type="button" onClick={openPrimaryAction}>
          {t(activeTab.actionKey)}
        </button>
      </div>

      <nav className="library-tablist" aria-label={t("library.tabsLabel")}>
        {libraryTabs.map((tab) => (
          <Link
            key={tab.id}
            className="library-tab"
            href={tab.href}
            id={`library-tab-${tab.id}`}
            aria-current={tab.id === activeType ? "page" : undefined}
          >
            {t(tab.labelKey)}
          </Link>
        ))}
      </nav>

      <div id={`library-panel-${activeType}`} aria-labelledby={`library-tab-${activeType}`}>
        {activeType === "videos" ? <VideosPanel key={`videos-${refreshKey}`} showHeaderActions={false} /> : null}
        {activeType === "documents" ? <DocumentsPanel key={`documents-${refreshKey}`} showHeaderActions={false} /> : null}
        {activeType === "quizzes" ? <QuizzesList chrome="panel" /> : null}
      </div>

      {dialog === "video" ? <UploadVideoDialog tenantId={tenant.tenantId} onClose={() => setDialog(null)} onUploaded={handleUploaded} /> : null}
      {dialog === "document" ? <UploadDocumentDialog tenantId={tenant.tenantId} onClose={() => setDialog(null)} onUploaded={handleUploaded} /> : null}
      {dialog === "quiz" ? <CreateQuizDialog tenantId={tenant.tenantId} onClose={() => setDialog(null)} /> : null}
    </div>
  );
}
