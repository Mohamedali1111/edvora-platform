import { Injectable } from '@nestjs/common';
import { QuestionStatus, QuestionType } from '../../../../.generated/prisma/client';
import { PrismaService } from '../../../infrastructure/database/prisma.service';
import type { AuthenticatedPrincipal } from '../../auth/http/authenticated-principal';
import { StudentCourseAccessService } from '../../courses/services/student-course-access.service';
import type { StudentQuestion, StudentQuestionOption, StudentQuizContent } from '../types/student-quiz.types';

type QuizContentRow = {
  id: string;
  title: string;
  description: string | null;
  questions: Array<{
    id: string;
    type: QuestionType;
    prompt: string;
    position: number;
    options: Array<{ id: string; label: string | null; text: string; position: number }>;
  }>;
};

@Injectable()
export class StudentQuizService {
  constructor(
    private readonly prismaService: PrismaService,
    private readonly access: StudentCourseAccessService,
  ) {}

  /**
   * Pure content-delivery read: it never creates a `QuizAttempt`, never writes
   * `LessonProgress`, and never consumes an attempt count. Every safety property lives in two
   * places: (1) linkage/lifecycle proof happens entirely in
   * `StudentCourseAccessService.assertAccessibleQuizLesson` — this method never re-derives or
   * duplicates that chain, it only trusts the `(tenantId, quizId)` pair the proof returns; (2)
   * response shaping uses the `StudentQuizContent`/`StudentQuestion`/`StudentQuestionOption`
   * family exclusively — never the instructor-authoring `QuizSummary`/`QuestionSummary`/
   * `QuestionOptionSummary` types, which intentionally carry `isCorrect` and other authoring-only
   * fields a student must never see. Questions are filtered to `ACTIVE` (the schema's only
   * student-visible question state); `QuestionOption` has no status/lifecycle field at all, so
   * every option of an included question is returned. Both are ordered by their persisted
   * `position` (unique per parent, so this is already fully deterministic), with `id` as an
   * explicit tie-break to match the ordering convention used elsewhere in this codebase.
   */
  async getQuizForLesson(
    principal: AuthenticatedPrincipal,
    courseId: string,
    lessonId: string,
  ): Promise<StudentQuizContent> {
    const { tenantId, quizId } = await this.access.assertAccessibleQuizLesson(principal, courseId, lessonId);

    const quiz = await this.prismaService.client.quiz.findUniqueOrThrow({
      where: { id_tenantId: { id: quizId, tenantId } },
      select: {
        id: true,
        title: true,
        description: true,
        questions: {
          where: { status: QuestionStatus.ACTIVE },
          orderBy: [{ position: 'asc' }, { id: 'asc' }],
          select: {
            id: true,
            type: true,
            prompt: true,
            position: true,
            options: {
              orderBy: [{ position: 'asc' }, { id: 'asc' }],
              select: { id: true, label: true, text: true, position: true },
            },
          },
        },
      },
    });

    return toStudentQuizContent(quiz);
  }
}

function toStudentQuizContent(quiz: QuizContentRow): StudentQuizContent {
  return {
    quizId: quiz.id,
    title: quiz.title,
    description: quiz.description,
    questions: quiz.questions.map(toStudentQuestion),
  };
}

function toStudentQuestion(question: QuizContentRow['questions'][number]): StudentQuestion {
  return {
    questionId: question.id,
    type: question.type,
    prompt: question.prompt,
    position: question.position,
    options: question.options.map(toStudentQuestionOption),
  };
}

function toStudentQuestionOption(
  option: QuizContentRow['questions'][number]['options'][number],
): StudentQuestionOption {
  return {
    optionId: option.id,
    label: option.label,
    text: option.text,
    position: option.position,
  };
}
