import { LessonStatus, LessonType, SectionStatus } from '../../../../.generated/prisma/client';
import {
  deriveSortedRequiredQuizIds,
  evaluateLessonLifecycleBlockers,
  evaluateSectionLifecycleBlockers,
  evaluateStructuralSelectionBlockers,
  type SelectionLessonRow,
} from './course-publish-selected.util';

function lesson(overrides: Partial<SelectionLessonRow> = {}): SelectionLessonRow {
  return {
    id: 'lesson-1',
    title: 'Lesson Title',
    sectionId: 'section-1',
    status: LessonStatus.DRAFT,
    type: LessonType.VIDEO,
    quizLesson: null,
    ...overrides,
  };
}

describe('evaluateSectionLifecycleBlockers', () => {
  it('returns no blocker for a DRAFT Section', () => {
    expect(
      evaluateSectionLifecycleBlockers([{ id: 's1', title: 'Section', status: SectionStatus.DRAFT }]),
    ).toEqual([]);
  });

  it.each([SectionStatus.PUBLISHED, SectionStatus.ARCHIVED])(
    'reports SECTION_NOT_SELECTABLE with the current status as detail for %s',
    (status) => {
      expect(evaluateSectionLifecycleBlockers([{ id: 's1', title: 'Section', status }])).toEqual([
        { reasonCode: 'SECTION_NOT_SELECTABLE', entityType: 'SECTION', entityId: 's1', title: 'Section', detail: status },
      ]);
    },
  );
});

describe('evaluateLessonLifecycleBlockers', () => {
  it('returns no blocker for a DRAFT Lesson', () => {
    expect(
      evaluateLessonLifecycleBlockers([{ id: 'l1', title: 'Lesson', sectionId: 's1', status: LessonStatus.DRAFT }]),
    ).toEqual([]);
  });

  it.each([LessonStatus.PUBLISHED, LessonStatus.ARCHIVED])(
    'reports LESSON_NOT_SELECTABLE with the current status as detail for %s',
    (status) => {
      expect(
        evaluateLessonLifecycleBlockers([{ id: 'l1', title: 'Lesson', sectionId: 's1', status }]),
      ).toEqual([
        {
          reasonCode: 'LESSON_NOT_SELECTABLE',
          entityType: 'LESSON',
          entityId: 'l1',
          parentSectionId: 's1',
          title: 'Lesson',
          detail: status,
        },
      ]);
    },
  );
});

describe('evaluateStructuralSelectionBlockers', () => {
  it('allows a Lesson whose Section is included in the submitted sectionIds', () => {
    const blockers = evaluateStructuralSelectionBlockers(
      [lesson({ sectionId: 'section-a' })],
      new Set(['section-a']),
      new Map([['section-a', SectionStatus.DRAFT]]),
    );
    expect(blockers).toEqual([]);
  });

  it('allows a Lesson whose Section is not submitted but is already PUBLISHED', () => {
    const blockers = evaluateStructuralSelectionBlockers(
      [lesson({ sectionId: 'section-a' })],
      new Set(),
      new Map([['section-a', SectionStatus.PUBLISHED]]),
    );
    expect(blockers).toEqual([]);
  });

  it('rejects a Lesson whose DRAFT Section is neither submitted nor published', () => {
    const blockers = evaluateStructuralSelectionBlockers(
      [lesson({ id: 'lesson-x', title: 'Lesson X', sectionId: 'section-a' })],
      new Set(),
      new Map([['section-a', SectionStatus.DRAFT]]),
    );
    expect(blockers).toEqual([
      {
        reasonCode: 'LESSON_SECTION_NOT_INCLUDED',
        entityType: 'LESSON',
        entityId: 'lesson-x',
        parentSectionId: 'section-a',
        title: 'Lesson X',
      },
    ]);
  });

  it('rejects a Lesson whose Section is ARCHIVED and not submitted (ARCHIVED is never an implicit pass)', () => {
    const blockers = evaluateStructuralSelectionBlockers(
      [lesson({ sectionId: 'section-a' })],
      new Set(),
      new Map([['section-a', SectionStatus.ARCHIVED]]),
    );
    expect(blockers).toHaveLength(1);
    expect(blockers[0].reasonCode).toBe('LESSON_SECTION_NOT_INCLUDED');
  });
});

describe('deriveSortedRequiredQuizIds', () => {
  it('returns an empty array when no Lesson is a QUIZ type', () => {
    expect(deriveSortedRequiredQuizIds([lesson({ type: LessonType.VIDEO })])).toEqual([]);
  });

  it('collects distinct Quiz IDs from QUIZ Lessons only, sorted deterministically', () => {
    const lessons = [
      lesson({ id: 'l1', type: LessonType.QUIZ, quizLesson: { quizId: 'quiz-c' } }),
      lesson({ id: 'l2', type: LessonType.VIDEO, quizLesson: null }),
      lesson({ id: 'l3', type: LessonType.QUIZ, quizLesson: { quizId: 'quiz-a' } }),
      lesson({ id: 'l4', type: LessonType.QUIZ, quizLesson: { quizId: 'quiz-c' } }),
      lesson({ id: 'l5', type: LessonType.QUIZ, quizLesson: { quizId: 'quiz-b' } }),
    ];

    expect(deriveSortedRequiredQuizIds(lessons)).toEqual(['quiz-a', 'quiz-b', 'quiz-c']);
  });

  it('ignores a QUIZ-typed row with no quizLesson relation rather than throwing', () => {
    expect(deriveSortedRequiredQuizIds([lesson({ type: LessonType.QUIZ, quizLesson: null })])).toEqual([]);
  });
});
