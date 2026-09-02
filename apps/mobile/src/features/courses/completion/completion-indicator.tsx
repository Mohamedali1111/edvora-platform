import { Button } from '@/components/ui/button';
import { StatusPanel } from '@/components/ui/status-panel';
import { ThemedText } from '@/components/ui/themed-text';
import { useI18n } from '@/lib/i18n/i18n-context';
import type { TranslationKey } from '@/lib/i18n/translations';
import type { CompletionPhase } from './completion-state';

/**
 * The one visible surface for a completion attempt's own in-flight/result
 * state, shared by VIDEO and DOCUMENT screens (§6/§16 of the milestone spec).
 * Deliberately quiet for the non-error phases — plain text, not an `alert`-
 * role `StatusPanel` box — since 'saving'/'saved' are expected, idempotent,
 * background-ish updates, not something that should compete for attention
 * with the lesson's own progress Badge (which already reflects this same
 * `phase` — see video-lesson-screen.tsx/document-lesson-screen.tsx). Renders
 * nothing for 'idle': a lesson that hasn't triggered a completion attempt
 * (and wasn't already COMPLETED) has nothing to report yet.
 *
 * `accessibilityLiveRegion="polite"` announces the saving/saved text once,
 * without interrupting whatever the screen reader is already doing — never
 * `"assertive"`, and this component only re-renders when `phase` actually
 * changes (guarded upstream by the completion state machine's own duplicate-
 * trigger suppression), so it never re-announces the same idempotent update.
 */
export function CompletionIndicator({
  phase,
  errorKey,
  onRetry,
}: {
  phase: CompletionPhase;
  errorKey: TranslationKey | null;
  onRetry: () => void;
}) {
  const { t } = useI18n();

  if (phase === 'saving') {
    return (
      <ThemedText variant="muted" accessibilityLiveRegion="polite">
        {t('courses.completion.saving')}
      </ThemedText>
    );
  }

  if (phase === 'saved') {
    return (
      <ThemedText variant="muted" accessibilityLiveRegion="polite">
        {t('courses.completion.saved')}
      </ThemedText>
    );
  }

  if (phase === 'error') {
    return (
      <StatusPanel title={t(errorKey ?? 'courses.completion.error.generic')} tone="danger">
        <Button label={t('common.retry')} variant="secondary" onPress={onRetry} />
      </StatusPanel>
    );
  }

  return null;
}
