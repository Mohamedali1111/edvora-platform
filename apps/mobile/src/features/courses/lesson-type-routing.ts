import type { LessonType } from './course-types';
import type { TranslationKey } from '../../lib/i18n/translations';

/**
 * The one place that knows which translation key labels each Lesson type in
 * on-screen text (never color/icon alone — see the accessibility requirement this
 * satisfies). The actual per-type placeholder screens (lesson-type-screens.tsx)
 * key off `LessonType` the same way, as a lookup rather than an if/else chain, so
 * a later slice plugs in a real VIDEO/DOCUMENT/QUIZ screen by replacing one
 * registry entry, never by growing a conditional.
 */
const LESSON_TYPE_LABEL_KEY: Record<LessonType, TranslationKey> = {
  VIDEO: 'courses.lessonType.video',
  DOCUMENT: 'courses.lessonType.document',
  QUIZ: 'courses.lessonType.quiz',
};

export function lessonTypeLabelKey(type: LessonType): TranslationKey {
  return LESSON_TYPE_LABEL_KEY[type];
}

const ALL_LESSON_TYPES: readonly LessonType[] = ['VIDEO', 'DOCUMENT', 'QUIZ'];

export function allLessonTypes(): readonly LessonType[] {
  return ALL_LESSON_TYPES;
}
