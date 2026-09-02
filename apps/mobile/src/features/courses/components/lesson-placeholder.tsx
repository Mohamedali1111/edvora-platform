import { View } from 'react-native';
import { Badge } from '@/components/ui/badge';
import { StatusPanel } from '@/components/ui/status-panel';
import { ThemedText } from '@/components/ui/themed-text';
import { useI18n } from '@/lib/i18n/i18n-context';
import { spacing } from '@/lib/theme/tokens';
import { formatDurationSeconds, formatFileSize } from '../format';
import { lessonTypeLabelKey } from '../lesson-type-routing';
import { progressLabelKey } from '../progress-labels';
import type { StudentLessonSummary } from '../course-types';

type LessonPlaceholderProps = {
  lesson: StudentLessonSummary;
};

/**
 * Shared body for every per-type placeholder screen (video/document/quiz — see
 * lesson-type-screens.tsx). Deliberately does NOT implement a player/viewer and
 * NEVER calls the lesson-completion endpoint — this milestone only proves
 * navigation and entitlement, not content consumption (§8/§10 of the milestone
 * spec). Shows the lesson's real, already-fetched progress status (never
 * mutated), never a fake "completed" claim.
 */
export function LessonPlaceholder({ lesson }: LessonPlaceholderProps) {
  const { t } = useI18n();
  const meta = lessonMeta(lesson);

  return (
    <View style={{ gap: spacing.md }}>
      <View style={{ gap: spacing.xs }}>
        <ThemedText variant="title">{lesson.title}</ThemedText>
        {lesson.description ? <ThemedText variant="muted">{lesson.description}</ThemedText> : null}
        <View style={{ flexDirection: 'row', gap: spacing.xs, marginTop: spacing.xs }}>
          <Badge label={t(lessonTypeLabelKey(lesson.type))} />
          <Badge
            label={t(progressLabelKey(lesson.progress.status))}
            tone={lesson.progress.status === 'COMPLETED' ? 'success' : 'neutral'}
          />
        </View>
        {meta ? <ThemedText variant="muted">{meta}</ThemedText> : null}
      </View>

      <StatusPanel title={t('courses.lesson.placeholderTitle')} body={t('courses.lesson.placeholderBody')} />
    </View>
  );
}

function lessonMeta(lesson: StudentLessonSummary): string | null {
  if (lesson.video) {
    return formatDurationSeconds(lesson.video.durationSeconds);
  }

  if (lesson.document) {
    return `${lesson.document.fileName} · ${formatFileSize(lesson.document.fileSizeBytes)}`;
  }

  if (lesson.quiz) {
    return lesson.quiz.title;
  }

  return null;
}
