import { useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useEffect, useMemo } from 'react';
import { View } from 'react-native';
import { Button } from '@/components/ui/button';
import { Screen } from '@/components/ui/screen';
import { LoadingPanel, StatusPanel } from '@/components/ui/status-panel';
import { ThemedText } from '@/components/ui/themed-text';
import { useI18n } from '@/lib/i18n/i18n-context';
import { spacing } from '@/lib/theme/tokens';
import { useAsyncData } from '@/lib/use-async-data';
import { SectionBlock } from './components/section-block';
import { fetchCourseDetail } from './course-client';
import { mapCourseContentError } from './error-mapping';
import { useContentAccessRecovery } from './use-content-access-recovery';

export function CourseDetailScreen() {
  const { t } = useI18n();
  const router = useRouter();
  const { courseId } = useLocalSearchParams<{ courseId: string }>();
  const recoverFromContentError = useContentAccessRecovery();

  const fetchDetail = useCallback(() => fetchCourseDetail(courseId), [courseId]);
  const state = useAsyncData(fetchDetail);

  const completedCount = useMemo(() => {
    if (state.status !== 'success') {
      return null;
    }

    const lessons = state.data.sections.flatMap((section) => section.lessons);

    if (lessons.length === 0) {
      return null;
    }

    return { completed: lessons.filter((lesson) => lesson.progress.status === 'COMPLETED').length, total: lessons.length };
  }, [state]);

  const contentError = state.status === 'error' ? state.error : null;

  useEffect(() => {
    if (contentError) {
      recoverFromContentError(contentError);
    }
    // Fires once per distinct error occurrence (not on every render while the
    // error state persists) — deliberately not calling this during render, which
    // would be an impure side effect and could re-fire on every re-render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [contentError]);

  if (state.status === 'loading') {
    return (
      <Screen>
        <LoadingPanel label={t('courses.myCourses.loading')} />
      </Screen>
    );
  }

  if (state.status === 'error') {
    return (
      <Screen center>
        <StatusPanel title={t(mapCourseContentError(state.error))} tone="danger">
          <Button label={t('common.retry')} onPress={state.reload} />
          <Button label={t('courses.courseDetail.backToCourses')} variant="secondary" onPress={() => router.replace('/courses')} />
        </StatusPanel>
      </Screen>
    );
  }

  const course = state.data;

  return (
    <Screen scroll>
      <View style={{ gap: spacing.xs, marginBottom: spacing.lg }}>
        <ThemedText variant="title">{course.title}</ThemedText>
        {course.description ? <ThemedText variant="muted">{course.description}</ThemedText> : null}
        {completedCount ? (
          <ThemedText variant="muted">
            {completedCount.completed}/{completedCount.total} {t('courses.courseDetail.lessonsCompletedSuffix')}
          </ThemedText>
        ) : null}
      </View>

      {course.sections.length === 0 ? (
        <StatusPanel title={t('courses.courseDetail.sectionsEmpty')} />
      ) : (
        <View style={{ gap: spacing.xl }}>
          {course.sections.map((section) => (
            <SectionBlock
              key={section.sectionId}
              section={section}
              onSelectLesson={(lessonId) => router.push(`/courses/${course.courseId}/lessons/${lessonId}`)}
            />
          ))}
        </View>
      )}
    </Screen>
  );
}
