import { useRouter } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, FlatList, RefreshControl, View } from 'react-native';
import { Button } from '@/components/ui/button';
import { Screen } from '@/components/ui/screen';
import { LoadingPanel, StatusPanel } from '@/components/ui/status-panel';
import { ThemedText } from '@/components/ui/themed-text';
import { useI18n } from '@/lib/i18n/i18n-context';
import { useThemeTokens } from '@/lib/theme/theme-context';
import { spacing } from '@/lib/theme/tokens';
import { CourseCard } from './components/course-card';
import { fetchMyCourses } from './course-client';
import type { StudentCourseSummary } from './course-types';
import { mapCourseContentError } from './error-mapping';
import { appendCoursePage, MY_COURSES_PAGE_SIZE, nextOffset } from './pagination';
import { useContentAccessRecovery } from './use-content-access-recovery';

type ListPhase = 'loading' | 'ready' | 'error';

export function MyCoursesScreen() {
  const { t } = useI18n();
  const router = useRouter();
  const tokens = useThemeTokens();
  const recoverFromContentError = useContentAccessRecovery();

  const [phase, setPhase] = useState<ListPhase>('loading');
  const [items, setItems] = useState<StudentCourseSummary[]>([]);
  const [offset, setOffset] = useState(0);
  const [hasMore, setHasMore] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<unknown>(null);

  // Guards a slow first-page response from overwriting a newer one — the same
  // "abort/stale-response safety where practical" pattern as useAsyncData
  // (lib/use-async-data.ts), just inlined here because this screen's state is
  // pagination-shaped rather than a single value.
  const requestId = useRef(0);

  const loadFirstPage = useCallback(() => {
    const id = ++requestId.current;
    setPhase('loading');
    setError(null);

    fetchMyCourses({ limit: MY_COURSES_PAGE_SIZE, offset: 0 })
      .then((page) => {
        if (requestId.current !== id) {
          return;
        }
        setItems(page.items);
        setOffset(page.offset);
        setHasMore(page.hasMore);
        setPhase('ready');
      })
      .catch((fetchError: unknown) => {
        if (requestId.current !== id) {
          return;
        }
        setError(fetchError);
        setPhase('error');
        recoverFromContentError(fetchError);
      });
  }, [recoverFromContentError]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    loadFirstPage();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const onRefresh = useCallback(() => {
    const id = ++requestId.current;
    setRefreshing(true);

    fetchMyCourses({ limit: MY_COURSES_PAGE_SIZE, offset: 0 })
      .then((page) => {
        if (requestId.current !== id) {
          return;
        }
        setItems(page.items);
        setOffset(page.offset);
        setHasMore(page.hasMore);
        setPhase('ready');
      })
      .catch((fetchError: unknown) => {
        recoverFromContentError(fetchError);
      })
      .finally(() => {
        if (requestId.current === id) {
          setRefreshing(false);
        }
      });
  }, [recoverFromContentError]);

  const onLoadMore = useCallback(() => {
    if (phase !== 'ready' || !hasMore || loadingMore) {
      return;
    }

    setLoadingMore(true);
    const requestedOffset = nextOffset(offset, MY_COURSES_PAGE_SIZE);

    fetchMyCourses({ limit: MY_COURSES_PAGE_SIZE, offset: requestedOffset })
      .then((page) => {
        setItems((current) => appendCoursePage(current, page.items));
        setOffset(page.offset);
        setHasMore(page.hasMore);
      })
      .catch((fetchError: unknown) => {
        recoverFromContentError(fetchError);
      })
      .finally(() => {
        setLoadingMore(false);
      });
  }, [phase, hasMore, loadingMore, offset, recoverFromContentError]);

  if (phase === 'loading') {
    return (
      <Screen>
        <LoadingPanel label={t('courses.myCourses.loading')} />
      </Screen>
    );
  }

  if (phase === 'error') {
    return (
      <Screen center>
        <StatusPanel title={t(mapCourseContentError(error))} tone="danger">
          <Button label={t('common.retry')} onPress={loadFirstPage} />
        </StatusPanel>
      </Screen>
    );
  }

  return (
    <Screen contentStyle={{ padding: 0 }}>
      <FlatList
        style={{ flex: 1 }}
        data={items}
        keyExtractor={(item) => item.courseId}
        contentContainerStyle={{ padding: spacing.lg, gap: spacing.md, flexGrow: 1 }}
        ItemSeparatorComponent={() => <View style={{ height: spacing.md }} />}
        renderItem={({ item }) => (
          <CourseCard course={item} onPress={() => router.push(`/courses/${item.courseId}`)} />
        )}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={tokens.primary} />}
        onEndReachedThreshold={0.4}
        onEndReached={onLoadMore}
        ListHeaderComponent={
          <ThemedText variant="title" style={{ marginBottom: spacing.md }}>
            {t('courses.myCourses.title')}
          </ThemedText>
        }
        ListEmptyComponent={
          <StatusPanel title={t('courses.myCourses.emptyTitle')} body={t('courses.myCourses.emptyBody')} />
        }
        ListFooterComponent={
          loadingMore ? (
            <View
              accessible
              accessibilityLabel={t('courses.myCourses.loadMore')}
              accessibilityRole="progressbar"
              style={{ paddingVertical: spacing.md }}
            >
              <ActivityIndicator color={tokens.primary} />
            </View>
          ) : null
        }
      />
    </Screen>
  );
}
