import type { Locale } from "../../../lib/i18n/translations";
import type { PublishSelectedRequest, ReadyToPublish, ReadyToPublishLesson } from "../../../lib/api/types";

/**
 * Pure selection state/derivation for the First-Publish Review (DEC-0050).
 * The instructor only ever checks/unchecks *Lessons* - there is no separate
 * Chapter checkbox anywhere in this module or the UI built on it. Every
 * Chapter (`sectionIds`) the eventual request needs is instead always
 * *derived* mechanically from which Lessons are currently selected, which is
 * what makes the required invariant ("a selected Lesson's Chapter must
 * either also be selected or already be Live") impossible to violate by
 * construction, rather than something the UI has to separately validate.
 */

/** Default selection when the review flow opens: every Lesson the server currently reports as ready to publish - the instructor already explicitly chose "Review & publish", so starting from "everything ready" and letting them deselect is less friction than starting empty. */
export function defaultSelectedLessonIds(readyToPublish: ReadyToPublish): Set<string> {
  return new Set(readyToPublish.lessons.map((lesson) => lesson.lessonId));
}

/** Pure toggle - returns a new Set, never mutates the one passed in. */
export function toggleLessonSelected(selected: ReadonlySet<string>, lessonId: string): Set<string> {
  const next = new Set(selected);
  if (next.has(lessonId)) {
    next.delete(lessonId);
  } else {
    next.add(lessonId);
  }
  return next;
}

/**
 * Exactly the Chapter IDs the current Lesson selection requires: the
 * distinct `sectionId`s of every selected Lesson whose Chapter is not
 * already Live. A Lesson under an already-Live Chapter therefore never
 * contributes one here - selecting it "just works" without also selecting
 * its Chapter, matching the product requirement exactly. Order is
 * deterministic (first-seen among `lessons`, which is itself already in
 * Chapter/Lesson display order) so the resulting request/UI summary reads
 * predictably rather than in `Set` insertion-order happenstance.
 */
export function deriveRequiredSectionIds(
  selectedLessonIds: ReadonlySet<string>,
  lessons: readonly Pick<ReadyToPublishLesson, "lessonId" | "sectionId">[],
  liveSectionIds: ReadonlySet<string>,
): string[] {
  const required: string[] = [];
  const seen = new Set<string>();

  for (const lesson of lessons) {
    if (!selectedLessonIds.has(lesson.lessonId) || liveSectionIds.has(lesson.sectionId) || seen.has(lesson.sectionId)) {
      continue;
    }
    seen.add(lesson.sectionId);
    required.push(lesson.sectionId);
  }

  return required;
}

/** At least one Lesson must be selected - the backend rejects an empty `lessonIds` outright, and an empty selection can never make a first-publish request meaningful either way. */
export function isSelectionValid(selectedLessonIds: ReadonlySet<string>): boolean {
  return selectedLessonIds.size > 0;
}

export type ChapterLessonGroup = {
  sectionId: string;
  lessons: ReadyToPublishLesson[];
};

/**
 * Groups the server's flat `readyToPublish.lessons` list by Chapter
 * (Section) id, preserving first-appearance order (already the server's own
 * Chapter/Lesson display order) - what the First-Publish Review renders one
 * heading per group for. Deliberately decoupled from `CourseSectionSummary`
 * (title/live-status/full Chapter ordering): the caller resolves those from
 * its own already-loaded Sections list, keeping this function reusable and
 * trivially testable on its own.
 */
export function groupLessonsBySection(lessons: readonly ReadyToPublishLesson[]): ChapterLessonGroup[] {
  const order: string[] = [];
  const bySection = new Map<string, ReadyToPublishLesson[]>();

  for (const lesson of lessons) {
    let group = bySection.get(lesson.sectionId);
    if (!group) {
      group = [];
      bySection.set(lesson.sectionId, group);
      order.push(lesson.sectionId);
    }
    group.push(lesson);
  }

  return order.map((sectionId) => ({ sectionId, lessons: bySection.get(sectionId) ?? [] }));
}

/**
 * The exact `publish-selected` request body for the current selection -
 * `lessonIds` are exactly the explicitly-checked Lessons (an unselected
 * ready Lesson is never included, so it stays Draft), `sectionIds` are
 * mechanically derived (see `deriveRequiredSectionIds`). No `quizIds` field
 * exists at all - Quiz publication is always a server-side side effect of
 * publishing its Lesson (DEC-0050).
 */
export function buildPublishSelectedRequest(
  selectedLessonIds: ReadonlySet<string>,
  lessons: readonly Pick<ReadyToPublishLesson, "lessonId" | "sectionId">[],
  liveSectionIds: ReadonlySet<string>,
): PublishSelectedRequest {
  return {
    sectionIds: deriveRequiredSectionIds(selectedLessonIds, lessons, liveSectionIds),
    lessonIds: Array.from(selectedLessonIds),
  };
}

/**
 * The human-facing "what am I about to publish?" sentence, kept deliberately
 * separate from `sectionIds`/the mutation request above: `chapterCount` here
 * is a *transition count* (how many currently-Draft Chapters the backend
 * needs to flip to Live - zero whenever every selected Lesson's Chapter is
 * already Live), which is not the same question as "how many Chapters is
 * this content spread across?" - conflating the two previously produced the
 * nonsensical "Publish 2 lessons across 0 chapters?" when every selected
 * Lesson happened to sit under an already-Live Chapter. This function
 * answers the *presentation* question only; `buildPublishSelectedRequest`
 * above remains the only source of the actual request body, unaffected by
 * anything here.
 *
 * This composes the full sentence directly (per locale) rather than going
 * through a flat `translations` key + `{placeholder}` substitution, and
 * that's a deliberate, narrow exception to this codebase's usual i18n
 * pattern: natural Arabic requires a grammatical *dual* form for exactly two
 * of something (دَرسين/فصلين - not the counted-noun form used for 3+, and not
 * the bare singular used for 1), which a single fixed template with one
 * placeholder cannot express. Splitting "which word for this count" from
 * "how the sentence is built" - `lessonPhrase`/`chapterPhrase` below - keeps
 * each half simple instead of inventing five more translation keys per
 * language to fake pluralization the flat system doesn't support.
 *
 * `chapterCount` is always the same number as
 * `deriveRequiredSectionIds(...).length` (there is only one meaningful count
 * - how many Chapters will actually transition); 0 always omits the Chapter
 * phrase entirely - it is never rendered as "0 chapters"/"0 فصول" in either
 * language.
 */
export function formatPublishSummary(lessonCount: number, chapterCount: number, locale: Locale): string {
  return locale === "ar" ? formatPublishSummaryAr(lessonCount, chapterCount) : formatPublishSummaryEn(lessonCount, chapterCount);
}

function formatPublishSummaryEn(lessonCount: number, chapterCount: number): string {
  const lessonPhrase = lessonCount === 1 ? "1 lesson" : `${lessonCount} lessons`;

  if (chapterCount <= 0) {
    return `Publish ${lessonPhrase}?`;
  }

  if (chapterCount === 1) {
    return `Publish ${lessonPhrase} in 1 chapter?`;
  }

  return `Publish ${lessonPhrase} across ${chapterCount} chapters?`;
}

/**
 * Arabic dual forms (درسين/فصلين) cover exactly 2 - never a bare number, and
 * never the 3+ counted-noun form (دروس/فصول, which itself is also what
 * governs 11+ in full Arabic grammar; this product's realistic selection
 * counts don't need that further distinction). 1 uses the word واحد
 * ("one"), not the digit. Every Chapter count (1, 2, or 3+) is introduced
 * with the same فى ("in") - Arabic does not switch preposition by count the
 * way the English "in 1 chapter" / "across N chapters" wording does.
 */
function formatPublishSummaryAr(lessonCount: number, chapterCount: number): string {
  const lessonPhrase = arabicCountedNoun(lessonCount, { one: "درس واحد", two: "درسين", other: "دروس" });

  if (chapterCount <= 0) {
    return `هل تريد نشر ${lessonPhrase}؟`;
  }

  const chapterPhrase = arabicCountedNoun(chapterCount, { one: "فصل واحد", two: "فصلين", other: "فصول" });
  return `هل تريد نشر ${lessonPhrase} في ${chapterPhrase}؟`;
}

function arabicCountedNoun(count: number, forms: { one: string; two: string; other: string }): string {
  if (count === 1) {
    return forms.one;
  }

  if (count === 2) {
    return forms.two;
  }

  return `${count} ${forms.other}`;
}
