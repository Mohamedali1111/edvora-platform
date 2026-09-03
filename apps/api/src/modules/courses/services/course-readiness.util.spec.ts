import {
  AssetProcessingStatus,
  LessonStatus,
  LessonType,
  QuestionType,
  QuizStatus,
  SectionStatus,
} from '../../../../.generated/prisma/client';
import { CourseDataIntegrityError } from '../errors/course.errors';
import {
  evaluateCourseReadiness,
  type ReadinessLessonRow,
  type ReadinessQuizRow,
  type ReadinessSectionRow,
} from './course-readiness.util';

const NOW = new Date('2026-09-03T00:00:00.000Z');
const PAST = new Date('2026-01-01T00:00:00.000Z');
const FUTURE = new Date('2027-01-01T00:00:00.000Z');

function decimal(value: number): { toNumber(): number } {
  return { toNumber: () => value };
}

function validQuiz(overrides: Partial<ReadinessQuizRow> = {}): ReadinessQuizRow {
  return {
    id: 'quiz-1',
    title: 'Quiz Title',
    status: QuizStatus.DRAFT,
    passingScorePercent: null,
    attemptLimit: null,
    questions: [
      { type: QuestionType.TRUE_FALSE, points: decimal(1), options: [{ isCorrect: true }, { isCorrect: false }] },
    ],
    ...overrides,
  };
}

function videoLessonRow(overrides: Partial<ReadinessLessonRow> = {}): ReadinessLessonRow {
  return {
    id: 'lesson-1',
    title: 'Video Lesson',
    status: LessonStatus.DRAFT,
    type: LessonType.VIDEO,
    availableFrom: null,
    availableUntil: null,
    videoLesson: {
      videoAsset: { id: 'video-1', processingStatus: AssetProcessingStatus.READY, failureCode: null },
    },
    documentLesson: null,
    quizLesson: null,
    ...overrides,
  };
}

function documentLessonRow(overrides: Partial<ReadinessLessonRow> = {}): ReadinessLessonRow {
  return {
    id: 'lesson-2',
    title: 'Document Lesson',
    status: LessonStatus.DRAFT,
    type: LessonType.DOCUMENT,
    availableFrom: null,
    availableUntil: null,
    videoLesson: null,
    documentLesson: {
      documentAsset: { id: 'document-1', processingStatus: AssetProcessingStatus.READY, failureReason: null },
    },
    quizLesson: null,
    ...overrides,
  };
}

function quizLessonRow(overrides: Partial<ReadinessLessonRow> = {}, quizOverrides: Partial<ReadinessQuizRow> = {}): ReadinessLessonRow {
  return {
    id: 'lesson-3',
    title: 'Quiz Lesson',
    status: LessonStatus.DRAFT,
    type: LessonType.QUIZ,
    availableFrom: null,
    availableUntil: null,
    videoLesson: null,
    documentLesson: null,
    quizLesson: { quiz: validQuiz(quizOverrides) },
    ...overrides,
  };
}

function section(overrides: Partial<ReadinessSectionRow> = {}): ReadinessSectionRow {
  return {
    id: 'section-1',
    title: 'Section Title',
    status: SectionStatus.DRAFT,
    lessons: [],
    ...overrides,
  };
}

describe('evaluateCourseReadiness', () => {
  it('is deterministic and empty for a Course with no Sections', () => {
    const result = evaluateCourseReadiness('course-1', [], NOW);
    expect(result).toEqual({
      courseId: 'course-1',
      ready: false,
      blockers: [],
      advisories: [],
      readyToPublish: { sections: [], lessons: [], quizzes: [] },
    });
  });

  it('a brand-new DRAFT Course/Section/Lesson with READY content is a first-publish candidate without any DRAFT-lifecycle blocker', () => {
    const result = evaluateCourseReadiness('course-1', [section({ lessons: [videoLessonRow()] })], NOW);
    expect(result.blockers).toEqual([]);
    expect(result.ready).toBe(true);
    expect(result.readyToPublish.sections).toEqual([{ sectionId: 'section-1', title: 'Section Title' }]);
    expect(result.readyToPublish.lessons).toEqual([
      { lessonId: 'lesson-1', sectionId: 'section-1', title: 'Video Lesson', type: 'VIDEO' },
    ]);
  });

  it('excludes an already-PUBLISHED Lesson from candidates (it needs no transition) without blocking it either', () => {
    const result = evaluateCourseReadiness(
      'course-1',
      [section({ status: SectionStatus.PUBLISHED, lessons: [videoLessonRow({ status: LessonStatus.PUBLISHED })] })],
      NOW,
    );
    expect(result.blockers).toEqual([]);
    expect(result.readyToPublish.lessons).toEqual([]);
    expect(result.readyToPublish.sections).toEqual([]);
    expect(result.ready).toBe(false);
  });

  it('excludes an already-PUBLISHED Section from candidates (it needs no transition)', () => {
    const result = evaluateCourseReadiness(
      'course-1',
      [section({ status: SectionStatus.PUBLISHED, lessons: [videoLessonRow()] })],
      NOW,
    );
    // The DRAFT Lesson underneath is still its own valid candidate...
    expect(result.readyToPublish.lessons).toEqual([
      { lessonId: 'lesson-1', sectionId: 'section-1', title: 'Video Lesson', type: 'VIDEO' },
    ]);
    // ...but the already-PUBLISHED Section itself is not listed as something to transition.
    expect(result.readyToPublish.sections).toEqual([]);
    expect(result.ready).toBe(true);
  });

  it('reports SECTION_EMPTY as an advisory for a Section with no Lessons and excludes it from candidates', () => {
    const result = evaluateCourseReadiness('course-1', [section()], NOW);
    expect(result.advisories).toEqual([
      { reasonCode: 'SECTION_EMPTY', entityType: 'SECTION', entityId: 'section-1', title: 'Section Title' },
    ]);
    expect(result.readyToPublish.sections).toEqual([]);
    expect(result.ready).toBe(false);
  });

  it('excludes a DRAFT Section from candidates when all its Lessons are unready, without a SECTION_EMPTY advisory', () => {
    const result = evaluateCourseReadiness(
      'course-1',
      [
        section({
          lessons: [
            videoLessonRow({
              videoLesson: { videoAsset: { id: 'video-1', processingStatus: AssetProcessingStatus.PROCESSING, failureCode: null } },
            }),
          ],
        }),
      ],
      NOW,
    );
    expect(result.advisories).toEqual([]);
    expect(result.readyToPublish.sections).toEqual([]);
    expect(result.readyToPublish.lessons).toEqual([]);
    expect(result.ready).toBe(false);
    expect(result.blockers).toEqual([expect.objectContaining({ reasonCode: 'VIDEO_PREPARING' })]);
  });

  it('skips an ARCHIVED Section entirely: no blocker, no advisory, not a candidate', () => {
    const result = evaluateCourseReadiness('course-1', [section({ status: SectionStatus.ARCHIVED })], NOW);
    expect(result).toEqual({
      courseId: 'course-1',
      ready: false,
      blockers: [],
      advisories: [],
      readyToPublish: { sections: [], lessons: [], quizzes: [] },
    });
  });

  it('skips an ARCHIVED Lesson entirely and does not count it toward SECTION_EMPTY', () => {
    const result = evaluateCourseReadiness(
      'course-1',
      [section({ lessons: [videoLessonRow({ status: LessonStatus.ARCHIVED })] })],
      NOW,
    );
    expect(result.blockers).toEqual([]);
    expect(result.advisories).toEqual([
      { reasonCode: 'SECTION_EMPTY', entityType: 'SECTION', entityId: 'section-1', title: 'Section Title' },
    ]);
  });

  describe('VIDEO Lessons', () => {
    it('is a ready candidate when DRAFT and the referenced VideoAsset is READY', () => {
      const result = evaluateCourseReadiness('course-1', [section({ lessons: [videoLessonRow()] })], NOW);
      expect(result.blockers).toEqual([]);
      expect(result.readyToPublish.lessons).toEqual([
        { lessonId: 'lesson-1', sectionId: 'section-1', title: 'Video Lesson', type: 'VIDEO' },
      ]);
    });

    it.each([AssetProcessingStatus.UPLOADING, AssetProcessingStatus.PROCESSING])(
      'reports VIDEO_PREPARING for %s regardless of Lesson lifecycle status',
      (processingStatus) => {
        const result = evaluateCourseReadiness(
          'course-1',
          [section({ lessons: [videoLessonRow({ videoLesson: { videoAsset: { id: 'video-1', processingStatus, failureCode: null } } })] })],
          NOW,
        );
        expect(result.blockers).toEqual([
          {
            reasonCode: 'VIDEO_PREPARING',
            entityType: 'VIDEO_ASSET',
            entityId: 'video-1',
            parentLessonId: 'lesson-1',
            parentSectionId: 'section-1',
            title: 'Video Lesson',
          },
        ]);
        expect(result.readyToPublish.lessons).toEqual([]);
      },
    );

    it('reports VIDEO_FAILED with the raw failureCode as detail', () => {
      const result = evaluateCourseReadiness(
        'course-1',
        [
          section({
            lessons: [
              videoLessonRow({
                videoLesson: {
                  videoAsset: { id: 'video-1', processingStatus: AssetProcessingStatus.FAILED, failureCode: 'BUNNY_STREAM_ENCODING_FAILED' },
                },
              }),
            ],
          }),
        ],
        NOW,
      );
      expect(result.blockers).toEqual([
        {
          reasonCode: 'VIDEO_FAILED',
          entityType: 'VIDEO_ASSET',
          entityId: 'video-1',
          parentLessonId: 'lesson-1',
          parentSectionId: 'section-1',
          title: 'Video Lesson',
          detail: 'BUNNY_STREAM_ENCODING_FAILED',
        },
      ]);
    });

    it('reports VIDEO_ASSET_ARCHIVED for an archived VideoAsset', () => {
      const result = evaluateCourseReadiness(
        'course-1',
        [
          section({
            lessons: [
              videoLessonRow({
                videoLesson: { videoAsset: { id: 'video-1', processingStatus: AssetProcessingStatus.ARCHIVED, failureCode: null } },
              }),
            ],
          }),
        ],
        NOW,
      );
      expect(result.blockers).toEqual([
        {
          reasonCode: 'VIDEO_ASSET_ARCHIVED',
          entityType: 'VIDEO_ASSET',
          entityId: 'video-1',
          parentLessonId: 'lesson-1',
          parentSectionId: 'section-1',
          title: 'Video Lesson',
        },
      ]);
    });

    it('still reports a content blocker for an already-PUBLISHED Lesson whose video later failed (diagnostic, not a candidacy gate)', () => {
      const result = evaluateCourseReadiness(
        'course-1',
        [
          section({
            status: SectionStatus.PUBLISHED,
            lessons: [
              videoLessonRow({
                status: LessonStatus.PUBLISHED,
                videoLesson: { videoAsset: { id: 'video-1', processingStatus: AssetProcessingStatus.FAILED, failureCode: null } },
              }),
            ],
          }),
        ],
        NOW,
      );
      expect(result.blockers).toEqual([expect.objectContaining({ reasonCode: 'VIDEO_FAILED' })]);
      expect(result.readyToPublish.lessons).toEqual([]);
    });

    it('throws CourseDataIntegrityError when a VIDEO Lesson has no VideoLesson detail row', () => {
      expect(() =>
        evaluateCourseReadiness('course-1', [section({ lessons: [videoLessonRow({ videoLesson: null })] })], NOW),
      ).toThrow(CourseDataIntegrityError);
    });
  });

  describe('DOCUMENT Lessons', () => {
    it('is a ready candidate when DRAFT and the referenced DocumentAsset is READY', () => {
      const result = evaluateCourseReadiness('course-1', [section({ lessons: [documentLessonRow()] })], NOW);
      expect(result.blockers).toEqual([]);
      expect(result.readyToPublish.lessons).toEqual([
        { lessonId: 'lesson-2', sectionId: 'section-1', title: 'Document Lesson', type: 'DOCUMENT' },
      ]);
    });

    it.each([AssetProcessingStatus.UPLOADING, AssetProcessingStatus.PROCESSING])(
      'reports DOCUMENT_PREPARING for %s',
      (processingStatus) => {
        const result = evaluateCourseReadiness(
          'course-1',
          [
            section({
              lessons: [
                documentLessonRow({
                  documentLesson: { documentAsset: { id: 'document-1', processingStatus, failureReason: null } },
                }),
              ],
            }),
          ],
          NOW,
        );
        expect(result.blockers).toEqual([
          {
            reasonCode: 'DOCUMENT_PREPARING',
            entityType: 'DOCUMENT_ASSET',
            entityId: 'document-1',
            parentLessonId: 'lesson-2',
            parentSectionId: 'section-1',
            title: 'Document Lesson',
          },
        ]);
      },
    );

    it('reports DOCUMENT_FAILED with the raw failureReason as detail', () => {
      const result = evaluateCourseReadiness(
        'course-1',
        [
          section({
            lessons: [
              documentLessonRow({
                documentLesson: {
                  documentAsset: { id: 'document-1', processingStatus: AssetProcessingStatus.FAILED, failureReason: 'DOCUMENT_UPLOAD_SIZE_MISMATCH' },
                },
              }),
            ],
          }),
        ],
        NOW,
      );
      expect(result.blockers).toEqual([
        {
          reasonCode: 'DOCUMENT_FAILED',
          entityType: 'DOCUMENT_ASSET',
          entityId: 'document-1',
          parentLessonId: 'lesson-2',
          parentSectionId: 'section-1',
          title: 'Document Lesson',
          detail: 'DOCUMENT_UPLOAD_SIZE_MISMATCH',
        },
      ]);
    });

    it('reports DOCUMENT_ASSET_ARCHIVED for an archived DocumentAsset', () => {
      const result = evaluateCourseReadiness(
        'course-1',
        [
          section({
            lessons: [
              documentLessonRow({
                documentLesson: { documentAsset: { id: 'document-1', processingStatus: AssetProcessingStatus.ARCHIVED, failureReason: null } },
              }),
            ],
          }),
        ],
        NOW,
      );
      expect(result.blockers).toEqual([
        {
          reasonCode: 'DOCUMENT_ASSET_ARCHIVED',
          entityType: 'DOCUMENT_ASSET',
          entityId: 'document-1',
          parentLessonId: 'lesson-2',
          parentSectionId: 'section-1',
          title: 'Document Lesson',
        },
      ]);
    });

    it('throws CourseDataIntegrityError when a DOCUMENT Lesson has no DocumentLesson detail row', () => {
      expect(() =>
        evaluateCourseReadiness('course-1', [section({ lessons: [documentLessonRow({ documentLesson: null })] })], NOW),
      ).toThrow(CourseDataIntegrityError);
    });
  });

  describe('QUIZ Lessons', () => {
    it('is a ready candidate for a DRAFT Lesson referencing an already-PUBLISHED valid Quiz, and the Quiz is NOT listed (no transition needed)', () => {
      const result = evaluateCourseReadiness(
        'course-1',
        [section({ lessons: [quizLessonRow({}, { status: QuizStatus.PUBLISHED })] })],
        NOW,
      );
      expect(result.blockers).toEqual([]);
      expect(result.readyToPublish.lessons).toEqual([
        { lessonId: 'lesson-3', sectionId: 'section-1', title: 'Quiz Lesson', type: 'QUIZ' },
      ]);
      expect(result.readyToPublish.quizzes).toEqual([]);
    });

    it('is a ready candidate for a DRAFT Lesson referencing a valid DRAFT Quiz, and lists the Quiz informationally (future publish-selected will auto-publish it)', () => {
      const result = evaluateCourseReadiness(
        'course-1',
        [section({ lessons: [quizLessonRow({}, { status: QuizStatus.DRAFT })] })],
        NOW,
      );
      expect(result.blockers).toEqual([]);
      expect(result.readyToPublish.lessons).toEqual([
        { lessonId: 'lesson-3', sectionId: 'section-1', title: 'Quiz Lesson', type: 'QUIZ' },
      ]);
      expect(result.readyToPublish.quizzes).toEqual([{ quizId: 'quiz-1', lessonId: 'lesson-3', title: 'Quiz Title' }]);
    });

    it('reports QUIZ_ARCHIVED for an archived Quiz regardless of aggregate validity, and is not a candidate', () => {
      const result = evaluateCourseReadiness(
        'course-1',
        [section({ lessons: [quizLessonRow({}, { status: QuizStatus.ARCHIVED })] })],
        NOW,
      );
      expect(result.blockers).toEqual([
        {
          reasonCode: 'QUIZ_ARCHIVED',
          entityType: 'QUIZ',
          entityId: 'quiz-1',
          parentLessonId: 'lesson-3',
          parentSectionId: 'section-1',
          title: 'Quiz Title',
        },
      ]);
      expect(result.readyToPublish.lessons).toEqual([]);
      expect(result.readyToPublish.quizzes).toEqual([]);
    });

    it('reports QUIZ_NOT_PUBLISHABLE_NO_QUESTIONS for a Quiz with no active questions, and is not a candidate', () => {
      const result = evaluateCourseReadiness(
        'course-1',
        [section({ lessons: [quizLessonRow({}, { questions: [] })] })],
        NOW,
      );
      expect(result.blockers).toEqual([
        {
          reasonCode: 'QUIZ_NOT_PUBLISHABLE_NO_QUESTIONS',
          entityType: 'QUIZ',
          entityId: 'quiz-1',
          parentLessonId: 'lesson-3',
          parentSectionId: 'section-1',
          title: 'Quiz Title',
        },
      ]);
      expect(result.readyToPublish.lessons).toEqual([]);
      expect(result.readyToPublish.quizzes).toEqual([]);
    });

    it('reports QUIZ_NOT_PUBLISHABLE_MISSING_CORRECT_OPTION for a Quiz missing a correct option', () => {
      const result = evaluateCourseReadiness(
        'course-1',
        [
          section({
            lessons: [
              quizLessonRow(
                {},
                {
                  questions: [
                    { type: QuestionType.TRUE_FALSE, points: decimal(1), options: [{ isCorrect: false }, { isCorrect: false }] },
                  ],
                },
              ),
            ],
          }),
        ],
        NOW,
      );
      expect(result.blockers).toEqual([
        expect.objectContaining({ reasonCode: 'QUIZ_NOT_PUBLISHABLE_MISSING_CORRECT_OPTION' }),
      ]);
    });

    it('reports QUIZ_NOT_PUBLISHABLE_INVALID_POINTS for invalid points/configuration', () => {
      const result = evaluateCourseReadiness(
        'course-1',
        [
          section({
            lessons: [
              quizLessonRow(
                {},
                {
                  questions: [{ type: QuestionType.TRUE_FALSE, points: decimal(0), options: [{ isCorrect: true }, { isCorrect: false }] }],
                },
              ),
            ],
          }),
        ],
        NOW,
      );
      expect(result.blockers).toEqual([expect.objectContaining({ reasonCode: 'QUIZ_NOT_PUBLISHABLE_INVALID_POINTS' })]);
    });

    it('throws CourseDataIntegrityError when a QUIZ Lesson has no QuizLesson detail row', () => {
      expect(() =>
        evaluateCourseReadiness('course-1', [section({ lessons: [quizLessonRow({ quizLesson: null })] })], NOW),
      ).toThrow(CourseDataIntegrityError);
    });
  });

  describe('availability advisory', () => {
    it('reports LESSON_AVAILABILITY_WINDOW_ELAPSED when availableUntil is in the past, without blocking candidacy', () => {
      const result = evaluateCourseReadiness(
        'course-1',
        [section({ lessons: [videoLessonRow({ availableUntil: PAST })] })],
        NOW,
      );
      expect(result.advisories).toContainEqual({
        reasonCode: 'LESSON_AVAILABILITY_WINDOW_ELAPSED',
        entityType: 'LESSON',
        entityId: 'lesson-1',
        parentSectionId: 'section-1',
        title: 'Video Lesson',
        detail: PAST.toISOString(),
      });
      expect(result.readyToPublish.lessons).toEqual([
        { lessonId: 'lesson-1', sectionId: 'section-1', title: 'Video Lesson', type: 'VIDEO' },
      ]);
    });

    it('does not report the advisory when availableUntil is in the future', () => {
      const result = evaluateCourseReadiness(
        'course-1',
        [section({ lessons: [videoLessonRow({ availableUntil: FUTURE })] })],
        NOW,
      );
      expect(result.advisories).toEqual([]);
    });
  });

  it('computes the approved mandatory scenario: progressive authoring across two DRAFT Sections', () => {
    const sectionA = section({
      id: 'section-a',
      title: 'Section A',
      lessons: [
        videoLessonRow({ id: 'lesson-a1', title: 'Lesson A1' }),
        documentLessonRow({ id: 'lesson-a2', title: 'Lesson A2' }),
        quizLessonRow({ id: 'lesson-a3', title: 'Lesson A3' }, { id: 'quiz-a3', title: 'Quiz A3', status: QuizStatus.DRAFT }),
      ],
    });
    const sectionB = section({
      id: 'section-b',
      title: 'Section B',
      lessons: [
        videoLessonRow({
          id: 'lesson-b1',
          title: 'Lesson B1',
          videoLesson: { videoAsset: { id: 'video-b1', processingStatus: AssetProcessingStatus.PROCESSING, failureCode: null } },
        }),
      ],
    });

    const result = evaluateCourseReadiness('course-1', [sectionA, sectionB], NOW);

    expect(result.ready).toBe(true);
    expect(result.readyToPublish.sections).toEqual([{ sectionId: 'section-a', title: 'Section A' }]);
    expect(new Set(result.readyToPublish.lessons.map((lesson) => lesson.lessonId))).toEqual(
      new Set(['lesson-a1', 'lesson-a2', 'lesson-a3']),
    );
    expect(result.readyToPublish.quizzes).toEqual([{ quizId: 'quiz-a3', lessonId: 'lesson-a3', title: 'Quiz A3' }]);

    // Section B is simply absent from candidates — no DRAFT-lifecycle blocker for it or Lesson B1.
    expect(result.readyToPublish.sections.some((s) => s.sectionId === 'section-b')).toBe(false);
    expect(result.blockers).toEqual([
      expect.objectContaining({ reasonCode: 'VIDEO_PREPARING', entityId: 'video-b1', parentLessonId: 'lesson-b1' }),
    ]);
  });
});
