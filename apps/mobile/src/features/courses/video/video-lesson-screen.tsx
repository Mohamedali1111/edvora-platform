import { useEvent, useEventListener } from 'expo';
import { useVideoPlayer, VideoView } from 'expo-video';
import { useCallback, useEffect } from 'react';
import { StyleSheet, View } from 'react-native';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { LoadingPanel, StatusPanel } from '@/components/ui/status-panel';
import { ThemedText } from '@/components/ui/themed-text';
import { useI18n } from '@/lib/i18n/i18n-context';
import { useThemeTokens } from '@/lib/theme/theme-context';
import { radius, spacing } from '@/lib/theme/tokens';
import { useAsyncData } from '@/lib/use-async-data';
import { CompletionIndicator } from '../completion/completion-indicator';
import { useLessonCompletion } from '../completion/use-lesson-completion';
import { lessonTypeLabelKey } from '../lesson-type-routing';
import type { LessonTypeScreenProps } from '../lesson-type-screens';
import { progressLabelKey } from '../progress-labels';
import { useContentAccessRecovery } from '../use-content-access-recovery';
import { useCaptureProtection } from '../capture-protection/use-capture-protection';
import { resolveVideoProcessingPhase, type VideoProcessingPhase } from './processing-phase';
import { useVideoLifecycle } from './use-video-lifecycle';
import { fetchVideoAccess } from './video-client';
import { mapVideoAccessError } from './video-error-mapping';
import type { VideoAccessResponse } from './video-types';

/**
 * Replaces only the VIDEO placeholder in the lesson-type registry
 * (lesson-type-screens.tsx) — DOCUMENT and QUIZ are untouched.
 *
 * Completion (this milestone): the V1 trigger is the player's own `playToEnd`
 * event — natural end of playback, never opening the screen, pressing play,
 * buffering, or partial playback (see VideoPlayerSurface below and the
 * milestone report's "VIDEO Completion" section for why this was chosen over
 * a local watch-percentage heuristic: expo-video exposes no watch-time
 * telemetry the backend can verify, and the frozen backend contract has no
 * endpoint to record one — `playToEnd` is the one honest, verifiable signal
 * this player surface actually offers). `useLessonCompletion` owns the
 * request/idempotency/error state; this component only decides *when* to
 * call `trigger()` and how to render its result.
 */
export function VideoLessonScreen({ lesson, courseId, onRetry }: LessonTypeScreenProps) {
  const { t } = useI18n();
  const phase = resolveVideoProcessingPhase(lesson.video?.processingStatus ?? 'ARCHIVED');
  const completion = useLessonCompletion({
    courseId,
    lessonId: lesson.lessonId,
    alreadyCompleted: lesson.progress.status === 'COMPLETED',
  });
  // The completion mutation's own response is authoritative (it's the
  // backend's row read back after its write — see completion-types.ts), so
  // it's safe to reflect immediately here without waiting for a fresh Course
  // Detail fetch; navigating back to Course Detail re-fetches it fresh
  // regardless (see course-detail-screen.tsx), which is this milestone's
  // "subsequent navigation must come from backend state" guarantee.
  const progressStatus = completion.phase === 'saved' ? 'COMPLETED' : lesson.progress.status;

  return (
    <View style={{ gap: spacing.md }}>
      <View style={{ gap: spacing.xs }}>
        <ThemedText variant="title">{lesson.title}</ThemedText>
        {lesson.description ? <ThemedText variant="muted">{lesson.description}</ThemedText> : null}
        <View style={{ flexDirection: 'row', gap: spacing.xs, marginTop: spacing.xs }}>
          <Badge label={t(lessonTypeLabelKey(lesson.type))} />
          <Badge label={t(progressLabelKey(progressStatus))} tone={progressStatus === 'COMPLETED' ? 'success' : 'neutral'} />
        </View>
      </View>

      {phase === 'ready' ? (
        <ReadyVideoBody
          courseId={courseId}
          lessonId={lesson.lessonId}
          title={lesson.title}
          onPlaybackEnded={completion.trigger}
        />
      ) : (
        <NotReadyBody phase={phase} onRetry={onRetry} />
      )}

      {phase === 'ready' ? (
        <CompletionIndicator phase={completion.phase} errorKey={completion.errorKey} onRetry={completion.trigger} />
      ) : null}
    </View>
  );
}

function NotReadyBody({ phase, onRetry }: { phase: Exclude<VideoProcessingPhase, 'ready'>; onRetry: () => void }) {
  const { t } = useI18n();

  if (phase === 'processing') {
    return (
      <StatusPanel title={t('video.processingTitle')} body={t('video.processingBody')} tone="warning">
        <Button label={t('common.retry')} variant="secondary" onPress={onRetry} />
      </StatusPanel>
    );
  }

  if (phase === 'failed') {
    return (
      <StatusPanel title={t('video.failedTitle')} body={t('video.failedBody')} tone="danger">
        <Button label={t('common.retry')} variant="secondary" onPress={onRetry} />
      </StatusPanel>
    );
  }

  return (
    <StatusPanel title={t('video.error.notAvailable')} tone="danger">
      <Button label={t('common.retry')} variant="secondary" onPress={onRetry} />
    </StatusPanel>
  );
}

function ReadyVideoBody({
  courseId,
  lessonId,
  title,
  onPlaybackEnded,
}: {
  courseId: string;
  lessonId: string;
  title: string;
  onPlaybackEnded: () => void;
}) {
  const { t } = useI18n();
  const recoverFromContentError = useContentAccessRecovery();

  const fetchAccess = useCallback(() => fetchVideoAccess(courseId, lessonId), [courseId, lessonId]);
  const state = useAsyncData(fetchAccess);
  const contentError = state.status === 'error' ? state.error : null;

  useEffect(() => {
    if (contentError) {
      recoverFromContentError(contentError);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [contentError]);

  if (state.status === 'loading') {
    return <LoadingPanel label={t('video.loading')} />;
  }

  if (state.status === 'error') {
    return (
      <StatusPanel title={t(mapVideoAccessError(state.error))} tone="danger">
        <Button label={t('common.retry')} onPress={state.reload} />
      </StatusPanel>
    );
  }

  // Keyed by playbackUrl: a refreshed capability (new token, same or different
  // URL) mounts a fresh player/source rather than attempting an in-place
  // `replace()` — simpler and unambiguous, and refreshes are rare (only on a
  // playback error or a foreground resume near expiry — never on a timer).
  return (
    <VideoPlayerSurface
      key={state.data.playbackUrl}
      title={title}
      access={state.data}
      onNeedsRefresh={state.reload}
      onPlaybackEnded={onPlaybackEnded}
    />
  );
}

function VideoPlayerSurface({
  title,
  access,
  onNeedsRefresh,
  onPlaybackEnded,
}: {
  title: string;
  access: VideoAccessResponse;
  onNeedsRefresh: () => void;
  onPlaybackEnded: () => void;
}) {
  const { t } = useI18n();
  const tokens = useThemeTokens();

  const player = useVideoPlayer({ uri: access.playbackUrl, contentType: 'hls' }, (p) => {
    // Explicit, not just relying on the (already-false) default: a protected
    // lesson video must never keep rendering/decoding once the app leaves the
    // foreground — see useVideoLifecycle, which also actively calls pause().
    p.staysActiveInBackground = false;
    // No OS "now playing" notification surfacing this protected video's title
    // while the app is backgrounded.
    p.showNowPlayingNotification = false;
  });

  const { status, error } = useEvent(player, 'statusChange', { status: player.status });
  const { warningVisible } = useCaptureProtection({
    protectionKey: 'edvora.video-lesson',
    onCaptureDetected: () => player.pause(),
  });
  useVideoLifecycle({ player, expiresAt: access.expiresAt, onNeedsRefresh });
  // The V1 completion trigger: fires once per genuine natural-end event the
  // native player emits — never on open/play/buffer/partial playback. Safe to
  // wire unconditionally (no "already completed" check here): `onPlaybackEnded`
  // is `useLessonCompletion`'s `trigger`, which is itself idempotent/duplicate-
  // safe (see use-lesson-completion.ts).
  useEventListener(player, 'playToEnd', onPlaybackEnded);

  return (
    <View style={{ gap: spacing.sm }}>
      <View style={[styles.playerContainer, { backgroundColor: '#000' }]}>
        <VideoView
          player={player}
          style={styles.player}
          nativeControls
          contentFit="contain"
          // Deliberately off: PiP would let this protected video keep floating
          // and rendering over other apps/screens, outside the scoped
          // capture-protection/lifecycle handling this screen owns, and it does
          // not "come for free" (it needs its own config-plugin opt-in) — not
          // enabled this milestone.
          allowsPictureInPicture={false}
          accessibilityLabel={title}
        />
        {warningVisible ? (
          <View
            style={StyleSheet.absoluteFill}
            accessible
            accessibilityRole="alert"
            accessibilityLabel={t('video.captureWarning')}
          >
            <View style={[styles.warningOverlay, { backgroundColor: tokens.overlay }]}>
              <ThemedText variant="subtitle" style={styles.warningText}>
                {t('video.captureWarning')}
              </ThemedText>
            </View>
          </View>
        ) : null}
      </View>

      {status === 'loading' ? <LoadingPanel label={t('video.buffering')} /> : null}

      {status === 'error' ? (
        <StatusPanel title={t('video.playbackError')} body={error?.message} tone="danger">
          <Button label={t('common.retry')} onPress={onNeedsRefresh} />
        </StatusPanel>
      ) : null}

      <ThemedText variant="muted" style={styles.notice}>
        {t('video.captureNotice')}
      </ThemedText>
    </View>
  );
}

const styles = StyleSheet.create({
  playerContainer: {
    position: 'relative',
    width: '100%',
    aspectRatio: 16 / 9,
    borderRadius: radius.lg,
    overflow: 'hidden',
  },
  player: {
    width: '100%',
    height: '100%',
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
