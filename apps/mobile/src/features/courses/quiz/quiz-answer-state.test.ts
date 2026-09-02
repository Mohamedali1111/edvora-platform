import assert from 'node:assert/strict';
import test from 'node:test';
import { answersFromAttemptQuestions, countUnanswered, isQuizAttemptGraded } from './quiz-answer-state';
import type { StudentQuizAttemptQuestion } from './quiz-types';

function question(questionId: string, selectedOptionId: string | null): StudentQuizAttemptQuestion {
  return {
    questionId,
    type: 'MULTIPLE_CHOICE',
    prompt: 'x',
    position: 0,
    options: [],
    selectedOptionId,
  };
}

test('answersFromAttemptQuestions maps each question to its own selected option, including unanswered', () => {
  const questions = [question('q1', 'opt-a'), question('q2', null)];
  assert.deepEqual(answersFromAttemptQuestions(questions), { q1: 'opt-a', q2: null });
});

test('countUnanswered counts only questions with no saved selection', () => {
  const questions = [question('q1', 'opt-a'), question('q2', null), question('q3', null)];
  const answers = answersFromAttemptQuestions(questions);
  assert.equal(countUnanswered(questions, answers), 2);
});

test('countUnanswered is zero once every question has a selection', () => {
  const questions = [question('q1', 'opt-a'), question('q2', 'opt-b')];
  const answers = answersFromAttemptQuestions(questions);
  assert.equal(countUnanswered(questions, answers), 0);
});

test('isQuizAttemptGraded is true only for GRADED', () => {
  assert.equal(isQuizAttemptGraded('GRADED'), true);
  assert.equal(isQuizAttemptGraded('IN_PROGRESS'), false);
  assert.equal(isQuizAttemptGraded('SUBMITTED'), false);
  assert.equal(isQuizAttemptGraded('ABANDONED'), false);
});
