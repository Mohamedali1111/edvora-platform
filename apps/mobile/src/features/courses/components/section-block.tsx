import { View } from 'react-native';
import { ThemedText } from '@/components/ui/themed-text';
import { useI18n } from '@/lib/i18n/i18n-context';
import { spacing } from '@/lib/theme/tokens';
import { LessonRow } from './lesson-row';
import type { StudentSectionSummary } from '../course-types';

type SectionBlockProps = {
  section: StudentSectionSummary;
  onSelectLesson: (lessonId: string) => void;
};

// Renders the Section's Lessons in exactly the order the backend returned them
// (already `position asc` — never re-sorted client-side) and never second-guesses
// which ones are present: the backend has already filtered to PUBLISHED lessons
// within their availability window (see StudentCourseAccessService).
export function SectionBlock({ section, onSelectLesson }: SectionBlockProps) {
  const { t } = useI18n();

  return (
    <View style={{ gap: spacing.sm }} accessibilityRole="header" accessible={false}>
      <View style={{ gap: 2 }}>
        <ThemedText variant="subtitle" accessibilityRole="header">
          {section.title}
        </ThemedText>
        {section.description ? <ThemedText variant="muted">{section.description}</ThemedText> : null}
      </View>

      {section.lessons.length === 0 ? (
        <ThemedText variant="muted">{t('courses.courseDetail.lessonsEmpty')}</ThemedText>
      ) : (
        <View style={{ gap: spacing.sm }}>
          {section.lessons.map((lesson) => (
            <LessonRow key={lesson.lessonId} lesson={lesson} onPress={() => onSelectLesson(lesson.lessonId)} />
          ))}
        </View>
      )}
    </View>
  );
}
