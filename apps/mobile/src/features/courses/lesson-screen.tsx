import { useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { Screen } from '@/components/ui/screen';
import { LoadingPanel, StatusPanel } from '@/components/ui/status-panel';
import { useI18n } from '@/lib/i18n/i18n-context';
import { useAsyncData } from '@/lib/use-async-data';
import { fetchCourseDetail } from './course-client';
import { mapCourseContentError } from './error-mapping';
import { resolveLessonTypeScreen } from './lesson-type-screens';
import { useContentAccessRecovery } from './use-content-access-recovery';

/**
 * Deliberately re-fetches the whole Course Detail rather than trusting anything
 * passed via route params: there is no standalone "get one lesson" student
 * endpoint (only the full course structure, or the type-specific
 * assertAccessible*Lesson checks internal to the media/quiz modules — see the
 * backend contract inspection in this milestone's report), and re-deriving the
 * lesson from a fresh, fully entitlement-checked response means a stale/foreign/
 * expired lessonId collapses to the exact same honest "not available" state a
 * direct API call would produce — never a state trusted from navigation history.
 */
export function LessonScreen() {
  const { t } = useI18n();
  const router = useRouter();
  const { courseId, lessonId } = useLocalSearchParams<{ courseId: string; lessonId: string }>();
  const recoverFromContentError = useContentAccessRecovery();

  const fetchDetail = useCallback(() => fetchCourseDetail(courseId), [courseId]);
  const state = useAsyncData(fetchDetail);
  const contentError = state.status === 'error' ? state.error : null;

  useEffect(() => {
    if (contentError) {
      recoverFromContentError(contentError);
    }
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
        </StatusPanel>
      </Screen>
    );
  }

  const lesson = state.data.sections.flatMap((section) => section.lessons).find((row) => row.lessonId === lessonId);

  if (!lesson) {
    return (
      <Screen center>
        <StatusPanel title={t('courses.lesson.notFoundTitle')} body={t('courses.lesson.notFoundBody')} tone="danger">
          <Button label={t('courses.lesson.backToCourse')} onPress={() => router.replace(`/courses/${courseId}`)} />
        </StatusPanel>
      </Screen>
    );
  }

  return (
    <Screen scroll>
      {/* Invoked as a plain function, not rendered as a dynamically-resolved JSX
          tag: resolveLessonTypeScreen picks an existing, stable component from a
          fixed registry (lesson-type-screens.tsx) rather than creating one, but a
          `<Capitalized ... />` tag built from a variable reads to the lint rule as
          if a new component were being defined during render. Calling it directly
          produces the exact same React element with no such ambiguity. */}
      {resolveLessonTypeScreen(lesson.type)({ lesson, courseId, onRetry: state.reload })}
    </Screen>
  );
}
