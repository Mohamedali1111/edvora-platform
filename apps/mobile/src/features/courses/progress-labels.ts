import type { LessonProgressStatus } from './course-types';
import type { TranslationKey } from '../../lib/i18n/translations';

const PROGRESS_LABEL_KEY: Record<LessonProgressStatus, TranslationKey> = {
  NOT_STARTED: 'courses.lesson.progress.NOT_STARTED',
  STARTED: 'courses.lesson.progress.STARTED',
  COMPLETED: 'courses.lesson.progress.COMPLETED',
};

export function progressLabelKey(status: LessonProgressStatus): TranslationKey {
  return PROGRESS_LABEL_KEY[status];
}
