import { Pressable, StyleSheet, View } from 'react-native';
import { Badge } from '@/components/ui/badge';
import { ThemedText } from '@/components/ui/themed-text';
import { useI18n } from '@/lib/i18n/i18n-context';
import { useThemeTokens } from '@/lib/theme/theme-context';
import { radius, spacing } from '@/lib/theme/tokens';
import { formatDurationSeconds, formatFileSize } from '../format';
import { lessonTypeLabelKey } from '../lesson-type-routing';
import { progressLabelKey } from '../progress-labels';
import type { StudentLessonSummary } from '../course-types';

type LessonRowProps = {
  lesson: StudentLessonSummary;
  onPress: () => void;
};

export function LessonRow({ lesson, onPress }: LessonRowProps) {
  const { t } = useI18n();
  const tokens = useThemeTokens();
  const typeLabel = t(lessonTypeLabelKey(lesson.type));
  const progressLabel = t(progressLabelKey(lesson.progress.status));
  const meta = lessonMeta(lesson);

  const accessibilityLabel = meta
    ? `${lesson.title}, ${typeLabel}, ${meta}, ${progressLabel}`
    : `${lesson.title}, ${typeLabel}, ${progressLabel}`;

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      onPress={onPress}
      style={({ pressed }) => [
        styles.row,
        { borderColor: tokens.border, backgroundColor: pressed ? tokens.surfaceAlt : tokens.surface },
      ]}
    >
      <View style={styles.textColumn}>
        <ThemedText variant="body" numberOfLines={2}>
          {lesson.title}
        </ThemedText>
        {meta ? (
          <ThemedText variant="muted" style={styles.meta}>
            {meta}
          </ThemedText>
        ) : null}
        <View style={styles.badgeRow}>
          <Badge label={typeLabel} />
          <Badge label={progressLabel} tone={lesson.progress.status === 'COMPLETED' ? 'success' : 'neutral'} />
        </View>
      </View>
    </Pressable>
  );
}

function lessonMeta(lesson: StudentLessonSummary): string | null {
  if (lesson.video) {
    return formatDurationSeconds(lesson.video.durationSeconds);
  }

  if (lesson.document) {
    return `${lesson.document.fileName} · ${formatFileSize(lesson.document.fileSizeBytes)}`;
  }

  return null;
}

const styles = StyleSheet.create({
  row: {
    borderWidth: 1,
    borderRadius: radius.md,
    padding: spacing.md,
  },
  textColumn: {
    gap: spacing.xs,
  },
  meta: {
    fontSize: 13,
  },
  badgeRow: {
    flexDirection: 'row',
    gap: spacing.xs,
    marginTop: 2,
  },
});
