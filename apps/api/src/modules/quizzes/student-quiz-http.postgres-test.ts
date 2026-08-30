import { HttpStatus, INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import * as cookieParser from 'cookie-parser';
import * as request from 'supertest';
import type { App } from 'supertest/types';
import {
  AccountStatus,
  CourseStatus,
  DevicePlatform,
  EnrollmentStatus,
  LessonStatus,
  LessonType,
  PlatformRole,
  QuestionStatus,
  QuestionType,
  QuizStatus,
  SectionStatus,
  StudentDeviceStatus,
  TenantMembershipRole,
  TenantMembershipStatus,
  TenantStatus,
  TenantStudentStatus,
} from '../../../.generated/prisma/client';
import type { DatabaseRuntimeConfig } from '../../infrastructure/database/database.config';
import { DATABASE_RUNTIME_CONFIG } from '../../infrastructure/database/database.constants';
import { PrismaService } from '../../infrastructure/database/prisma.service';
import { ApiExceptionFilter } from '../../infrastructure/http/api-exception.filter';
import { AuthModule } from '../auth/auth.module';
import { AUTH_RUNTIME_CONFIG } from '../auth/auth.constants';
import { AUTH_HTTP_CONFIG } from '../auth/http/auth-http.constants';
import { AccessTokenService } from '../auth/services/access-token.service';
import { ClockService } from '../auth/services/clock.service';
import { RefreshSessionService } from '../auth/services/refresh-session.service';
import { TokenCryptoService } from '../auth/services/token-crypto.service';
import { UuidV7Service } from '../auth/services/uuid-v7.service';
import { testAuthConfig } from '../auth/test-helpers';
import { CoursesModule } from '../courses/courses.module';
import { INSTALLATION_ID_HEADER } from '../devices/types/device.types';
import { TenancyModule } from '../tenancy/tenancy.module';
import { QuizzesModule } from './quizzes.module';

const testDatabaseUrl = process.env.TEST_DATABASE_URL;
const maybeDescribe = testDatabaseUrl ? describe : describe.skip;
const trustedOrigin = 'http://localhost:3000';

// Fixed "now" so every startsAt/endsAt/availableFrom/availableUntil boundary assertion is
// deterministic, mirroring `student-course-http.postgres-test.ts`.
const NOW = new Date('2026-06-15T12:00:00.000Z');
const ONE_DAY_MS = 24 * 60 * 60 * 1000;

maybeDescribe('student quiz delivery HTTP PostgreSQL integration', () => {
  let app: INestApplication;
  let server: App;
  let prisma: PrismaService;
  let accessTokens: AccessTokenService;
  let refreshSessions: RefreshSessionService;
  let tokenCrypto: TokenCryptoService;
  let uuid: UuidV7Service;

  beforeEach(async () => {
    const databaseConfig: DatabaseRuntimeConfig = {
      databaseUrl: testDatabaseUrl as string,
      pool: {
        maxConnections: 6,
        connectionTimeoutMillis: 5_000,
        idleTimeoutMillis: 10_000,
      },
    };

    const moduleRef = await Test.createTestingModule({
      imports: [AuthModule, TenancyModule, CoursesModule, QuizzesModule],
    })
      .overrideProvider(DATABASE_RUNTIME_CONFIG)
      .useValue(databaseConfig)
      .overrideProvider(AUTH_RUNTIME_CONFIG)
      .useValue(testAuthConfig)
      .overrideProvider(AUTH_HTTP_CONFIG)
      .useValue({
        trustedWebOrigins: [trustedOrigin],
        cookies: {
          refreshTokenName: 'edvora_refresh',
          sessionIdName: 'edvora_session',
          path: '/auth',
          httpOnly: true,
          secure: false,
          sameSite: 'lax',
        },
      })
      .overrideProvider(ClockService)
      .useValue({ now: () => NOW })
      .compile();

    app = moduleRef.createNestApplication();
    app.use(cookieParser());
    app.useGlobalPipes(
      new ValidationPipe({
        transform: true,
        whitelist: true,
        forbidNonWhitelisted: true,
        forbidUnknownValues: true,
      }),
    );
    app.useGlobalFilters(new ApiExceptionFilter());
    await app.init();
    server = app.getHttpServer() as App;

    prisma = moduleRef.get(PrismaService);
    accessTokens = moduleRef.get(AccessTokenService);
    refreshSessions = moduleRef.get(RefreshSessionService);
    tokenCrypto = moduleRef.get(TokenCryptoService);
    uuid = moduleRef.get(UuidV7Service);

    await clearData();
  });

  afterEach(async () => {
    await clearData();
    await app?.close();
  });

  async function setUpAccessibleQuizLesson(
    slugSuffix: string,
    options: { quizStatus?: QuizStatus } = {},
  ): Promise<{
    tenantId: string;
    instructorId: string;
    studentId: string;
    installationId: string;
    token: string;
    courseId: string;
    sectionId: string;
    lessonId: string;
    quizId: string;
  }> {
    const { tenantId, instructorId } = await createInstructorTenant(slugSuffix);
    const studentId = await createStudent(`${slugSuffix}-student`);
    const installationId = installation();
    await createTenantStudent(tenantId, studentId, TenantStudentStatus.ACTIVE);
    const courseId = await createCourseDirect(tenantId, instructorId, `${slugSuffix} course`, CourseStatus.PUBLISHED);
    await createEnrollmentDirect(tenantId, studentId, courseId, instructorId, EnrollmentStatus.ACTIVE);
    const sectionId = await createSectionDirect(tenantId, courseId, 'Section', 1, SectionStatus.PUBLISHED);
    const quizId = await createQuizDirect(tenantId, `${slugSuffix} quiz`, options.quizStatus ?? QuizStatus.PUBLISHED);
    const lessonId = await createLessonDirect(tenantId, courseId, sectionId, {
      title: 'Quiz lesson',
      position: 1,
      status: LessonStatus.PUBLISHED,
      quizId,
    });
    await createActiveDevice(studentId, installationId);
    const token = await issueAccessToken(studentId, PlatformRole.STUDENT);

    return { tenantId, instructorId, studentId, installationId, token, courseId, sectionId, lessonId, quizId };
  }

  it('lets an entitled student retrieve an accessible Quiz Lesson, ordered deterministically, with no isCorrect/answer-key leakage', async () => {
    const setup = await setUpAccessibleQuizLesson('happy-path');

    const q1 = await createQuestionDirect(setup.tenantId, setup.quizId, QuestionType.MULTIPLE_CHOICE, 1, QuestionStatus.ACTIVE);
    const q2 = await createQuestionDirect(setup.tenantId, setup.quizId, QuestionType.TRUE_FALSE, 2, QuestionStatus.ACTIVE);
    const archivedQuestion = await createQuestionDirect(
      setup.tenantId,
      setup.quizId,
      QuestionType.MULTIPLE_CHOICE,
      3,
      QuestionStatus.ARCHIVED,
    );

    const q1OptB = await createQuestionOptionDirect(setup.tenantId, q1, 'B', 2, false);
    const q1OptA = await createQuestionOptionDirect(setup.tenantId, q1, 'A', 1, true);
    const q2OptTrue = await createQuestionOptionDirect(setup.tenantId, q2, 'True', 1, true);
    const q2OptFalse = await createQuestionOptionDirect(setup.tenantId, q2, 'False', 2, false);

    const response = await request(server)
      .get(`/student/courses/${setup.courseId}/lessons/${setup.lessonId}/quiz`)
      .set('Authorization', `Bearer ${setup.token}`)
      .set(INSTALLATION_ID_HEADER, setup.installationId)
      .expect(HttpStatus.OK);

    const body = responseBody<{
      quizId: string;
      title: string;
      description: string | null;
      questions: Array<{ questionId: string; options: Array<{ optionId: string }> }>;
    }>(response);

    expect(body.quizId).toBe(setup.quizId);
    expect(body.title).toBe('happy-path quiz');
    expect(Object.keys(body).sort()).toEqual(['description', 'quizId', 'questions', 'title'].sort());

    // Questions ordered deterministically by position; the ARCHIVED question is omitted entirely.
    expect(body.questions.map((question) => question.questionId)).toEqual([q1, q2]);
    expect(JSON.stringify(body)).not.toContain(archivedQuestion);

    // Options ordered deterministically by position.
    expect(body.questions[0].options.map((option) => option.optionId)).toEqual([q1OptA, q1OptB]);
    expect(body.questions[1].options.map((option) => option.optionId)).toEqual([q2OptTrue, q2OptFalse]);

    // Field-level allowlist on the raw JSON shape, not just presence checks.
    expect(Object.keys(body.questions[0]).sort()).toEqual(['options', 'position', 'prompt', 'questionId', 'type'].sort());
    expect(Object.keys(body.questions[0].options[0]).sort()).toEqual(['label', 'optionId', 'position', 'text'].sort());

    // The primary security objective: no correct-answer data anywhere in the raw JSON.
    const raw = JSON.stringify(body);
    expect(raw).not.toMatch(/isCorrect/i);
    expect(raw).not.toMatch(/correct/i);
    expect(raw).not.toMatch(/answerKey|answer_key/i);
    expect(raw).not.toMatch(/points|passingScore|attemptLimit|revealAnswers/i);

    // Pure content-delivery read: no attempt/progress side effects.
    await expect(prisma.client.quizAttempt.count()).resolves.toBe(0);
    await expect(prisma.client.lessonProgress.count()).resolves.toBe(0);
  });

  it('filters ARCHIVED Questions (and every one of their Options) out at the query boundary, keeping only the ACTIVE Question and its own options', async () => {
    const setup = await setUpAccessibleQuizLesson('archived-question-filter');

    const activeQuestion = await createQuestionDirect(
      setup.tenantId,
      setup.quizId,
      QuestionType.MULTIPLE_CHOICE,
      1,
      QuestionStatus.ACTIVE,
    );
    const archivedQuestion = await createQuestionDirect(
      setup.tenantId,
      setup.quizId,
      QuestionType.MULTIPLE_CHOICE,
      2,
      QuestionStatus.ARCHIVED,
    );

    const activeOptB = await createQuestionOptionDirect(setup.tenantId, activeQuestion, 'Active option B', 2, false);
    const activeOptA = await createQuestionOptionDirect(setup.tenantId, activeQuestion, 'Active option A', 1, true);
    // The ARCHIVED question also has its own options, so this proves option-level filtering
    // follows from the parent Question's exclusion, not merely "no options happened to exist".
    const archivedOptA = await createQuestionOptionDirect(setup.tenantId, archivedQuestion, 'Archived option A', 1, true);
    const archivedOptB = await createQuestionOptionDirect(setup.tenantId, archivedQuestion, 'Archived option B', 2, false);

    const response = await request(server)
      .get(`/student/courses/${setup.courseId}/lessons/${setup.lessonId}/quiz`)
      .set('Authorization', `Bearer ${setup.token}`)
      .set(INSTALLATION_ID_HEADER, setup.installationId)
      .expect(HttpStatus.OK);

    const body = responseBody<{
      questions: Array<{ questionId: string; prompt: string; options: Array<{ optionId: string; text: string }> }>;
    }>(response);

    // Only the ACTIVE Question is present, with its own options present in deterministic order.
    expect(body.questions).toHaveLength(1);
    expect(body.questions[0].questionId).toBe(activeQuestion);
    expect(body.questions[0].options.map((option) => option.optionId)).toEqual([activeOptA, activeOptB]);
    expect(body.questions[0].options.map((option) => option.text)).toEqual(['Active option A', 'Active option B']);

    // The ARCHIVED Question's ID and text, and every one of its options' IDs and text, are
    // completely absent from the raw response — not merely hidden by loose serialization.
    const raw = JSON.stringify(body);
    expect(raw).not.toContain(archivedQuestion);
    expect(raw).not.toContain('Prompt 2');
    expect(raw).not.toContain(archivedOptA);
    expect(raw).not.toContain(archivedOptB);
    expect(raw).not.toContain('Archived option A');
    expect(raw).not.toContain('Archived option B');

    // No correct-answer/answer-key data anywhere, for either question.
    expect(raw).not.toMatch(/isCorrect/i);
    expect(raw).not.toMatch(/correct/i);
    expect(raw).not.toMatch(/answerKey|answer_key/i);

    // Confirmed directly against the database, not just inferred from the response body: this
    // read created no QuizAttempt and no LessonProgress row.
    await expect(prisma.client.quizAttempt.count()).resolves.toBe(0);
    await expect(prisma.client.lessonProgress.count()).resolves.toBe(0);
  });

  it('shows correct-answer data on the instructor authoring response for the exact same option while the student response omits it', async () => {
    const setup = await setUpAccessibleQuizLesson('cross-check');
    const instructorToken = await issueAccessToken(setup.instructorId, PlatformRole.INSTRUCTOR);
    const questionId = await createQuestionDirect(setup.tenantId, setup.quizId, QuestionType.TRUE_FALSE, 1, QuestionStatus.ACTIVE);
    const correctOptionId = await createQuestionOptionDirect(setup.tenantId, questionId, 'True', 1, true);

    const instructorResponse = await request(server)
      .get(`/instructor/tenants/${setup.tenantId}/quizzes/${setup.quizId}/questions/${questionId}/options`)
      .set('Authorization', `Bearer ${instructorToken}`)
      .expect(HttpStatus.OK);
    const instructorOptions = responseBody<{ items: Array<{ optionId: string; isCorrect: boolean }> }>(
      instructorResponse,
    ).items;
    const instructorOption = instructorOptions.find((option) => option.optionId === correctOptionId);
    expect(instructorOption?.isCorrect).toBe(true);
    expect(JSON.stringify(instructorResponse.body)).toMatch(/isCorrect/);

    const studentResponse = await request(server)
      .get(`/student/courses/${setup.courseId}/lessons/${setup.lessonId}/quiz`)
      .set('Authorization', `Bearer ${setup.token}`)
      .set(INSTALLATION_ID_HEADER, setup.installationId)
      .expect(HttpStatus.OK);
    expect(JSON.stringify(studentResponse.body)).not.toMatch(/isCorrect/);
  });

  it('denies access before an approved device exists', async () => {
    const setup = await setUpAccessibleQuizLesson('no-device');

    await request(server)
      .get(`/student/courses/${setup.courseId}/lessons/${setup.lessonId}/quiz`)
      .set('Authorization', `Bearer ${setup.token}`)
      .set(INSTALLATION_ID_HEADER, installation())
      .expect(HttpStatus.FORBIDDEN);
  });

  it('denies access when TenantStudent is not ACTIVE', async () => {
    for (const status of [TenantStudentStatus.INACTIVE, TenantStudentStatus.REMOVED]) {
      const slug = `ts-${status.toLowerCase()}`;
      const { tenantId, instructorId } = await createInstructorTenant(slug);
      const studentId = await createStudent(`${slug}-student`);
      const installationId = installation();
      await createTenantStudent(tenantId, studentId, status);
      const courseId = await createCourseDirect(tenantId, instructorId, `${slug} course`, CourseStatus.PUBLISHED);
      await createEnrollmentDirect(tenantId, studentId, courseId, instructorId, EnrollmentStatus.ACTIVE);
      const sectionId = await createSectionDirect(tenantId, courseId, 'Section', 1, SectionStatus.PUBLISHED);
      const quizId = await createQuizDirect(tenantId, 'Quiz', QuizStatus.PUBLISHED);
      const lessonId = await createLessonDirect(tenantId, courseId, sectionId, {
        title: 'Quiz lesson',
        position: 1,
        status: LessonStatus.PUBLISHED,
        quizId,
      });
      await createActiveDevice(studentId, installationId);
      const token = await issueAccessToken(studentId, PlatformRole.STUDENT);

      const response = await request(server)
        .get(`/student/courses/${courseId}/lessons/${lessonId}/quiz`)
        .set('Authorization', `Bearer ${token}`)
        .set(INSTALLATION_ID_HEADER, installationId)
        .expect(HttpStatus.NOT_FOUND);
      expect(response.body).toMatchObject({ error: { code: 'COURSE_NOT_FOUND' } });
    }
  });

  it('denies access when Enrollment is missing or not ACTIVE', async () => {
    const slug = 'no-enrollment';
    const { tenantId, instructorId } = await createInstructorTenant(slug);
    const studentId = await createStudent(`${slug}-student`);
    const installationId = installation();
    await createTenantStudent(tenantId, studentId, TenantStudentStatus.ACTIVE);
    const courseId = await createCourseDirect(tenantId, instructorId, `${slug} course`, CourseStatus.PUBLISHED);
    const sectionId = await createSectionDirect(tenantId, courseId, 'Section', 1, SectionStatus.PUBLISHED);
    const quizId = await createQuizDirect(tenantId, 'Quiz', QuizStatus.PUBLISHED);
    const lessonId = await createLessonDirect(tenantId, courseId, sectionId, {
      title: 'Quiz lesson',
      position: 1,
      status: LessonStatus.PUBLISHED,
      quizId,
    });
    await createActiveDevice(studentId, installationId);
    const token = await issueAccessToken(studentId, PlatformRole.STUDENT);

    // No Enrollment at all.
    await request(server)
      .get(`/student/courses/${courseId}/lessons/${lessonId}/quiz`)
      .set('Authorization', `Bearer ${token}`)
      .set(INSTALLATION_ID_HEADER, installationId)
      .expect(HttpStatus.NOT_FOUND);

    for (const status of [EnrollmentStatus.INACTIVE, EnrollmentStatus.REVOKED, EnrollmentStatus.EXPIRED]) {
      await prisma.client.enrollment.deleteMany({ where: { courseId } });
      await createEnrollmentDirect(tenantId, studentId, courseId, instructorId, status);

      await request(server)
        .get(`/student/courses/${courseId}/lessons/${lessonId}/quiz`)
        .set('Authorization', `Bearer ${token}`)
        .set(INSTALLATION_ID_HEADER, installationId)
        .expect(HttpStatus.NOT_FOUND);
    }
  });

  it('enforces the Enrollment time window at exact boundaries', async () => {
    const slug = 'time-window';
    const { tenantId, instructorId } = await createInstructorTenant(slug);
    const studentId = await createStudent(`${slug}-student`);
    const installationId = installation();
    await createTenantStudent(tenantId, studentId, TenantStudentStatus.ACTIVE);
    await createActiveDevice(studentId, installationId);
    const token = await issueAccessToken(studentId, PlatformRole.STUDENT);
    const quizId = await createQuizDirect(tenantId, 'Quiz', QuizStatus.PUBLISHED);

    async function courseWithLesson(courseSlug: string, window: { startsAt?: Date; endsAt?: Date }): Promise<{
      courseId: string;
      lessonId: string;
    }> {
      const courseId = await createCourseDirect(tenantId, instructorId, courseSlug, CourseStatus.PUBLISHED);
      await createEnrollmentDirect(tenantId, studentId, courseId, instructorId, EnrollmentStatus.ACTIVE, window);
      const sectionId = await createSectionDirect(tenantId, courseId, 'Section', 1, SectionStatus.PUBLISHED);
      const lessonId = await createLessonDirect(tenantId, courseId, sectionId, {
        title: 'Quiz lesson',
        position: 1,
        status: LessonStatus.PUBLISHED,
        quizId,
      });
      return { courseId, lessonId };
    }

    const futureStarts = await courseWithLesson('future-starts', { startsAt: new Date(NOW.getTime() + ONE_DAY_MS) });
    const pastEnds = await courseWithLesson('past-ends', { endsAt: new Date(NOW.getTime() - ONE_DAY_MS) });
    const endsExactlyNow = await courseWithLesson('ends-now', { endsAt: NOW });
    const startsExactlyNow = await courseWithLesson('starts-now', { startsAt: NOW });

    for (const { courseId, lessonId } of [futureStarts, pastEnds, endsExactlyNow]) {
      await request(server)
        .get(`/student/courses/${courseId}/lessons/${lessonId}/quiz`)
        .set('Authorization', `Bearer ${token}`)
        .set(INSTALLATION_ID_HEADER, installationId)
        .expect(HttpStatus.NOT_FOUND);
    }

    await request(server)
      .get(`/student/courses/${startsExactlyNow.courseId}/lessons/${startsExactlyNow.lessonId}/quiz`)
      .set('Authorization', `Bearer ${token}`)
      .set(INSTALLATION_ID_HEADER, installationId)
      .expect(HttpStatus.OK);
  });

  it('denies access to a Quiz Lesson in a DRAFT or ARCHIVED Course', async () => {
    const slug = 'course-lifecycle';
    const { tenantId, instructorId } = await createInstructorTenant(slug);
    const studentId = await createStudent(`${slug}-student`);
    const installationId = installation();
    await createTenantStudent(tenantId, studentId, TenantStudentStatus.ACTIVE);
    await createActiveDevice(studentId, installationId);
    const token = await issueAccessToken(studentId, PlatformRole.STUDENT);
    const quizId = await createQuizDirect(tenantId, 'Quiz', QuizStatus.PUBLISHED);

    for (const status of [CourseStatus.DRAFT, CourseStatus.ARCHIVED]) {
      const courseId = await createCourseDirect(tenantId, instructorId, `${status} course`, status);
      await createEnrollmentDirect(tenantId, studentId, courseId, instructorId, EnrollmentStatus.ACTIVE);
      const sectionId = await createSectionDirect(tenantId, courseId, 'Section', 1, SectionStatus.PUBLISHED);
      const lessonId = await createLessonDirect(tenantId, courseId, sectionId, {
        title: 'Quiz lesson',
        position: 1,
        status: LessonStatus.PUBLISHED,
        quizId,
      });

      const response = await request(server)
        .get(`/student/courses/${courseId}/lessons/${lessonId}/quiz`)
        .set('Authorization', `Bearer ${token}`)
        .set(INSTALLATION_ID_HEADER, installationId)
        .expect(HttpStatus.NOT_FOUND);
      expect(response.body).toMatchObject({ error: { code: 'COURSE_NOT_FOUND' } });
    }
  });

  it('denies access to an unpublished/unavailable Section or Lesson', async () => {
    const setup = await setUpAccessibleQuizLesson('lesson-lifecycle');

    const draftSection = await createSectionDirect(setup.tenantId, setup.courseId, 'Draft section', 2, SectionStatus.DRAFT);
    const lessonUnderDraftSection = await createLessonDirect(setup.tenantId, setup.courseId, draftSection, {
      title: 'Under draft section',
      position: 1,
      status: LessonStatus.PUBLISHED,
      quizId: setup.quizId,
    });

    const draftLesson = await createLessonDirect(setup.tenantId, setup.courseId, setup.sectionId, {
      title: 'Draft lesson',
      position: 2,
      status: LessonStatus.DRAFT,
      quizId: setup.quizId,
    });
    const archivedLesson = await createLessonDirect(setup.tenantId, setup.courseId, setup.sectionId, {
      title: 'Archived lesson',
      position: 3,
      status: LessonStatus.ARCHIVED,
      quizId: setup.quizId,
    });
    const notYetAvailable = await createLessonDirect(setup.tenantId, setup.courseId, setup.sectionId, {
      title: 'Not yet available',
      position: 4,
      status: LessonStatus.PUBLISHED,
      quizId: setup.quizId,
      availableFrom: new Date(NOW.getTime() + ONE_DAY_MS),
    });
    const atUntilBoundary = await createLessonDirect(setup.tenantId, setup.courseId, setup.sectionId, {
      title: 'At availableUntil boundary',
      position: 5,
      status: LessonStatus.PUBLISHED,
      quizId: setup.quizId,
      availableUntil: NOW,
    });

    for (const lessonId of [lessonUnderDraftSection, draftLesson, archivedLesson, notYetAvailable, atUntilBoundary]) {
      const response = await request(server)
        .get(`/student/courses/${setup.courseId}/lessons/${lessonId}/quiz`)
        .set('Authorization', `Bearer ${setup.token}`)
        .set(INSTALLATION_ID_HEADER, setup.installationId)
        .expect(HttpStatus.NOT_FOUND);
      expect(response.body).toMatchObject({ error: { code: 'LESSON_NOT_FOUND' } });
    }
  });

  it('denies access to a non-QUIZ Lesson', async () => {
    const setup = await setUpAccessibleQuizLesson('non-quiz');
    const videoAssetId = await createVideoAssetDirect(setup.tenantId, setup.instructorId);
    const videoLessonId = await createLessonDirect(setup.tenantId, setup.courseId, setup.sectionId, {
      title: 'Video lesson',
      position: 2,
      status: LessonStatus.PUBLISHED,
      videoAssetId,
    });

    const response = await request(server)
      .get(`/student/courses/${setup.courseId}/lessons/${videoLessonId}/quiz`)
      .set('Authorization', `Bearer ${setup.token}`)
      .set(INSTALLATION_ID_HEADER, setup.installationId)
      .expect(HttpStatus.NOT_FOUND);
    expect(response.body).toMatchObject({ error: { code: 'LESSON_NOT_FOUND' } });
  });

  it('denies a foreign Lesson substituted against an authorized Course, including a cross-tenant Lesson', async () => {
    const setup = await setUpAccessibleQuizLesson('foreign-lesson');

    // Same-tenant foreign Course's Lesson.
    const foreignCourse = await createCourseDirect(setup.tenantId, setup.instructorId, 'Foreign course', CourseStatus.PUBLISHED);
    const foreignSection = await createSectionDirect(setup.tenantId, foreignCourse, 'Foreign section', 1, SectionStatus.PUBLISHED);
    const sameTenantForeignLesson = await createLessonDirect(setup.tenantId, foreignCourse, foreignSection, {
      title: 'Foreign course lesson',
      position: 1,
      status: LessonStatus.PUBLISHED,
      quizId: setup.quizId,
    });

    // Cross-tenant Lesson (different tenant entirely).
    const { tenantId: otherTenantId, instructorId: otherInstructorId } = await createInstructorTenant('foreign-lesson-other');
    const otherCourse = await createCourseDirect(otherTenantId, otherInstructorId, 'Other tenant course', CourseStatus.PUBLISHED);
    const otherSection = await createSectionDirect(otherTenantId, otherCourse, 'Other tenant section', 1, SectionStatus.PUBLISHED);
    const otherQuizId = await createQuizDirect(otherTenantId, 'Other tenant quiz', QuizStatus.PUBLISHED);
    const crossTenantLesson = await createLessonDirect(otherTenantId, otherCourse, otherSection, {
      title: 'Other tenant lesson',
      position: 1,
      status: LessonStatus.PUBLISHED,
      quizId: otherQuizId,
    });

    for (const foreignLessonId of [sameTenantForeignLesson, crossTenantLesson]) {
      const response = await request(server)
        .get(`/student/courses/${setup.courseId}/lessons/${foreignLessonId}/quiz`)
        .set('Authorization', `Bearer ${setup.token}`)
        .set(INSTALLATION_ID_HEADER, setup.installationId)
        .expect(HttpStatus.NOT_FOUND);
      expect(response.body).toMatchObject({ error: { code: 'LESSON_NOT_FOUND' } });
    }
  });

  it('denies access when the linked Quiz itself is DRAFT or ARCHIVED, even though the Lesson is PUBLISHED and available', async () => {
    for (const quizStatus of [QuizStatus.DRAFT, QuizStatus.ARCHIVED]) {
      const setup = await setUpAccessibleQuizLesson(`quiz-lifecycle-${quizStatus.toLowerCase()}`, { quizStatus });

      const response = await request(server)
        .get(`/student/courses/${setup.courseId}/lessons/${setup.lessonId}/quiz`)
        .set('Authorization', `Bearer ${setup.token}`)
        .set(INSTALLATION_ID_HEADER, setup.installationId)
        .expect(HttpStatus.NOT_FOUND);
      expect(response.body).toMatchObject({ error: { code: 'LESSON_NOT_FOUND' } });
    }
  });

  async function clearData(): Promise<void> {
    await prisma.client.quizAttemptAnswer.deleteMany();
    await prisma.client.quizAttempt.deleteMany();
    await prisma.client.lessonProgress.deleteMany();
    await prisma.client.videoLesson.deleteMany();
    await prisma.client.documentLesson.deleteMany();
    await prisma.client.quizLesson.deleteMany();
    await prisma.client.lesson.deleteMany();
    await prisma.client.courseSection.deleteMany();
    await prisma.client.videoAsset.deleteMany();
    await prisma.client.questionOption.deleteMany();
    await prisma.client.question.deleteMany();
    await prisma.client.quiz.deleteMany();
    await prisma.client.securityEvent.deleteMany();
    await prisma.client.enrollment.deleteMany();
    await prisma.client.course.deleteMany();
    await prisma.client.deviceChangeRequest.deleteMany();
    await prisma.client.studentDevice.deleteMany();
    await prisma.client.refreshSession.deleteMany();
    await prisma.client.accountActivationToken.deleteMany();
    await prisma.client.passwordResetToken.deleteMany();
    await prisma.client.authCredential.deleteMany();
    await prisma.client.tenantStudent.deleteMany();
    await prisma.client.tenantMembership.deleteMany();
    await prisma.client.studentProfile.deleteMany();
    await prisma.client.instructorProfile.deleteMany();
    await prisma.client.tenant.deleteMany({
      where: { slug: { startsWith: 'student-quiz-test-' } },
    });
    await prisma.client.user.deleteMany({
      where: { normalizedEmail: { endsWith: '@example.test' } },
    });
  }

  async function createUser(emailPrefix: string, platformRole: PlatformRole): Promise<string> {
    const id = uuid.create();
    await prisma.client.user.create({
      data: {
        id,
        email: `${emailPrefix}@example.test`,
        normalizedEmail: `${emailPrefix}@example.test`,
        accountStatus: AccountStatus.ACTIVE,
        platformRole,
      },
    });
    return id;
  }

  async function createStudent(emailPrefix: string): Promise<string> {
    const id = await createUser(emailPrefix, PlatformRole.STUDENT);
    await prisma.client.studentProfile.create({ data: { id: uuid.create(), userId: id } });
    return id;
  }

  async function createInstructorTenant(slugSuffix: string): Promise<{ instructorId: string; tenantId: string }> {
    const instructorId = await createUser(`instructor-${slugSuffix}`, PlatformRole.INSTRUCTOR);
    await prisma.client.instructorProfile.create({ data: { id: uuid.create(), userId: instructorId } });
    const tenant = await prisma.client.tenant.create({
      data: {
        id: uuid.create(),
        name: `Student Quiz Tenant ${slugSuffix}`,
        slug: `student-quiz-test-${slugSuffix}`,
        status: TenantStatus.ACTIVE,
      },
    });
    await prisma.client.tenantMembership.create({
      data: {
        id: uuid.create(),
        tenantId: tenant.id,
        userId: instructorId,
        role: TenantMembershipRole.OWNER,
        status: TenantMembershipStatus.ACTIVE,
      },
    });
    return { instructorId, tenantId: tenant.id };
  }

  async function createTenantStudent(tenantId: string, studentUserId: string, status: TenantStudentStatus): Promise<void> {
    await prisma.client.tenantStudent.create({
      data: { id: uuid.create(), tenantId, studentUserId, status },
    });
  }

  async function createActiveDevice(studentUserId: string, installationId: string): Promise<void> {
    await prisma.client.studentDevice.create({
      data: {
        id: uuid.create(),
        studentUserId,
        clientDeviceIdHash: tokenCrypto.hashOpaqueToken(installationId),
        platform: DevicePlatform.IOS,
        status: StudentDeviceStatus.ACTIVE,
        approvedAt: new Date(),
        activatedAt: new Date(),
      },
    });
  }

  async function createCourseDirect(tenantId: string, createdByUserId: string, title: string, status: CourseStatus): Promise<string> {
    const id = uuid.create();
    await prisma.client.course.create({ data: { id, tenantId, createdByUserId, title, status } });
    return id;
  }

  async function createSectionDirect(
    tenantId: string,
    courseId: string,
    title: string,
    position: number,
    status: SectionStatus,
  ): Promise<string> {
    const id = uuid.create();
    await prisma.client.courseSection.create({ data: { id, tenantId, courseId, title, position, status } });
    return id;
  }

  async function createLessonDirect(
    tenantId: string,
    courseId: string,
    sectionId: string,
    spec: {
      title: string;
      position: number;
      status: LessonStatus;
      quizId?: string;
      videoAssetId?: string;
      availableFrom?: Date;
      availableUntil?: Date;
    },
  ): Promise<string> {
    const id = uuid.create();
    const type = spec.quizId ? LessonType.QUIZ : LessonType.VIDEO;
    await prisma.client.lesson.create({
      data: {
        id,
        tenantId,
        courseId,
        sectionId,
        title: spec.title,
        position: spec.position,
        type,
        status: spec.status,
        availableFrom: spec.availableFrom ?? null,
        availableUntil: spec.availableUntil ?? null,
      },
    });

    if (type === LessonType.QUIZ) {
      await prisma.client.quizLesson.create({
        data: { lessonId: id, tenantId, quizId: spec.quizId as string },
      });
    } else {
      await prisma.client.videoLesson.create({
        data: { lessonId: id, tenantId, videoAssetId: spec.videoAssetId as string },
      });
    }

    return id;
  }

  async function createVideoAssetDirect(tenantId: string, uploadedByUserId: string): Promise<string> {
    const id = uuid.create();
    await prisma.client.videoAsset.create({
      data: { id, tenantId, uploadedByUserId, externalAssetRef: `test-provider/video/${id}` },
    });
    return id;
  }

  async function createQuizDirect(tenantId: string, title: string, status: QuizStatus): Promise<string> {
    const id = uuid.create();
    await prisma.client.quiz.create({ data: { id, tenantId, title, status } });
    return id;
  }

  async function createQuestionDirect(
    tenantId: string,
    quizId: string,
    type: QuestionType,
    position: number,
    status: QuestionStatus,
  ): Promise<string> {
    const id = uuid.create();
    await prisma.client.question.create({
      data: { id, tenantId, quizId, type, prompt: `Prompt ${position}`, position, points: 1, status },
    });
    return id;
  }

  async function createQuestionOptionDirect(
    tenantId: string,
    questionId: string,
    text: string,
    position: number,
    isCorrect: boolean,
  ): Promise<string> {
    const id = uuid.create();
    await prisma.client.questionOption.create({
      data: { id, tenantId, questionId, text, position, isCorrect },
    });
    return id;
  }

  async function createEnrollmentDirect(
    tenantId: string,
    studentUserId: string,
    courseId: string,
    grantedByUserId: string,
    status: EnrollmentStatus,
    window?: { startsAt?: Date; endsAt?: Date },
  ): Promise<string> {
    const id = uuid.create();
    await prisma.client.enrollment.create({
      data: {
        id,
        tenantId,
        studentUserId,
        courseId,
        grantedByUserId,
        status,
        startsAt: window?.startsAt ?? null,
        endsAt: window?.endsAt ?? null,
      },
    });
    return id;
  }

  async function issueAccessToken(userId: string, platformRole: PlatformRole): Promise<string> {
    const session = await refreshSessions.createSession({ userId, channel: 'MOBILE' });
    return accessTokens.sign({ userId, sessionId: session.sessionId, platformRole });
  }
});

let installationCounter = 0;

function installation(): string {
  installationCounter += 1;
  return `00000000-0000-7000-8000-${installationCounter.toString().padStart(12, '0')}`;
}

function responseBody<T>(response: request.Response): T {
  return response.body as T;
}
