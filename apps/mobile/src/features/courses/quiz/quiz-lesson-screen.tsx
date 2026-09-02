import { useCallback, useEffect, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { LoadingPanel, StatusPanel } from '@/components/ui/status-panel';
import { ThemedText } from '@/components/ui/themed-text';
import { useI18n } from '@/lib/i18n/i18n-context';
import type { TranslationKey } from '@/lib/i18n/translations';
import { useThemeTokens } from '@/lib/theme/theme-context';
import { radius, spacing } from '@/lib/theme/tokens';
import { useAsyncData } from '@/lib/use-async-data';
import { isApiError } from '@/lib/api/errors';
import { lessonTypeLabelKey } from '../lesson-type-routing';
import type { LessonTypeScreenProps } from '../lesson-type-screens';
import { progressLabelKey } from '../progress-labels';
import { useContentAccessRecovery } from '../use-content-access-recovery';
import { answersFromAttemptQuestions, countUnanswered, type QuizAnswers } from './quiz-answer-state';
import { resolveQuizAvailabilityPhase, type QuizAvailabilityPhase } from './quiz-availability';
import { fetchQuizContent, saveQuizAnswer, startQuizAttempt, submitQuizAttempt } from './quiz-client';
import { mapQuizError } from './quiz-error-mapping';
import { formatPercentageValue, formatScoreFraction } from './quiz-result-format';
import type { StudentQuizAttemptDetail, StudentQuizContent } from './quiz-types';

/**
 * Replaces only the QUIZ placeholder in the lesson-type registry
 * (lesson-type-screens.tsx) — VIDEO and DOCUMENT are untouched. Never calls
 * the generic lesson-completion endpoint: `submitAttempt` is itself the only
 * authoritative path to Quiz Lesson completion (see
 * `docs/QUIZ-ATTEMPTS.md`'s "Quiz Lesson completion" section) — this screen
 * never makes a second call.
 */
export function QuizLessonScreen({ lesson, courseId, onRetry }: LessonTypeScreenProps) {
  const { t } = useI18n();
  const phase = resolveQuizAvailabilityPhase(lesson.quiz?.status ?? 'ARCHIVED');

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

      {phase === 'ready' ? (
        <QuizBody courseId={courseId} lessonId={lesson.lessonId} />
      ) : (
        <NotReadyBody phase={phase} onRetry={onRetry} />
      )}
    </View>
  );
}

function NotReadyBody({ phase, onRetry }: { phase: Exclude<QuizAvailabilityPhase, 'ready'>; onRetry: () => void }) {
  const { t } = useI18n();

  if (phase === 'draft') {
    return (
      <StatusPanel title={t('quiz.notPublishedTitle')} body={t('quiz.notPublishedBody')} tone="warning">
        <Button label={t('common.retry')} variant="secondary" onPress={onRetry} />
      </StatusPanel>
    );
  }

  return (
    <StatusPanel title={t('quiz.error.notAvailable')} tone="danger">
      <Button label={t('common.retry')} variant="secondary" onPress={onRetry} />
    </StatusPanel>
  );
}

function QuizBody({ courseId, lessonId }: { courseId: string; lessonId: string }) {
  const { t } = useI18n();
  const recoverFromContentError = useContentAccessRecovery();

  const fetchContent = useCallback(() => fetchQuizContent(courseId, lessonId), [courseId, lessonId]);
  const state = useAsyncData(fetchContent);
  const contentError = state.status === 'error' ? state.error : null;

  useEffect(() => {
    if (contentError) {
      recoverFromContentError(contentError);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [contentError]);

  if (state.status === 'loading') {
    return <LoadingPanel label={t('quiz.loading')} />;
  }

  if (state.status === 'error') {
    return (
      <StatusPanel title={t(mapQuizError(state.error))} tone="danger">
        <Button label={t('common.retry')} onPress={state.reload} />
      </StatusPanel>
    );
  }

  return <QuizAttemptFlow courseId={courseId} lessonId={lessonId} content={state.data} />;
}

function QuizAttemptFlow({
  courseId,
  lessonId,
  content,
}: {
  courseId: string;
  lessonId: string;
  content: StudentQuizContent;
}) {
  const { t } = useI18n();
  const recoverFromContentError = useContentAccessRecovery();

  const [attempt, setAttempt] = useState<StudentQuizAttemptDetail | null>(null);
  const [answers, setAnswers] = useState<QuizAnswers>({});
  const [starting, setStarting] = useState(false);
  const [startError, setStartError] = useState<unknown>(null);
  const [attemptsExhausted, setAttemptsExhausted] = useState(false);
  const [savingQuestionId, setSavingQuestionId] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<unknown>(null);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<unknown>(null);

  const handleStart = useCallback(async () => {
    if (starting) {
      return;
    }

    setStarting(true);
    setStartError(null);

    try {
      const result = await startQuizAttempt(courseId, lessonId);
      setAttempt(result);
      setAnswers(answersFromAttemptQuestions(result.questions));
    } catch (error) {
      setStartError(error);
      recoverFromContentError(error);

      if (isApiError(error) && error.code === 'QUIZ_ATTEMPT_LIMIT_REACHED') {
        setAttemptsExhausted(true);
      }
    } finally {
      setStarting(false);
    }
  }, [starting, courseId, lessonId, recoverFromContentError]);

  const handleSelect = useCallback(
    async (questionId: string, optionId: string) => {
      if (!attempt || attempt.status !== 'IN_PROGRESS' || savingQuestionId) {
        return;
      }

      setAnswers((previous) => ({ ...previous, [questionId]: optionId }));
      setSavingQuestionId(questionId);
      setSaveError(null);

      try {
        const updated = await saveQuizAnswer(courseId, lessonId, attempt.attemptId, questionId, optionId);
        setAttempt(updated);
        setAnswers(answersFromAttemptQuestions(updated.questions));
      } catch (error) {
        setSaveError(error);
        recoverFromContentError(error);
        // Resync from the server's own truth rather than trusting the optimistic
        // local selection any further — a failed save must never leave the UI
        // showing a selection the backend never actually recorded.
        setAnswers(answersFromAttemptQuestions(attempt.questions));
      } finally {
        setSavingQuestionId(null);
      }
    },
    [attempt, savingQuestionId, courseId, lessonId, recoverFromContentError],
  );

  const handleSubmit = useCallback(async () => {
    if (!attempt || attempt.status !== 'IN_PROGRESS' || submitting) {
      return;
    }

    setSubmitting(true);
    setSubmitError(null);

    try {
      const graded = await submitQuizAttempt(courseId, lessonId, attempt.attemptId);
      setAttempt(graded);
      setAnswers(answersFromAttemptQuestions(graded.questions));
    } catch (error) {
      setSubmitError(error);
      recoverFromContentError(error);
    } finally {
      setSubmitting(false);
    }
  }, [attempt, submitting, courseId, lessonId, recoverFromContentError]);

  if (!attempt) {
    return (
      <View style={{ gap: spacing.md }}>
        <View style={{ gap: spacing.xs }}>
          <ThemedText variant="title">{content.title}</ThemedText>
          {content.description ? <ThemedText variant="muted">{content.description}</ThemedText> : null}
          <ThemedText variant="muted">{questionCountLabel(t, content.questions.length)}</ThemedText>
        </View>

        {attemptsExhausted ? (
          <StatusPanel title={t('quiz.error.attemptLimitReached')} tone="danger" />
        ) : (
          <>
            <Button label={t('quiz.start')} onPress={handleStart} loading={starting} />
            {startError ? (
              <StatusPanel title={t(mapQuizError(startError))} tone="danger">
                <Button label={t('common.retry')} variant="secondary" onPress={handleStart} />
              </StatusPanel>
            ) : null}
          </>
        )}
      </View>
    );
  }

  if (attempt.result) {
    return (
      <QuizResultBody
        attempt={attempt}
        attemptsExhausted={attemptsExhausted}
        onRetake={handleStart}
        retaking={starting}
        retakeError={startError}
      />
    );
  }

  const unanswered = countUnanswered(attempt.questions, answers);

  return (
    <View style={{ gap: spacing.lg }}>
      {attempt.questions.map((question, index) => (
        <QuizQuestionCard
          key={question.questionId}
          index={index + 1}
          question={question}
          selectedOptionId={answers[question.questionId] ?? null}
          disabled={savingQuestionId !== null || submitting}
          saving={savingQuestionId === question.questionId}
          onSelect={(optionId) => handleSelect(question.questionId, optionId)}
        />
      ))}

      {saveError ? <StatusPanel title={t(mapQuizError(saveError))} tone="danger" /> : null}

      {unanswered > 0 ? <ThemedText variant="muted">{unansweredLabel(t, unanswered)}</ThemedText> : null}

      <Button label={t('quiz.submit')} onPress={handleSubmit} loading={submitting} />

      {submitError ? (
        <StatusPanel title={t(mapQuizError(submitError))} tone="danger">
          <Button label={t('common.retry')} variant="secondary" onPress={handleSubmit} />
        </StatusPanel>
      ) : null}
    </View>
  );
}

function QuizQuestionCard({
  index,
  question,
  selectedOptionId,
  disabled,
  saving,
  onSelect,
}: {
  index: number;
  question: StudentQuizAttemptDetail['questions'][number];
  selectedOptionId: string | null;
  disabled: boolean;
  saving: boolean;
  onSelect: (optionId: string) => void;
}) {
  const { t } = useI18n();
  const tokens = useThemeTokens();

  return (
    <View style={[styles.card, { backgroundColor: tokens.surface, borderColor: tokens.border }]}>
      <ThemedText variant="label" style={{ color: tokens.textMuted }}>
        {questionNumberLabel(t, index)}
      </ThemedText>
      <ThemedText variant="subtitle">{question.prompt}</ThemedText>

      <View style={{ gap: spacing.sm, marginTop: spacing.sm }}>
        {question.options.map((option) => {
          const selected = option.optionId === selectedOptionId;

          return (
            <Pressable
              key={option.optionId}
              accessibilityRole="radio"
              accessibilityState={{ selected, disabled }}
              disabled={disabled}
              onPress={() => onSelect(option.optionId)}
              style={({ pressed }) => [
                styles.option,
                {
                  borderColor: selected ? tokens.primary : tokens.border,
                  backgroundColor: selected ? tokens.surfaceAlt : 'transparent',
                  opacity: disabled && !selected ? 0.6 : pressed ? 0.85 : 1,
                },
              ]}
            >
              <View style={[styles.radioOuter, { borderColor: selected ? tokens.primary : tokens.textMuted }]}>
                {selected ? <View style={[styles.radioInner, { backgroundColor: tokens.primary }]} /> : null}
              </View>
              <ThemedText variant="body" style={styles.optionText}>
                {option.label ? `${option.label}. ${option.text}` : option.text}
              </ThemedText>
            </Pressable>
          );
        })}
      </View>

      {saving ? (
        <ThemedText variant="muted" style={{ marginTop: spacing.xs }}>
          {t('quiz.saving')}
        </ThemedText>
      ) : null}
    </View>
  );
}

function QuizResultBody({
  attempt,
  attemptsExhausted,
  onRetake,
  retaking,
  retakeError,
}: {
  attempt: StudentQuizAttemptDetail;
  attemptsExhausted: boolean;
  onRetake: () => void;
  retaking: boolean;
  retakeError: unknown;
}) {
  const { t } = useI18n();
  const result = attempt.result;

  if (!result) {
    return null;
  }

  const passLabel = result.passed === null ? t('quiz.result.noThreshold') : result.passed ? t('quiz.result.passed') : t('quiz.result.failed');
  const passTone = result.passed === null ? 'neutral' : result.passed ? 'success' : 'danger';
  const percentage = formatPercentageValue(result.percentage);

  return (
    <View style={{ gap: spacing.md }}>
      <StatusPanel title={t('quiz.result.title')} tone={passTone}>
        <View style={{ gap: spacing.xs }}>
          <Badge label={passLabel} tone={result.passed === true ? 'success' : 'neutral'} />
          <ThemedText variant="subtitle">{formatScoreFraction(result.scorePoints, result.maxPoints)}</ThemedText>
          {percentage ? <ThemedText variant="muted">{percentage}</ThemedText> : null}
        </View>
      </StatusPanel>

      {attemptsExhausted ? (
        <StatusPanel title={t('quiz.error.attemptLimitReached')} tone="danger" />
      ) : (
        <>
          <Button label={t('quiz.retake')} variant="secondary" onPress={onRetake} loading={retaking} />
          {retakeError ? <StatusPanel title={t(mapQuizError(retakeError))} tone="danger" /> : null}
        </>
      )}
    </View>
  );
}

function questionCountLabel(t: (key: TranslationKey) => string, count: number): string {
  return `${count} ${t('quiz.questionsLabel')}`;
}

function questionNumberLabel(t: (key: TranslationKey) => string, index: number): string {
  return `${t('quiz.questionLabel')} ${index}`;
}

function unansweredLabel(t: (key: TranslationKey) => string, count: number): string {
  return `${count} ${t('quiz.unansweredSuffix')}`;
}

const styles = StyleSheet.create({
  card: {
    borderWidth: 1,
    borderRadius: radius.lg,
    padding: spacing.lg,
  },
  option: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    borderWidth: 1,
    borderRadius: radius.md,
    padding: spacing.sm,
    minHeight: 48,
  },
  optionText: {
    flex: 1,
  },
  radioOuter: {
    width: 20,
    height: 20,
    borderRadius: 10,
    borderWidth: 2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  radioInner: {
    width: 10,
    height: 10,
    borderRadius: 5,
  },
});
