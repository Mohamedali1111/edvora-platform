import { Pressable, StyleSheet } from 'react-native';
import { ThemedText } from '@/components/ui/themed-text';
import { useThemeTokens } from '@/lib/theme/theme-context';
import { radius, spacing } from '@/lib/theme/tokens';
import type { StudentCourseSummary } from '../course-types';

type CourseCardProps = {
  course: StudentCourseSummary;
  onPress: () => void;
};

// tenantId/courseId are never rendered — they're internal identifiers, not
// student-facing UI (see the milestone's "no internal IDs as primary UI" rule).
export function CourseCard({ course, onPress }: CourseCardProps) {
  const tokens = useThemeTokens();

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={course.title}
      onPress={onPress}
      style={({ pressed }) => [
        styles.card,
        { backgroundColor: tokens.surface, borderColor: tokens.border, opacity: pressed ? 0.85 : 1 },
      ]}
    >
      <ThemedText variant="subtitle" numberOfLines={2}>
        {course.title}
      </ThemedText>
      {course.description ? (
        <ThemedText variant="muted" numberOfLines={2} style={styles.description}>
          {course.description}
        </ThemedText>
      ) : null}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: {
    borderWidth: 1,
    borderRadius: radius.lg,
    padding: spacing.md,
    gap: spacing.xs,
  },
  description: {
    lineHeight: 19,
  },
});
