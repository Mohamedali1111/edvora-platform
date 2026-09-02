import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { WebView, type WebViewMessageEvent } from 'react-native-webview';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { LoadingPanel, StatusPanel } from '@/components/ui/status-panel';
import { ThemedText } from '@/components/ui/themed-text';
import { useI18n } from '@/lib/i18n/i18n-context';
import { useThemeTokens } from '@/lib/theme/theme-context';
import { radius, spacing } from '@/lib/theme/tokens';
import { useAsyncData } from '@/lib/use-async-data';
import { useCaptureProtection } from '../capture-protection/use-capture-protection';
import { formatFileSize } from '../format';
import { lessonTypeLabelKey } from '../lesson-type-routing';
import type { LessonTypeScreenProps } from '../lesson-type-screens';
import { progressLabelKey } from '../progress-labels';
import { useContentAccessRecovery } from '../use-content-access-recovery';
import { fetchDocumentAccess } from './document-client';
import { mapDocumentAccessError } from './document-error-mapping';
import { isSupportedDocumentMime } from './document-mime';
import type { DocumentAccessResponse } from './document-types';
import { DOCUMENT_VIEWER_HTML } from './document-viewer-html';
import {
  buildViewerLoadCommand,
  initialDocumentViewerState,
  mapViewerErrorReason,
  parseViewerMessage,
  reduceDocumentViewerEvent,
  type DocumentViewerState,
} from './document-viewer-protocol';
import { useDocumentLifecycle } from './use-document-lifecycle';

/**
 * Replaces only the DOCUMENT placeholder in the lesson-type registry
 * (lesson-type-screens.tsx) — VIDEO and QUIZ are untouched. Never calls the
 * lesson-completion endpoint: opening/viewing a document does not mark it
 * complete in this milestone (progress mutation is a dedicated later slice).
 *
 * Unlike VIDEO, Course Detail's `document` metadata carries no
 * `processingStatus` field (see course-types.ts), so there is no client-side
 * "still processing" pre-check to gate on — this screen always attempts
 * `/document/access` directly, and a not-ready/not-entitled lesson surfaces
 * through that call's own `LESSON_NOT_FOUND` response exactly like every
 * other honest "not available" state (see document-error-mapping.ts).
 */
export function DocumentLessonScreen({ lesson, courseId, onRetry }: LessonTypeScreenProps) {
  const { t } = useI18n();

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
      </View>

      <ReadyDocumentBody courseId={courseId} lessonId={lesson.lessonId} title={lesson.title} onLessonRetry={onRetry} />
    </View>
  );
}

function ReadyDocumentBody({
  courseId,
  lessonId,
  title,
  onLessonRetry,
}: {
  courseId: string;
  lessonId: string;
  title: string;
  onLessonRetry: () => void;
}) {
  const { t } = useI18n();
  const recoverFromContentError = useContentAccessRecovery();

  const fetchAccess = useCallback(() => fetchDocumentAccess(courseId, lessonId), [courseId, lessonId]);
  const state = useAsyncData(fetchAccess);
  const contentError = state.status === 'error' ? state.error : null;

  useEffect(() => {
    if (contentError) {
      recoverFromContentError(contentError);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [contentError]);

  if (state.status === 'loading') {
    return <LoadingPanel label={t('document.loading')} />;
  }

  if (state.status === 'error') {
    return (
      <StatusPanel title={t(mapDocumentAccessError(state.error))} tone="danger">
        <Button label={t('common.retry')} onPress={state.reload} />
      </StatusPanel>
    );
  }

  if (!isSupportedDocumentMime(state.data.mimeType)) {
    return (
      <StatusPanel title={t('document.error.unsupportedMime')} tone="danger">
        <Button label={t('common.retry')} variant="secondary" onPress={onLessonRetry} />
      </StatusPanel>
    );
  }

  // Keyed by downloadUrl: a refreshed capability (new token, same or
  // different URL) mounts a fresh WebView/viewer rather than attempting an
  // in-place reload — simpler and unambiguous, and refreshes are rare (only
  // on a viewer error or a foreground resume near expiry — never on a timer).
  return <DocumentViewerSurface key={state.data.downloadUrl} title={title} access={state.data} onNeedsRefresh={state.reload} />;
}

function DocumentViewerSurface({
  title,
  access,
  onNeedsRefresh,
}: {
  title: string;
  access: DocumentAccessResponse;
  onNeedsRefresh: () => void;
}) {
  const { t } = useI18n();
  const tokens = useThemeTokens();
  const webViewRef = useRef<WebView>(null);
  const [viewerState, setViewerState] = useState<DocumentViewerState>(initialDocumentViewerState);

  const { warningVisible } = useCaptureProtection({ protectionKey: 'edvora.document-lesson' });
  useDocumentLifecycle({ expiresAt: access.expiresAt, onNeedsRefresh });

  const handleMessage = useCallback(
    (event: WebViewMessageEvent) => {
      const message = parseViewerMessage(event.nativeEvent.data);

      if (!message) {
        return;
      }

      if (message.type === 'ready') {
        webViewRef.current?.postMessage(buildViewerLoadCommand({ url: access.downloadUrl, fileName: access.fileName }));
      }

      setViewerState((previous) => reduceDocumentViewerEvent(previous, message));
    },
    [access.downloadUrl, access.fileName],
  );

  const isLoadingViewer = viewerState.phase === 'connecting' || viewerState.phase === 'loadingDocument';

  const shouldAllowNavigation = useMemo(
    () => (request: { url: string }) => request.url === 'about:blank',
    [],
  );

  return (
    <View style={{ gap: spacing.sm }}>
      <View style={[styles.viewerContainer, { backgroundColor: tokens.surfaceAlt, borderColor: tokens.border }]}>
        <WebView
          ref={webViewRef}
          originWhitelist={['about:blank']}
          source={{ html: DOCUMENT_VIEWER_HTML }}
          onMessage={handleMessage}
          onShouldStartLoadWithRequest={shouldAllowNavigation}
          javaScriptEnabled
          domStorageEnabled={false}
          // No deliberate on-disk caching of the fetched document: the WebView's
          // own HTTP cache is disabled, and `incognito` uses a non-persistent
          // storage/cache session where the platform supports it (see the
          // milestone report's "Local File / Cache Behavior" section for what
          // this does and does not guarantee).
          cacheEnabled={false}
          incognito
          allowFileAccess={false}
          allowUniversalAccessFromFileURLs={false}
          setSupportMultipleWindows={false}
          javaScriptCanOpenWindowsAutomatically={false}
          allowsLinkPreview={false}
          allowsBackForwardNavigationGestures={false}
          style={styles.webview}
          accessibilityLabel={title}
        />
        {isLoadingViewer ? (
          <View style={StyleSheet.absoluteFill} pointerEvents="none">
            <LoadingPanel label={t('document.viewerLoading')} />
          </View>
        ) : null}
        {warningVisible ? (
          <View
            style={StyleSheet.absoluteFill}
            accessible
            accessibilityRole="alert"
            accessibilityLabel={t('document.captureWarning')}
          >
            <View style={[styles.warningOverlay, { backgroundColor: tokens.overlay }]}>
              <ThemedText variant="subtitle" style={styles.warningText}>
                {t('document.captureWarning')}
              </ThemedText>
            </View>
          </View>
        ) : null}
      </View>

      {viewerState.phase === 'error' ? (
        <StatusPanel title={t(mapViewerErrorReason(viewerState.errorReason ?? 'unknown'))} tone="danger">
          <Button label={t('common.retry')} onPress={onNeedsRefresh} />
        </StatusPanel>
      ) : null}

      <ThemedText variant="muted">
        {access.fileName} · {formatFileSize(access.fileSizeBytes)}
      </ThemedText>

      <ThemedText variant="muted" style={styles.notice}>
        {t('document.captureNotice')}
      </ThemedText>
    </View>
  );
}

const styles = StyleSheet.create({
  viewerContainer: {
    position: 'relative',
    width: '100%',
    aspectRatio: 3 / 4,
    borderRadius: radius.lg,
    borderWidth: 1,
    overflow: 'hidden',
  },
  webview: {
    flex: 1,
    backgroundColor: 'transparent',
  },
  warningOverlay: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: spacing.lg,
  },
  warningText: {
    color: '#ffffff',
    textAlign: 'center',
  },
  notice: {
    textAlign: 'center',
  },
});
