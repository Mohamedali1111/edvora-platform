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
  LessonProgressStatus,
  LessonStatus,
  LessonType,
  PlatformRole,
  QuestionStatus,
  QuestionType,
  QuizAttemptStatus,
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

const NOW = new Date('2026-06-15T12:00:00.000Z');

maybeDescribe('student quiz attempt HTTP PostgreSQL integration', () => {
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
        maxConnections: 10,
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

  type Setup = {
    tenantId: string;
    instructorId: string;
    instructorToken: string;
    studentId: string;
    installationId: string;
    token: string;
    courseId: string;
    sectionId: string;
    lessonId: string;
    quizId: string;
    enrollmentId: string;
  };

  async function setUpAccessibleQuizLesson(
    slugSuffix: string,
    options: { passingScorePercent?: number; attemptLimit?: number } = {},
  ): Promise<Setup> {
    const { tenantId, instructorId } = await createInstructorTenant(slugSuffix);
    const studentId = await createStudent(`${slugSuffix}-student`);
    const installationId = installation();
    await createTenantStudent(tenantId, studentId, TenantStudentStatus.ACTIVE);
    const courseId = await createCourseDirect(tenantId, instructorId, `${slugSuffix} course`, CourseStatus.PUBLISHED);
    const enrollmentId = await createEnrollmentDirect(tenantId, studentId, courseId, instructorId, EnrollmentStatus.ACTIVE);
    const sectionId = await createSectionDirect(tenantId, courseId, 'Section', 1, SectionStatus.PUBLISHED);
    const quizId = await createQuizDirect(
      tenantId,
      `${slugSuffix} quiz`,
      QuizStatus.PUBLISHED,
      options.passingScorePercent,
      options.attemptLimit,
    );
    const lessonId = await createLessonDirect(tenantId, courseId, sectionId, {
      title: 'Quiz lesson',
      position: 1,
      status: LessonStatus.PUBLISHED,
      quizId,
    });
    await createActiveDevice(studentId, installationId);
    const token = await issueAccessToken(studentId, PlatformRole.STUDENT);
    const instructorToken = await issueAccessToken(instructorId, PlatformRole.INSTRUCTOR);

    return {
      tenantId,
      instructorId,
      instructorToken,
      studentId,
      installationId,
      token,
      courseId,
      sectionId,
      lessonId,
      quizId,
      enrollmentId,
    };
  }

  type TwoQuestionQuiz = {
    q1: string; // 5 points, option A correct
    q1OptA: string;
    q1OptB: string;
    q2: string; // 5 points, option A correct
    q2OptA: string;
    q2OptB: string;
  };

  async function setUpTwoQuestions(tenantId: string, quizId: string): Promise<TwoQuestionQuiz> {
    const q1 = await createQuestionDirect(tenantId, quizId, QuestionType.MULTIPLE_CHOICE, 1, QuestionStatus.ACTIVE, 5);
    const q1OptA = await createQuestionOptionDirect(tenantId, q1, 'Q1 A', 1, true);
    const q1OptB = await createQuestionOptionDirect(tenantId, q1, 'Q1 B', 2, false);
    const q2 = await createQuestionDirect(tenantId, quizId, QuestionType.TRUE_FALSE, 2, QuestionStatus.ACTIVE, 5);
    const q2OptA = await createQuestionOptionDirect(tenantId, q2, 'Q2 A', 1, true);
    const q2OptB = await createQuestionOptionDirect(tenantId, q2, 'Q2 B', 2, false);
    return { q1, q1OptA, q1OptB, q2, q2OptA, q2OptB };
  }

  function startPath(setup: Setup): string {
    return `/student/courses/${setup.courseId}/lessons/${setup.lessonId}/quiz/attempts`;
  }

  function attemptPath(setup: Setup, attemptId: string): string {
    return `${startPath(setup)}/${attemptId}`;
  }

  function answerPath(setup: Setup, attemptId: string, questionId: string): string {
    return `${attemptPath(setup, attemptId)}/answers/${questionId}`;
  }

  function submitPath(setup: Setup, attemptId: string): string {
    return `${attemptPath(setup, attemptId)}/submit`;
  }

  // Returns the chainable supertest `Test` (not a `Promise`) so call sites can chain `.expect(...)`
  // the same way every other request in this file does.
  function start(setup: Setup): request.Test {
    return request(server)
      .post(startPath(setup))
      .set('Authorization', `Bearer ${setup.token}`)
      .set(INSTALLATION_ID_HEADER, setup.installationId);
  }

  // ---------------------------------------------------------------------------------------------
  // Start / entitlement
  // ---------------------------------------------------------------------------------------------

  it('lets an entitled student start an attempt, snapshotting only ACTIVE Questions/Options and creating no LessonProgress', async () => {
    const setup = await setUpAccessibleQuizLesson('start-happy');
    const { q1, q1OptA, q1OptB, q2 } = await setUpTwoQuestions(setup.tenantId, setup.quizId);
    const archived = await createQuestionDirect(setup.tenantId, setup.quizId, QuestionType.MULTIPLE_CHOICE, 3, QuestionStatus.ARCHIVED, 5);

    const response = await start(setup).expect(HttpStatus.CREATED);
    const body = responseBody<{
      attemptId: string;
      quizId: string;
      status: string;
      attemptNumber: number;
      startedAt: string;
      submittedAt: string | null;
      questions: Array<{ questionId: string; options: Array<{ optionId: string }> }>;
      result: unknown;
    }>(response);

    expect(body.quizId).toBe(setup.quizId);
    expect(body.status).toBe('IN_PROGRESS');
    expect(body.attemptNumber).toBe(1);
    expect(body.submittedAt).toBeNull();
    expect(body.result).toBeNull();
    expect(body.questions.map((q) => q.questionId)).toEqual([q1, q2]);
    expect(JSON.stringify(body)).not.toContain(archived);

    const q1Response = body.questions.find((q) => q.questionId === q1) as { options: Array<{ optionId: string }> };
    expect(q1Response.options.map((o) => o.optionId)).toEqual([q1OptA, q1OptB]);

    // Raw JSON contains no correct-answer data before submission.
    const raw = JSON.stringify(body);
    expect(raw).not.toMatch(/isCorrect/i);
    expect(raw).not.toMatch(/correctOptionIds/i);
    expect(raw).not.toMatch(/correctAnswerSnapshot/i);

    // DB proof: one answer row per ACTIVE question only, correctly frozen.
    const rows = await prisma.client.quizAttemptAnswer.findMany({ where: { attemptId: body.attemptId } });
    expect(rows).toHaveLength(2);
    expect(rows.map((r) => r.questionId).sort()).toEqual([q1, q2].sort());
    for (const row of rows) {
      expect(row.selectedOptionIdsSnapshot).toBeNull();
      expect(row.pointsAwarded.toString()).toBe('0');
      expect(row.pointsPossible.toString()).toBe('5');
    }

    await expect(prisma.client.lessonProgress.count()).resolves.toBe(0);
  });

  it('rejects starting a Quiz with zero ACTIVE Questions', async () => {
    const setup = await setUpAccessibleQuizLesson('no-questions');
    await createQuestionDirect(setup.tenantId, setup.quizId, QuestionType.MULTIPLE_CHOICE, 1, QuestionStatus.ARCHIVED, 5);

    const response = await start(setup).expect(HttpStatus.CONFLICT);
    expect(response.body).toMatchObject({ error: { code: 'QUIZ_HAS_NO_ACTIVE_QUESTIONS' } });
    await expect(prisma.client.quizAttempt.count()).resolves.toBe(0);
  });

  it('denies starting an attempt before an approved device exists', async () => {
    const setup = await setUpAccessibleQuizLesson('start-no-device');
    await setUpTwoQuestions(setup.tenantId, setup.quizId);

    await request(server)
      .post(startPath(setup))
      .set('Authorization', `Bearer ${setup.token}`)
      .set(INSTALLATION_ID_HEADER, installation())
      .expect(HttpStatus.FORBIDDEN);
    await expect(prisma.client.quizAttempt.count()).resolves.toBe(0);
  });

  it('denies starting an attempt when TenantStudent is not ACTIVE', async () => {
    const { tenantId, instructorId } = await createInstructorTenant('start-inactive-ts');
    const studentId = await createStudent('start-inactive-ts-student');
    const installationId = installation();
    await createTenantStudent(tenantId, studentId, TenantStudentStatus.INACTIVE);
    const courseId = await createCourseDirect(tenantId, instructorId, 'Course', CourseStatus.PUBLISHED);
    await createEnrollmentDirect(tenantId, studentId, courseId, instructorId, EnrollmentStatus.ACTIVE);
    const sectionId = await createSectionDirect(tenantId, courseId, 'Section', 1, SectionStatus.PUBLISHED);
    const quizId = await createQuizDirect(tenantId, 'Quiz', QuizStatus.PUBLISHED);
    await setUpTwoQuestions(tenantId, quizId);
    const lessonId = await createLessonDirect(tenantId, courseId, sectionId, {
      title: 'Quiz lesson',
      position: 1,
      status: LessonStatus.PUBLISHED,
      quizId,
    });
    await createActiveDevice(studentId, installationId);
    const token = await issueAccessToken(studentId, PlatformRole.STUDENT);

    const response = await request(server)
      .post(`/student/courses/${courseId}/lessons/${lessonId}/quiz/attempts`)
      .set('Authorization', `Bearer ${token}`)
      .set(INSTALLATION_ID_HEADER, installationId)
      .expect(HttpStatus.NOT_FOUND);
    expect(response.body).toMatchObject({ error: { code: 'COURSE_NOT_FOUND' } });
  });

  it('denies starting an attempt when the Enrollment is expired or not yet started', async () => {
    const { tenantId, instructorId } = await createInstructorTenant('start-enrollment-window');
    const studentId = await createStudent('start-enrollment-window-student');
    const installationId = installation();
    await createTenantStudent(tenantId, studentId, TenantStudentStatus.ACTIVE);
    await createActiveDevice(studentId, installationId);
    const token = await issueAccessToken(studentId, PlatformRole.STUDENT);
    const quizId = await createQuizDirect(tenantId, 'Quiz', QuizStatus.PUBLISHED);
    await setUpTwoQuestions(tenantId, quizId);

    const expiredCourse = await createCourseDirect(tenantId, instructorId, 'Expired course', CourseStatus.PUBLISHED);
    await createEnrollmentDirect(tenantId, studentId, expiredCourse, instructorId, EnrollmentStatus.ACTIVE, {
      endsAt: new Date(NOW.getTime() - 86_400_000),
    });
    const expiredSection = await createSectionDirect(tenantId, expiredCourse, 'Section', 1, SectionStatus.PUBLISHED);
    const expiredLesson = await createLessonDirect(tenantId, expiredCourse, expiredSection, {
      title: 'Quiz lesson',
      position: 1,
      status: LessonStatus.PUBLISHED,
      quizId,
    });

    const futureCourse = await createCourseDirect(tenantId, instructorId, 'Future course', CourseStatus.PUBLISHED);
    await createEnrollmentDirect(tenantId, studentId, futureCourse, instructorId, EnrollmentStatus.ACTIVE, {
      startsAt: new Date(NOW.getTime() + 86_400_000),
    });
    const futureSection = await createSectionDirect(tenantId, futureCourse, 'Section', 1, SectionStatus.PUBLISHED);
    const futureLesson = await createLessonDirect(tenantId, futureCourse, futureSection, {
      title: 'Quiz lesson',
      position: 1,
      status: LessonStatus.PUBLISHED,
      quizId,
    });

    for (const [courseId, lessonId] of [
      [expiredCourse, expiredLesson],
      [futureCourse, futureLesson],
    ]) {
      await request(server)
        .post(`/student/courses/${courseId}/lessons/${lessonId}/quiz/attempts`)
        .set('Authorization', `Bearer ${token}`)
        .set(INSTALLATION_ID_HEADER, installationId)
        .expect(HttpStatus.NOT_FOUND);
    }
  });

  it('denies starting an attempt for an inaccessible or non-QUIZ Lesson', async () => {
    const setup = await setUpAccessibleQuizLesson('start-bad-lesson');
    await setUpTwoQuestions(setup.tenantId, setup.quizId);
    const videoAssetId = await createVideoAssetDirect(setup.tenantId, setup.instructorId);
    const videoLessonId = await createLessonDirect(setup.tenantId, setup.courseId, setup.sectionId, {
      title: 'Video lesson',
      position: 2,
      status: LessonStatus.PUBLISHED,
      videoAssetId,
    });
    const draftLessonId = await createLessonDirect(setup.tenantId, setup.courseId, setup.sectionId, {
      title: 'Draft quiz lesson',
      position: 3,
      status: LessonStatus.DRAFT,
      quizId: setup.quizId,
    });

    for (const lessonId of [videoLessonId, draftLessonId]) {
      const response = await request(server)
        .post(`/student/courses/${setup.courseId}/lessons/${lessonId}/quiz/attempts`)
        .set('Authorization', `Bearer ${setup.token}`)
        .set(INSTALLATION_ID_HEADER, setup.installationId)
        .expect(HttpStatus.NOT_FOUND);
      expect(response.body).toMatchObject({ error: { code: 'LESSON_NOT_FOUND' } });
    }
  });

  // ---------------------------------------------------------------------------------------------
  // Attempt limit
  // ---------------------------------------------------------------------------------------------

  it('allows unlimited attempts when attemptLimit is null', async () => {
    const setup = await setUpAccessibleQuizLesson('limit-null');
    await setUpTwoQuestions(setup.tenantId, setup.quizId);

    const first = await start(setup).expect(HttpStatus.CREATED);
    expect(responseBody<{ attemptNumber: number }>(first).attemptNumber).toBe(1);

    const second = await start(setup).expect(HttpStatus.CREATED);
    expect(responseBody<{ attemptNumber: number }>(second).attemptNumber).toBe(2);
  });

  it('allows the first attempt and rejects a second when attemptLimit is 1 (an IN_PROGRESS attempt counts)', async () => {
    const setup = await setUpAccessibleQuizLesson('limit-one', { attemptLimit: 1 });
    await setUpTwoQuestions(setup.tenantId, setup.quizId);

    await start(setup).expect(HttpStatus.CREATED);

    const response = await start(setup).expect(HttpStatus.CONFLICT);
    expect(response.body).toMatchObject({ error: { code: 'QUIZ_ATTEMPT_LIMIT_REACHED' } });

    await expect(
      prisma.client.quizAttempt.count({ where: { studentUserId: setup.studentId, enrollmentId: setup.enrollmentId, quizId: setup.quizId } }),
    ).resolves.toBe(1);
  });

  it('counts a GRADED attempt toward the limit', async () => {
    const setup = await setUpAccessibleQuizLesson('limit-graded', { attemptLimit: 1 });
    const { q1, q1OptA } = await setUpTwoQuestions(setup.tenantId, setup.quizId);
    const started = await start(setup).expect(HttpStatus.CREATED);
    const attemptId = responseBody<{ attemptId: string }>(started).attemptId;

    await request(server)
      .put(answerPath(setup, attemptId, q1))
      .set('Authorization', `Bearer ${setup.token}`)
      .set(INSTALLATION_ID_HEADER, setup.installationId)
      .send({ optionId: q1OptA })
      .expect(HttpStatus.OK);
    await request(server)
      .post(submitPath(setup, attemptId))
      .set('Authorization', `Bearer ${setup.token}`)
      .set(INSTALLATION_ID_HEADER, setup.installationId)
      .expect(HttpStatus.OK);

    const response = await start(setup).expect(HttpStatus.CONFLICT);
    expect(response.body).toMatchObject({ error: { code: 'QUIZ_ATTEMPT_LIMIT_REACHED' } });
  });

  it('counts an ABANDONED attempt toward the limit (schema/domain state, no abandonment API exists yet)', async () => {
    const setup = await setUpAccessibleQuizLesson('limit-abandoned', { attemptLimit: 1 });
    await setUpTwoQuestions(setup.tenantId, setup.quizId);

    // No API produces ABANDONED in this slice; the row is created directly to prove the counting
    // query itself includes every status, not just the ones this slice's own endpoints produce.
    await prisma.client.quizAttempt.create({
      data: {
        id: uuid.create(),
        tenantId: setup.tenantId,
        quizId: setup.quizId,
        lessonId: setup.lessonId,
        studentUserId: setup.studentId,
        enrollmentId: setup.enrollmentId,
        status: QuizAttemptStatus.ABANDONED,
        attemptNumber: 1,
        startedAt: NOW,
      },
    });

    const response = await start(setup).expect(HttpStatus.CONFLICT);
    expect(response.body).toMatchObject({ error: { code: 'QUIZ_ATTEMPT_LIMIT_REACHED' } });
  });

  it("does not let attempts under a different Enrollment consume this Enrollment's allowance", async () => {
    const setup = await setUpAccessibleQuizLesson('limit-other-enrollment', { attemptLimit: 1 });
    await setUpTwoQuestions(setup.tenantId, setup.quizId);
    await start(setup).expect(HttpStatus.CREATED);
    // This Enrollment's single slot is now used.
    await start(setup).expect(HttpStatus.CONFLICT);

    // A second Course in the SAME tenant, whose Lesson references the SAME Quiz, with a fresh
    // Enrollment for the same student.
    const otherCourseId = await createCourseDirect(setup.tenantId, setup.instructorId, 'limit-other-enrollment course 2', CourseStatus.PUBLISHED);
    await createEnrollmentDirect(setup.tenantId, setup.studentId, otherCourseId, setup.instructorId, EnrollmentStatus.ACTIVE);
    const otherSectionId = await createSectionDirect(setup.tenantId, otherCourseId, 'Section', 1, SectionStatus.PUBLISHED);
    const otherLessonId = await createLessonDirect(setup.tenantId, otherCourseId, otherSectionId, {
      title: 'Quiz lesson',
      position: 1,
      status: LessonStatus.PUBLISHED,
      quizId: setup.quizId,
    });

    // Same student, same Quiz, but reached through the OTHER Enrollment: a fresh allowance.
    await request(server)
      .post(`/student/courses/${otherCourseId}/lessons/${otherLessonId}/quiz/attempts`)
      .set('Authorization', `Bearer ${setup.token}`)
      .set(INSTALLATION_ID_HEADER, setup.installationId)
      .expect(HttpStatus.CREATED);
  });

  it("does not let attempts on another Quiz consume this Quiz's allowance", async () => {
    const setup = await setUpAccessibleQuizLesson('limit-other-quiz', { attemptLimit: 1 });
    await setUpTwoQuestions(setup.tenantId, setup.quizId);
    await start(setup).expect(HttpStatus.CREATED);
    await start(setup).expect(HttpStatus.CONFLICT);

    // A second Quiz Lesson in the SAME Course/Enrollment, backed by a different Quiz.
    const otherQuizId = await createQuizDirect(setup.tenantId, 'limit-other-quiz quiz 2', QuizStatus.PUBLISHED, undefined, 1);
    await setUpTwoQuestions(setup.tenantId, otherQuizId);
    const otherLessonId = await createLessonDirect(setup.tenantId, setup.courseId, setup.sectionId, {
      title: 'Second quiz lesson',
      position: 2,
      status: LessonStatus.PUBLISHED,
      quizId: otherQuizId,
    });

    await request(server)
      .post(`/student/courses/${setup.courseId}/lessons/${otherLessonId}/quiz/attempts`)
      .set('Authorization', `Bearer ${setup.token}`)
      .set(INSTALLATION_ID_HEADER, setup.installationId)
      .expect(HttpStatus.CREATED);
  });

  it('converges two concurrent starts with one slot remaining to exactly one new attempt, with a clean error (not 500) for the loser', async () => {
    const setup = await setUpAccessibleQuizLesson('limit-concurrent', { attemptLimit: 1 });
    await setUpTwoQuestions(setup.tenantId, setup.quizId);

    const responses = await Promise.all([start(setup), start(setup)]);
    const statuses = responses.map((r) => r.status).sort((a, b) => a - b);
    expect(statuses).toEqual([HttpStatus.CREATED, HttpStatus.CONFLICT]);

    const loser = responses.find((r) => r.status === (HttpStatus.CONFLICT as number));
    expect(loser?.body).toMatchObject({ error: { code: 'QUIZ_ATTEMPT_LIMIT_REACHED' } });

    // The final persisted count never exceeds the configured limit, regardless of the race.
    await expect(
      prisma.client.quizAttempt.count({ where: { studentUserId: setup.studentId, enrollmentId: setup.enrollmentId, quizId: setup.quizId } }),
    ).resolves.toBe(1);
  });

  // ---------------------------------------------------------------------------------------------
  // Ownership / IDOR across the whole attempt surface
  // ---------------------------------------------------------------------------------------------

  it('scopes an attempt to only the student who started it: another student cannot GET, answer, or submit it', async () => {
    const setup = await setUpAccessibleQuizLesson('ownership');
    const { q1, q1OptA } = await setUpTwoQuestions(setup.tenantId, setup.quizId);
    const started = await start(setup).expect(HttpStatus.CREATED);
    const attemptId = responseBody<{ attemptId: string }>(started).attemptId;

    // A second, otherwise-entitled student in the same tenant/course.
    const otherStudentId = await createStudent('ownership-other-student');
    await createTenantStudent(setup.tenantId, otherStudentId, TenantStudentStatus.ACTIVE);
    await createEnrollmentDirect(setup.tenantId, otherStudentId, setup.courseId, setup.instructorId, EnrollmentStatus.ACTIVE);
    const otherInstallationId = installation();
    await createActiveDevice(otherStudentId, otherInstallationId);
    const otherToken = await issueAccessToken(otherStudentId, PlatformRole.STUDENT);

    const getResponse = await request(server)
      .get(attemptPath(setup, attemptId))
      .set('Authorization', `Bearer ${otherToken}`)
      .set(INSTALLATION_ID_HEADER, otherInstallationId)
      .expect(HttpStatus.NOT_FOUND);
    expect(getResponse.body).toMatchObject({ error: { code: 'QUIZ_ATTEMPT_NOT_FOUND' } });

    const answerResponse = await request(server)
      .put(answerPath(setup, attemptId, q1))
      .set('Authorization', `Bearer ${otherToken}`)
      .set(INSTALLATION_ID_HEADER, otherInstallationId)
      .send({ optionId: q1OptA })
      .expect(HttpStatus.NOT_FOUND);
    expect(answerResponse.body).toMatchObject({ error: { code: 'QUIZ_ATTEMPT_NOT_FOUND' } });

    const submitResponse = await request(server)
      .post(submitPath(setup, attemptId))
      .set('Authorization', `Bearer ${otherToken}`)
      .set(INSTALLATION_ID_HEADER, otherInstallationId)
      .expect(HttpStatus.NOT_FOUND);
    expect(submitResponse.body).toMatchObject({ error: { code: 'QUIZ_ATTEMPT_NOT_FOUND' } });

    // The owning student can still do all three.
    await request(server)
      .get(attemptPath(setup, attemptId))
      .set('Authorization', `Bearer ${setup.token}`)
      .set(INSTALLATION_ID_HEADER, setup.installationId)
      .expect(HttpStatus.OK);

    await expect(prisma.client.quizAttempt.findUniqueOrThrow({ where: { id: attemptId } })).resolves.toMatchObject({
      status: 'IN_PROGRESS',
    });
  });

  it('does not leak existence between a foreign attempt and a random attempt ID', async () => {
    const setup = await setUpAccessibleQuizLesson('idor-random');
    await setUpTwoQuestions(setup.tenantId, setup.quizId);

    const randomResponse = await request(server)
      .get(attemptPath(setup, uuid.create()))
      .set('Authorization', `Bearer ${setup.token}`)
      .set(INSTALLATION_ID_HEADER, setup.installationId)
      .expect(HttpStatus.NOT_FOUND);

    expect(responseBody<object>(randomResponse)).toEqual({
      error: { code: 'QUIZ_ATTEMPT_NOT_FOUND', message: expect.any(String) as unknown as string },
    });
  });

  // ---------------------------------------------------------------------------------------------
  // Snapshot / historical integrity — the primary correctness objective of this slice
  // ---------------------------------------------------------------------------------------------

  it('keeps the attempt snapshot (question text, option text, and correctness/score) unchanged after the instructor edits the live Quiz', async () => {
    const setup = await setUpAccessibleQuizLesson('historical-integrity', { passingScorePercent: 50 });
    const { q1, q1OptA, q1OptB, q2, q2OptA } = await setUpTwoQuestions(setup.tenantId, setup.quizId);

    const started = await start(setup).expect(HttpStatus.CREATED);
    const attemptId = responseBody<{ attemptId: string }>(started).attemptId;
    const originalPrompt = responseBody<{ questions: Array<{ questionId: string; prompt: string }> }>(started).questions.find(
      (q) => q.questionId === q1,
    )?.prompt;

    // The instructor now edits the live Question text, the live Option text, and flips which
    // Option is correct — all AFTER the attempt (and its snapshot) already exists.
    await prisma.client.question.update({ where: { id: q1 }, data: { prompt: 'EDITED PROMPT AFTER ATTEMPT START' } });
    await prisma.client.questionOption.update({ where: { id: q1OptA }, data: { text: 'EDITED OPTION TEXT', isCorrect: false } });
    await prisma.client.questionOption.update({ where: { id: q1OptB }, data: { isCorrect: true } });

    // The already-started attempt still reflects the ORIGINAL snapshot, not the edits.
    const afterEdit = await request(server)
      .get(attemptPath(setup, attemptId))
      .set('Authorization', `Bearer ${setup.token}`)
      .set(INSTALLATION_ID_HEADER, setup.installationId)
      .expect(HttpStatus.OK);
    const afterEditBody = responseBody<{
      questions: Array<{ questionId: string; prompt: string; options: Array<{ optionId: string; text: string }> }>;
    }>(afterEdit);
    const q1AfterEdit = afterEditBody.questions.find((q) => q.questionId === q1) as {
      prompt: string;
      options: Array<{ optionId: string; text: string }>;
    };
    expect(q1AfterEdit.prompt).toBe(originalPrompt);
    expect(q1AfterEdit.options.find((o) => o.optionId === q1OptA)?.text).toBe('Q1 A');

    // Answer Q1 with the ORIGINALLY-correct option (now live-incorrect) and Q2 correctly, then
    // submit: scoring must follow the FROZEN correctness, not the live (now-flipped) one.
    await request(server)
      .put(answerPath(setup, attemptId, q1))
      .set('Authorization', `Bearer ${setup.token}`)
      .set(INSTALLATION_ID_HEADER, setup.installationId)
      .send({ optionId: q1OptA })
      .expect(HttpStatus.OK);
    await request(server)
      .put(answerPath(setup, attemptId, q2))
      .set('Authorization', `Bearer ${setup.token}`)
      .set(INSTALLATION_ID_HEADER, setup.installationId)
      .send({ optionId: q2OptA })
      .expect(HttpStatus.OK);

    const submitted = await request(server)
      .post(submitPath(setup, attemptId))
      .set('Authorization', `Bearer ${setup.token}`)
      .set(INSTALLATION_ID_HEADER, setup.installationId)
      .expect(HttpStatus.OK);
    const result = responseBody<{ result: { scorePoints: string; maxPoints: string; passed: boolean } }>(submitted).result;

    // Both answers matched their FROZEN correct option (Q1's original A, Q2's A) -> full credit,
    // even though Q1's live correct option is now B.
    expect(result.scorePoints).toBe('10');
    expect(result.maxPoints).toBe('10');
    expect(result.passed).toBe(true);
  });

  // ---------------------------------------------------------------------------------------------
  // Passing-threshold snapshot
  // ---------------------------------------------------------------------------------------------

  it('captures the live passing threshold into the attempt at start', async () => {
    const setup = await setUpAccessibleQuizLesson('threshold-capture', { passingScorePercent: 60 });
    await setUpTwoQuestions(setup.tenantId, setup.quizId);

    const started = await start(setup).expect(HttpStatus.CREATED);
    const attemptId = responseBody<{ attemptId: string }>(started).attemptId;

    const row = await prisma.client.quizAttempt.findUniqueOrThrow({ where: { id: attemptId } });
    expect(row.passingScorePercentSnapshot?.toString()).toBe('60');
  });

  it('grades an existing attempt against its frozen threshold after the instructor raises the live threshold, while a NEW attempt captures the raised threshold', async () => {
    const setup = await setUpAccessibleQuizLesson('threshold-raised', { passingScorePercent: 60 });
    // A 7-point and a 3-point Question (10 total) so a single-correct-answer produces exactly 70%
    // — strictly between the two thresholds (60 and 80) under test, unambiguously distinguishing
    // "graded against 60" (passes) from "graded against 80" (fails).
    const q1 = await createQuestionDirect(setup.tenantId, setup.quizId, QuestionType.MULTIPLE_CHOICE, 1, QuestionStatus.ACTIVE, 7);
    const q1OptA = await createQuestionOptionDirect(setup.tenantId, q1, 'A', 1, true);
    await createQuestionOptionDirect(setup.tenantId, q1, 'B', 2, false);
    const q2 = await createQuestionDirect(setup.tenantId, setup.quizId, QuestionType.MULTIPLE_CHOICE, 2, QuestionStatus.ACTIVE, 3);
    await createQuestionOptionDirect(setup.tenantId, q2, 'A', 1, true);
    await createQuestionOptionDirect(setup.tenantId, q2, 'B', 2, false);

    const startedA = await start(setup).expect(HttpStatus.CREATED);
    const attemptAId = responseBody<{ attemptId: string }>(startedA).attemptId;

    // Instructor raises the live threshold to 80 WHILE Attempt A is still IN_PROGRESS.
    await prisma.client.quiz.update({ where: { id: setup.quizId }, data: { passingScorePercent: 80 } });

    // Answer only the 7-point Question correctly -> 7/10 = 70%.
    await request(server)
      .put(answerPath(setup, attemptAId, q1))
      .set('Authorization', `Bearer ${setup.token}`)
      .set(INSTALLATION_ID_HEADER, setup.installationId)
      .send({ optionId: q1OptA })
      .expect(HttpStatus.OK);

    const submittedA = await request(server)
      .post(submitPath(setup, attemptAId))
      .set('Authorization', `Bearer ${setup.token}`)
      .set(INSTALLATION_ID_HEADER, setup.installationId)
      .expect(HttpStatus.OK);
    const resultA = responseBody<{ result: { scorePoints: string; maxPoints: string; percentage: string; passed: boolean } }>(
      submittedA,
    ).result;

    // 70% against the FROZEN 60 -> passes. Against the live 80 it would fail; it must not.
    expect(resultA).toMatchObject({ scorePoints: '7', maxPoints: '10', percentage: '70', passed: true });

    const attemptARow = await prisma.client.quizAttempt.findUniqueOrThrow({ where: { id: attemptAId } });
    expect(attemptARow.passingScorePercentSnapshot?.toString()).toBe('60');

    const liveQuiz = await prisma.client.quiz.findUniqueOrThrow({ where: { id: setup.quizId } });
    expect(liveQuiz.passingScorePercent?.toString()).toBe('80');

    // A brand-new Attempt B, started AFTER the change, captures the NEW threshold and is graded
    // against it: the identical 70% now fails.
    const startedB = await start(setup).expect(HttpStatus.CREATED);
    const attemptBId = responseBody<{ attemptId: string }>(startedB).attemptId;
    const attemptBRow = await prisma.client.quizAttempt.findUniqueOrThrow({ where: { id: attemptBId } });
    expect(attemptBRow.passingScorePercentSnapshot?.toString()).toBe('80');

    await request(server)
      .put(answerPath(setup, attemptBId, q1))
      .set('Authorization', `Bearer ${setup.token}`)
      .set(INSTALLATION_ID_HEADER, setup.installationId)
      .send({ optionId: q1OptA })
      .expect(HttpStatus.OK);
    const submittedB = await request(server)
      .post(submitPath(setup, attemptBId))
      .set('Authorization', `Bearer ${setup.token}`)
      .set(INSTALLATION_ID_HEADER, setup.installationId)
      .expect(HttpStatus.OK);
    const resultB = responseBody<{ result: { percentage: string; passed: boolean } }>(submittedB).result;
    expect(resultB).toMatchObject({ percentage: '70', passed: false });
  });

  it('grades an existing attempt against its frozen threshold after the instructor lowers the live threshold (cannot newly pass)', async () => {
    const setup = await setUpAccessibleQuizLesson('threshold-lowered', { passingScorePercent: 80 });
    const q1 = await createQuestionDirect(setup.tenantId, setup.quizId, QuestionType.MULTIPLE_CHOICE, 1, QuestionStatus.ACTIVE, 7);
    const q1OptA = await createQuestionOptionDirect(setup.tenantId, q1, 'A', 1, true);
    await createQuestionOptionDirect(setup.tenantId, q1, 'B', 2, false);
    const q2 = await createQuestionDirect(setup.tenantId, setup.quizId, QuestionType.MULTIPLE_CHOICE, 2, QuestionStatus.ACTIVE, 3);
    await createQuestionOptionDirect(setup.tenantId, q2, 'A', 1, true);
    await createQuestionOptionDirect(setup.tenantId, q2, 'B', 2, false);

    const started = await start(setup).expect(HttpStatus.CREATED);
    const attemptId = responseBody<{ attemptId: string }>(started).attemptId;

    // Instructor LOWERS the live threshold to 60 WHILE the attempt is still IN_PROGRESS — 70%
    // would pass against the new live value.
    await prisma.client.quiz.update({ where: { id: setup.quizId }, data: { passingScorePercent: 60 } });

    await request(server)
      .put(answerPath(setup, attemptId, q1))
      .set('Authorization', `Bearer ${setup.token}`)
      .set(INSTALLATION_ID_HEADER, setup.installationId)
      .send({ optionId: q1OptA })
      .expect(HttpStatus.OK);

    const submitted = await request(server)
      .post(submitPath(setup, attemptId))
      .set('Authorization', `Bearer ${setup.token}`)
      .set(INSTALLATION_ID_HEADER, setup.installationId)
      .expect(HttpStatus.OK);
    const result = responseBody<{ result: { percentage: string; passed: boolean } }>(submitted).result;

    // Still graded against the FROZEN 80 -> 70% fails, even though the live threshold dropped to
    // 60 (which would have passed it).
    expect(result).toMatchObject({ percentage: '70', passed: false });
  });

  it('ignores any client-supplied threshold/snapshot/pass-fail payload when starting an attempt', async () => {
    const setup = await setUpAccessibleQuizLesson('threshold-tamper', { passingScorePercent: 60 });
    await setUpTwoQuestions(setup.tenantId, setup.quizId);

    const started = await request(server)
      .post(startPath(setup))
      .set('Authorization', `Bearer ${setup.token}`)
      .set(INSTALLATION_ID_HEADER, setup.installationId)
      .send({ passingScorePercentSnapshot: 1, passingScorePercent: 1, passed: true, status: 'GRADED' })
      .expect(HttpStatus.CREATED);
    const attemptId = responseBody<{ attemptId: string }>(started).attemptId;

    const row = await prisma.client.quizAttempt.findUniqueOrThrow({ where: { id: attemptId } });
    expect(row.passingScorePercentSnapshot?.toString()).toBe('60');
    expect(row.status).toBe(QuizAttemptStatus.IN_PROGRESS);
  });

  // ---------------------------------------------------------------------------------------------
  // Answer writes
  // ---------------------------------------------------------------------------------------------

  it('saves a valid answer, is idempotent on retry, and supports changing the answer while open', async () => {
    const setup = await setUpAccessibleQuizLesson('answer-save');
    const { q1, q1OptA, q1OptB } = await setUpTwoQuestions(setup.tenantId, setup.quizId);
    const started = await start(setup).expect(HttpStatus.CREATED);
    const attemptId = responseBody<{ attemptId: string }>(started).attemptId;

    const first = await request(server)
      .put(answerPath(setup, attemptId, q1))
      .set('Authorization', `Bearer ${setup.token}`)
      .set(INSTALLATION_ID_HEADER, setup.installationId)
      .send({ optionId: q1OptA })
      .expect(HttpStatus.OK);
    expect(
      responseBody<{ questions: Array<{ questionId: string; selectedOptionId: string | null }> }>(first).questions.find(
        (q) => q.questionId === q1,
      )?.selectedOptionId,
    ).toBe(q1OptA);

    // Retry with the same answer: no duplicate row.
    await request(server)
      .put(answerPath(setup, attemptId, q1))
      .set('Authorization', `Bearer ${setup.token}`)
      .set(INSTALLATION_ID_HEADER, setup.installationId)
      .send({ optionId: q1OptA })
      .expect(HttpStatus.OK);

    // Change the answer while still open.
    const changed = await request(server)
      .put(answerPath(setup, attemptId, q1))
      .set('Authorization', `Bearer ${setup.token}`)
      .set(INSTALLATION_ID_HEADER, setup.installationId)
      .send({ optionId: q1OptB })
      .expect(HttpStatus.OK);
    expect(
      responseBody<{ questions: Array<{ questionId: string; selectedOptionId: string | null }> }>(changed).questions.find(
        (q) => q.questionId === q1,
      )?.selectedOptionId,
    ).toBe(q1OptB);

    const rows = await prisma.client.quizAttemptAnswer.findMany({ where: { attemptId, questionId: q1 } });
    expect(rows).toHaveLength(1);
    expect(rows[0].selectedOptionIdsSnapshot).toEqual([q1OptB]);
  });

  it('rejects a foreign Question and an Option belonging to another Question', async () => {
    const setup = await setUpAccessibleQuizLesson('answer-foreign');
    const { q1, q2, q2OptA } = await setUpTwoQuestions(setup.tenantId, setup.quizId);
    const archived = await createQuestionDirect(setup.tenantId, setup.quizId, QuestionType.MULTIPLE_CHOICE, 3, QuestionStatus.ARCHIVED, 5);
    const archivedOption = await createQuestionOptionDirect(setup.tenantId, archived, 'Archived option', 1, true);
    const started = await start(setup).expect(HttpStatus.CREATED);
    const attemptId = responseBody<{ attemptId: string }>(started).attemptId;

    // `archived` was never snapshotted into this attempt at all.
    const foreignQuestion = await request(server)
      .put(answerPath(setup, attemptId, archived))
      .set('Authorization', `Bearer ${setup.token}`)
      .set(INSTALLATION_ID_HEADER, setup.installationId)
      .send({ optionId: archivedOption })
      .expect(HttpStatus.NOT_FOUND);
    expect(foreignQuestion.body).toMatchObject({ error: { code: 'QUESTION_NOT_FOUND' } });

    // `q2OptA` is a real, snapshotted option — but for q2, not q1.
    const foreignOption = await request(server)
      .put(answerPath(setup, attemptId, q1))
      .set('Authorization', `Bearer ${setup.token}`)
      .set(INSTALLATION_ID_HEADER, setup.installationId)
      .send({ optionId: q2OptA })
      .expect(HttpStatus.NOT_FOUND);
    expect(foreignOption.body).toMatchObject({ error: { code: 'QUESTION_OPTION_NOT_FOUND' } });

    await expect(
      prisma.client.quizAttemptAnswer.findMany({ where: { attemptId }, select: { selectedOptionIdsSnapshot: true } }),
    ).resolves.toEqual([{ selectedOptionIdsSnapshot: null }, { selectedOptionIdsSnapshot: null }]);
    void q2;
  });

  it('rejects answer writes on a finalized attempt', async () => {
    const setup = await setUpAccessibleQuizLesson('answer-after-finalize');
    const { q1, q1OptA } = await setUpTwoQuestions(setup.tenantId, setup.quizId);
    const started = await start(setup).expect(HttpStatus.CREATED);
    const attemptId = responseBody<{ attemptId: string }>(started).attemptId;

    await request(server)
      .post(submitPath(setup, attemptId))
      .set('Authorization', `Bearer ${setup.token}`)
      .set(INSTALLATION_ID_HEADER, setup.installationId)
      .expect(HttpStatus.OK);

    const response = await request(server)
      .put(answerPath(setup, attemptId, q1))
      .set('Authorization', `Bearer ${setup.token}`)
      .set(INSTALLATION_ID_HEADER, setup.installationId)
      .send({ optionId: q1OptA })
      .expect(HttpStatus.CONFLICT);
    expect(response.body).toMatchObject({ error: { code: 'QUIZ_ATTEMPT_NOT_OPEN' } });

    await expect(
      prisma.client.quizAttemptAnswer.findFirst({ where: { attemptId, questionId: q1 }, select: { selectedOptionIdsSnapshot: true } }),
    ).resolves.toEqual({ selectedOptionIdsSnapshot: null });
  });

  // ---------------------------------------------------------------------------------------------
  // Submission, scoring, idempotency
  // ---------------------------------------------------------------------------------------------

  it('scores a fully correct attempt at 100%, above the passing threshold', async () => {
    const setup = await setUpAccessibleQuizLesson('score-full', { passingScorePercent: 60 });
    const { q1, q1OptA, q2, q2OptA } = await setUpTwoQuestions(setup.tenantId, setup.quizId);
    const started = await start(setup).expect(HttpStatus.CREATED);
    const attemptId = responseBody<{ attemptId: string }>(started).attemptId;

    for (const [questionId, optionId] of [
      [q1, q1OptA],
      [q2, q2OptA],
    ]) {
      await request(server)
        .put(answerPath(setup, attemptId, questionId))
        .set('Authorization', `Bearer ${setup.token}`)
        .set(INSTALLATION_ID_HEADER, setup.installationId)
        .send({ optionId })
        .expect(HttpStatus.OK);
    }

    const submitted = await request(server)
      .post(submitPath(setup, attemptId))
      .set('Authorization', `Bearer ${setup.token}`)
      .set(INSTALLATION_ID_HEADER, setup.installationId)
      .expect(HttpStatus.OK);
    const body = responseBody<{
      status: string;
      submittedAt: string;
      result: { scorePoints: string; maxPoints: string; percentage: string; passed: boolean; gradedAt: string };
    }>(submitted);

    expect(body.status).toBe('GRADED');
    expect(body.submittedAt).toBe(NOW.toISOString());
    expect(body.result).toMatchObject({
      scorePoints: '10',
      maxPoints: '10',
      percentage: '100',
      passed: true,
      gradedAt: NOW.toISOString(),
    });

    // A passing GRADED attempt against a configured threshold completes the Quiz Lesson (Slice D
    // rule) — see the dedicated "Quiz Lesson completion" test section below for full coverage.
    await expect(prisma.client.lessonProgress.count()).resolves.toBe(1);
  });

  it('scores a mixed correct/incorrect/unanswered attempt and fails it against the passing threshold', async () => {
    const setup = await setUpAccessibleQuizLesson('score-mixed', { passingScorePercent: 60 });
    const q1 = await createQuestionDirect(setup.tenantId, setup.quizId, QuestionType.MULTIPLE_CHOICE, 1, QuestionStatus.ACTIVE, 4);
    const q1OptA = await createQuestionOptionDirect(setup.tenantId, q1, 'A', 1, true);
    await createQuestionOptionDirect(setup.tenantId, q1, 'B', 2, false);
    const q2 = await createQuestionDirect(setup.tenantId, setup.quizId, QuestionType.MULTIPLE_CHOICE, 2, QuestionStatus.ACTIVE, 4);
    const q2OptA = await createQuestionOptionDirect(setup.tenantId, q2, 'A', 1, true);
    const q2OptB = await createQuestionOptionDirect(setup.tenantId, q2, 'B', 2, false);
    const q3 = await createQuestionDirect(setup.tenantId, setup.quizId, QuestionType.MULTIPLE_CHOICE, 3, QuestionStatus.ACTIVE, 4);
    await createQuestionOptionDirect(setup.tenantId, q3, 'A', 1, true);
    await createQuestionOptionDirect(setup.tenantId, q3, 'B', 2, false);

    const started = await start(setup).expect(HttpStatus.CREATED);
    const attemptId = responseBody<{ attemptId: string }>(started).attemptId;

    // Q1 correct, Q2 incorrect, Q3 left unanswered.
    await request(server)
      .put(answerPath(setup, attemptId, q1))
      .set('Authorization', `Bearer ${setup.token}`)
      .set(INSTALLATION_ID_HEADER, setup.installationId)
      .send({ optionId: q1OptA })
      .expect(HttpStatus.OK);
    await request(server)
      .put(answerPath(setup, attemptId, q2))
      .set('Authorization', `Bearer ${setup.token}`)
      .set(INSTALLATION_ID_HEADER, setup.installationId)
      .send({ optionId: q2OptB })
      .expect(HttpStatus.OK);
    void q2OptA;

    const submitted = await request(server)
      .post(submitPath(setup, attemptId))
      .set('Authorization', `Bearer ${setup.token}`)
      .set(INSTALLATION_ID_HEADER, setup.installationId)
      .expect(HttpStatus.OK);
    const result = responseBody<{ result: { scorePoints: string; maxPoints: string; percentage: string; passed: boolean } }>(
      submitted,
    ).result;

    expect(result).toMatchObject({ scorePoints: '4', maxPoints: '12', percentage: '33.33', passed: false });
  });

  it('cannot be manipulated by a client-supplied score/result payload on submit', async () => {
    const setup = await setUpAccessibleQuizLesson('score-tamper', { passingScorePercent: 60 });
    const { q1, q1OptA } = await setUpTwoQuestions(setup.tenantId, setup.quizId);
    const started = await start(setup).expect(HttpStatus.CREATED);
    const attemptId = responseBody<{ attemptId: string }>(started).attemptId;

    await request(server)
      .put(answerPath(setup, attemptId, q1))
      .set('Authorization', `Bearer ${setup.token}`)
      .set(INSTALLATION_ID_HEADER, setup.installationId)
      .send({ optionId: q1OptA })
      .expect(HttpStatus.OK);

    const submitted = await request(server)
      .post(submitPath(setup, attemptId))
      .set('Authorization', `Bearer ${setup.token}`)
      .set(INSTALLATION_ID_HEADER, setup.installationId)
      .send({ scorePoints: '9999.99', maxPoints: '1.00', percentage: '999900.00', passed: true, status: 'GRADED' })
      .expect(HttpStatus.OK);
    const result = responseBody<{ result: { scorePoints: string; maxPoints: string; passed: boolean } }>(submitted).result;

    // Only Q1 (5 pts) was answered correctly out of 10 total -> 5/10, never the injected values.
    expect(result.scorePoints).toBe('5');
    expect(result.maxPoints).toBe('10');
    expect(result.passed).toBe(false);

    const dbRow = await prisma.client.quizAttempt.findUniqueOrThrow({ where: { id: attemptId } });
    expect(dbRow.scorePoints?.toString()).toBe('5');
    expect(dbRow.maxPoints?.toString()).toBe('10');
  });

  it('is idempotent on repeated submit: identical result, no rescoring, no re-stamped timestamp', async () => {
    const setup = await setUpAccessibleQuizLesson('submit-idempotent', { passingScorePercent: 60 });
    const { q1, q1OptA } = await setUpTwoQuestions(setup.tenantId, setup.quizId);
    const started = await start(setup).expect(HttpStatus.CREATED);
    const attemptId = responseBody<{ attemptId: string }>(started).attemptId;

    await request(server)
      .put(answerPath(setup, attemptId, q1))
      .set('Authorization', `Bearer ${setup.token}`)
      .set(INSTALLATION_ID_HEADER, setup.installationId)
      .send({ optionId: q1OptA })
      .expect(HttpStatus.OK);

    const first = await request(server)
      .post(submitPath(setup, attemptId))
      .set('Authorization', `Bearer ${setup.token}`)
      .set(INSTALLATION_ID_HEADER, setup.installationId)
      .expect(HttpStatus.OK);

    const second = await request(server)
      .post(submitPath(setup, attemptId))
      .set('Authorization', `Bearer ${setup.token}`)
      .set(INSTALLATION_ID_HEADER, setup.installationId)
      .expect(HttpStatus.OK);

    expect(second.body).toEqual(first.body);

    const answerRows = await prisma.client.quizAttemptAnswer.findMany({ where: { attemptId } });
    expect(answerRows).toHaveLength(2);
  });

  it('converges concurrent submit requests to exactly one persisted final result', async () => {
    const setup = await setUpAccessibleQuizLesson('submit-concurrent', { passingScorePercent: 60 });
    const { q1, q1OptA, q2, q2OptA } = await setUpTwoQuestions(setup.tenantId, setup.quizId);
    const started = await start(setup).expect(HttpStatus.CREATED);
    const attemptId = responseBody<{ attemptId: string }>(started).attemptId;

    for (const [questionId, optionId] of [
      [q1, q1OptA],
      [q2, q2OptA],
    ]) {
      await request(server)
        .put(answerPath(setup, attemptId, questionId))
        .set('Authorization', `Bearer ${setup.token}`)
        .set(INSTALLATION_ID_HEADER, setup.installationId)
        .send({ optionId })
        .expect(HttpStatus.OK);
    }

    const responses = await Promise.all(
      [1, 2, 3].map(() =>
        request(server)
          .post(submitPath(setup, attemptId))
          .set('Authorization', `Bearer ${setup.token}`)
          .set(INSTALLATION_ID_HEADER, setup.installationId),
      ),
    );

    for (const response of responses) {
      expect(response.status).toBe(HttpStatus.OK);
      expect(response.body).toMatchObject({ result: { scorePoints: '10', maxPoints: '10', passed: true } });
    }
    const gradedAts = new Set(responses.map((r) => (r.body as { result: { gradedAt: string } }).result.gradedAt));
    expect(gradedAts.size).toBe(1);

    await expect(prisma.client.quizAttemptAnswer.count({ where: { attemptId } })).resolves.toBe(2);
  });

  it('never commits an answer after finalization under a concurrent answer-vs-submit race', async () => {
    const setup = await setUpAccessibleQuizLesson('answer-vs-submit-race', { passingScorePercent: 60 });
    const { q1, q1OptA } = await setUpTwoQuestions(setup.tenantId, setup.quizId);
    const started = await start(setup).expect(HttpStatus.CREATED);
    const attemptId = responseBody<{ attemptId: string }>(started).attemptId;

    const [putResponse, submitResponse] = await Promise.all([
      request(server)
        .put(answerPath(setup, attemptId, q1))
        .set('Authorization', `Bearer ${setup.token}`)
        .set(INSTALLATION_ID_HEADER, setup.installationId)
        .send({ optionId: q1OptA }),
      request(server)
        .post(submitPath(setup, attemptId))
        .set('Authorization', `Bearer ${setup.token}`)
        .set(INSTALLATION_ID_HEADER, setup.installationId),
    ]);

    expect(submitResponse.status).toBe(HttpStatus.OK);
    expect([HttpStatus.OK, HttpStatus.CONFLICT]).toContain(putResponse.status);

    const finalAttempt = await prisma.client.quizAttempt.findUniqueOrThrow({
      where: { id: attemptId },
      include: { answers: true },
    });
    expect(finalAttempt.status).toBe(QuizAttemptStatus.GRADED);
    const q1Row = finalAttempt.answers.find((a) => a.questionId === q1);

    if (putResponse.status === (HttpStatus.OK as number)) {
      // The answer write committed before submission scored — the grade must reflect it.
      expect(q1Row?.selectedOptionIdsSnapshot).toEqual([q1OptA]);
      expect(q1Row?.pointsAwarded.toString()).toBe('5');
      // Only Q1 was ever answered (Q2 stays unanswered), so the total score is Q1's 5 points.
      expect(finalAttempt.scorePoints?.toString()).toBe('5');
    } else {
      // Submission finalized first — the never-committed answer must not appear anywhere.
      expect(putResponse.body).toMatchObject({ error: { code: 'QUIZ_ATTEMPT_NOT_OPEN' } });
      expect(q1Row?.selectedOptionIdsSnapshot).toBeNull();
      expect(q1Row?.pointsAwarded.toString()).toBe('0');
      expect(finalAttempt.scorePoints?.toString()).toBe('0');
    }

    await expect(prisma.client.quizAttemptAnswer.count({ where: { attemptId } })).resolves.toBe(2);
  });

  // ---------------------------------------------------------------------------------------------
  // Reveal-policy safety and LessonProgress non-interference
  // ---------------------------------------------------------------------------------------------

  it('reveals only aggregate score/percentage/pass-fail after submission — never per-question correctness — and creates no LessonProgress', async () => {
    const setup = await setUpAccessibleQuizLesson('reveal-policy', { passingScorePercent: 60 });
    const { q1, q1OptA, q2, q2OptB } = await setUpTwoQuestions(setup.tenantId, setup.quizId);
    const started = await start(setup).expect(HttpStatus.CREATED);
    const attemptId = responseBody<{ attemptId: string }>(started).attemptId;

    await request(server)
      .put(answerPath(setup, attemptId, q1))
      .set('Authorization', `Bearer ${setup.token}`)
      .set(INSTALLATION_ID_HEADER, setup.installationId)
      .send({ optionId: q1OptA })
      .expect(HttpStatus.OK);
    await request(server)
      .put(answerPath(setup, attemptId, q2))
      .set('Authorization', `Bearer ${setup.token}`)
      .set(INSTALLATION_ID_HEADER, setup.installationId)
      .send({ optionId: q2OptB })
      .expect(HttpStatus.OK);

    const submitted = await request(server)
      .post(submitPath(setup, attemptId))
      .set('Authorization', `Bearer ${setup.token}`)
      .set(INSTALLATION_ID_HEADER, setup.installationId)
      .expect(HttpStatus.OK);

    const body = responseBody<{
      result: { scorePoints: string; maxPoints: string; percentage: string; passed: boolean; gradedAt: string };
      questions: Array<Record<string, unknown>>;
    }>(submitted);

    expect(Object.keys(body.result).sort()).toEqual(['gradedAt', 'maxPoints', 'passed', 'percentage', 'scorePoints'].sort());
    for (const question of body.questions) {
      expect(Object.keys(question).sort()).toEqual(['options', 'position', 'prompt', 'questionId', 'selectedOptionId', 'type'].sort());
    }

    const raw = JSON.stringify(body);
    expect(raw).not.toMatch(/isCorrect/i);
    expect(raw).not.toMatch(/correctOptionIds/i);
    expect(raw).not.toMatch(/correctAnswerSnapshot/i);
    expect(raw).not.toMatch(/pointsAwarded|pointsPossible/i);

    await expect(prisma.client.lessonProgress.count()).resolves.toBe(0);
  });

  // ---------------------------------------------------------------------------------------------
  // Quiz Lesson completion -> LessonProgress integration (V1 rule: a GRADED attempt completes the
  // Lesson when it has no passing-threshold snapshot, or when a configured-threshold attempt
  // passed; a failed threshold-based attempt never creates or downgrades progress).
  // ---------------------------------------------------------------------------------------------

  it('does not complete the Lesson for a failed threshold-configured attempt, but completes it with correct ownership for a passing one', async () => {
    const setup = await setUpAccessibleQuizLesson('completion-threshold', { passingScorePercent: 60 });
    const q1 = await createQuestionDirect(setup.tenantId, setup.quizId, QuestionType.MULTIPLE_CHOICE, 1, QuestionStatus.ACTIVE, 7);
    const q1OptA = await createQuestionOptionDirect(setup.tenantId, q1, 'A', 1, true);
    await createQuestionOptionDirect(setup.tenantId, q1, 'B', 2, false);
    const q2 = await createQuestionDirect(setup.tenantId, setup.quizId, QuestionType.MULTIPLE_CHOICE, 2, QuestionStatus.ACTIVE, 3);
    await createQuestionOptionDirect(setup.tenantId, q2, 'A', 1, true);
    await createQuestionOptionDirect(setup.tenantId, q2, 'B', 2, false);

    // Attempt 1: unanswered -> 0% -> fails against 60%.
    const failedStarted = await start(setup).expect(HttpStatus.CREATED);
    const failedAttemptId = responseBody<{ attemptId: string }>(failedStarted).attemptId;
    const failedSubmitted = await request(server)
      .post(submitPath(setup, failedAttemptId))
      .set('Authorization', `Bearer ${setup.token}`)
      .set(INSTALLATION_ID_HEADER, setup.installationId)
      .expect(HttpStatus.OK);
    expect(responseBody<{ result: { passed: boolean } }>(failedSubmitted).result.passed).toBe(false);
    await expect(prisma.client.lessonProgress.count()).resolves.toBe(0);

    // Attempt 2: answer the 7-point Question correctly -> 70% -> passes.
    const passedStarted = await start(setup).expect(HttpStatus.CREATED);
    const passedAttemptId = responseBody<{ attemptId: string }>(passedStarted).attemptId;
    await request(server)
      .put(answerPath(setup, passedAttemptId, q1))
      .set('Authorization', `Bearer ${setup.token}`)
      .set(INSTALLATION_ID_HEADER, setup.installationId)
      .send({ optionId: q1OptA })
      .expect(HttpStatus.OK);
    const passedSubmitted = await request(server)
      .post(submitPath(setup, passedAttemptId))
      .set('Authorization', `Bearer ${setup.token}`)
      .set(INSTALLATION_ID_HEADER, setup.installationId)
      .expect(HttpStatus.OK);
    expect(responseBody<{ result: { passed: boolean } }>(passedSubmitted).result.passed).toBe(true);

    const rows = await prisma.client.lessonProgress.findMany();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      studentUserId: setup.studentId,
      lessonId: setup.lessonId,
      enrollmentId: setup.enrollmentId,
      status: LessonProgressStatus.COMPLETED,
    });
    expect(rows[0].completedAt?.toISOString()).toBe(NOW.toISOString());
  });

  it('completes the Lesson for a GRADED attempt with no passing-threshold snapshot, even though passed is null', async () => {
    const setup = await setUpAccessibleQuizLesson('completion-no-threshold');
    await setUpTwoQuestions(setup.tenantId, setup.quizId);

    // Leave everything unanswered; there is no threshold, so grading alone qualifies.
    const started = await start(setup).expect(HttpStatus.CREATED);
    const attemptId = responseBody<{ attemptId: string }>(started).attemptId;
    const submitted = await request(server)
      .post(submitPath(setup, attemptId))
      .set('Authorization', `Bearer ${setup.token}`)
      .set(INSTALLATION_ID_HEADER, setup.installationId)
      .expect(HttpStatus.OK);
    expect(responseBody<{ result: { passed: boolean | null } }>(submitted).result.passed).toBeNull();

    const rows = await prisma.client.lessonProgress.findMany();
    expect(rows).toHaveLength(1);
    expect(rows[0].status).toBe(LessonProgressStatus.COMPLETED);
    expect(rows[0].completedAt?.toISOString()).toBe(NOW.toISOString());
  });

  it('transitions an existing NOT_STARTED or STARTED progress row to COMPLETED on a passing submission', async () => {
    for (const initialStatus of [LessonProgressStatus.NOT_STARTED, LessonProgressStatus.STARTED]) {
      const setup = await setUpAccessibleQuizLesson(`completion-existing-${initialStatus.toLowerCase()}`);
      await setUpTwoQuestions(setup.tenantId, setup.quizId);

      await prisma.client.lessonProgress.create({
        data: {
          id: uuid.create(),
          tenantId: setup.tenantId,
          courseId: setup.courseId,
          lessonId: setup.lessonId,
          studentUserId: setup.studentId,
          enrollmentId: setup.enrollmentId,
          status: initialStatus,
          startedAt: NOW,
        },
      });

      const started = await start(setup).expect(HttpStatus.CREATED);
      const attemptId = responseBody<{ attemptId: string }>(started).attemptId;
      await request(server)
        .post(submitPath(setup, attemptId))
        .set('Authorization', `Bearer ${setup.token}`)
        .set(INSTALLATION_ID_HEADER, setup.installationId)
        .expect(HttpStatus.OK);

      const rows = await prisma.client.lessonProgress.findMany({ where: { enrollmentId: setup.enrollmentId } });
      expect(rows).toHaveLength(1);
      expect(rows[0].status).toBe(LessonProgressStatus.COMPLETED);
      expect(rows[0].completedAt?.toISOString()).toBe(NOW.toISOString());
    }
  });

  it('never downgrades or restamps an already-COMPLETED Lesson across a fail-then-pass-then-fail-then-pass attempt sequence', async () => {
    const setup = await setUpAccessibleQuizLesson('completion-multi-attempt', { passingScorePercent: 60 });
    const q1 = await createQuestionDirect(setup.tenantId, setup.quizId, QuestionType.MULTIPLE_CHOICE, 1, QuestionStatus.ACTIVE, 7);
    const q1OptA = await createQuestionOptionDirect(setup.tenantId, q1, 'A', 1, true);
    await createQuestionOptionDirect(setup.tenantId, q1, 'B', 2, false);
    const q2 = await createQuestionDirect(setup.tenantId, setup.quizId, QuestionType.MULTIPLE_CHOICE, 2, QuestionStatus.ACTIVE, 3);
    await createQuestionOptionDirect(setup.tenantId, q2, 'A', 1, true);
    await createQuestionOptionDirect(setup.tenantId, q2, 'B', 2, false);

    async function attempt(shouldPass: boolean): Promise<boolean> {
      const started = await start(setup).expect(HttpStatus.CREATED);
      const attemptId = responseBody<{ attemptId: string }>(started).attemptId;
      if (shouldPass) {
        await request(server)
          .put(answerPath(setup, attemptId, q1))
          .set('Authorization', `Bearer ${setup.token}`)
          .set(INSTALLATION_ID_HEADER, setup.installationId)
          .send({ optionId: q1OptA })
          .expect(HttpStatus.OK);
      }
      const submitted = await request(server)
        .post(submitPath(setup, attemptId))
        .set('Authorization', `Bearer ${setup.token}`)
        .set(INSTALLATION_ID_HEADER, setup.installationId)
        .expect(HttpStatus.OK);
      return responseBody<{ result: { passed: boolean } }>(submitted).result.passed;
    }

    // Attempt 1: fails -> no completion.
    expect(await attempt(false)).toBe(false);
    await expect(prisma.client.lessonProgress.count()).resolves.toBe(0);

    // Attempt 2: passes -> completes exactly once.
    expect(await attempt(true)).toBe(true);
    const afterFirstPass = await prisma.client.lessonProgress.findFirstOrThrow();
    expect(afterFirstPass.status).toBe(LessonProgressStatus.COMPLETED);
    const completedAt = afterFirstPass.completedAt?.toISOString();
    expect(completedAt).toBe(NOW.toISOString());

    // Attempt 3: fails -> remains COMPLETED, unchanged.
    expect(await attempt(false)).toBe(false);
    const afterSecondFail = await prisma.client.lessonProgress.findFirstOrThrow();
    expect(afterSecondFail.status).toBe(LessonProgressStatus.COMPLETED);
    expect(afterSecondFail.completedAt?.toISOString()).toBe(completedAt);

    // Attempt 4: passes again -> still unchanged, no restamp.
    expect(await attempt(true)).toBe(true);
    const afterThirdPass = await prisma.client.lessonProgress.findFirstOrThrow();
    expect(afterThirdPass.status).toBe(LessonProgressStatus.COMPLETED);
    expect(afterThirdPass.completedAt?.toISOString()).toBe(completedAt);

    await expect(prisma.client.lessonProgress.count()).resolves.toBe(1);
    await expect(prisma.client.quizAttempt.count()).resolves.toBe(4);
  });

  it('is idempotent on repeated submit of a qualifying attempt: no duplicate progress row, no restamped completedAt', async () => {
    const setup = await setUpAccessibleQuizLesson('completion-idempotent');
    await setUpTwoQuestions(setup.tenantId, setup.quizId);
    const started = await start(setup).expect(HttpStatus.CREATED);
    const attemptId = responseBody<{ attemptId: string }>(started).attemptId;

    await request(server)
      .post(submitPath(setup, attemptId))
      .set('Authorization', `Bearer ${setup.token}`)
      .set(INSTALLATION_ID_HEADER, setup.installationId)
      .expect(HttpStatus.OK);
    const first = await prisma.client.lessonProgress.findFirstOrThrow();

    await request(server)
      .post(submitPath(setup, attemptId))
      .set('Authorization', `Bearer ${setup.token}`)
      .set(INSTALLATION_ID_HEADER, setup.installationId)
      .expect(HttpStatus.OK);

    const rows = await prisma.client.lessonProgress.findMany();
    expect(rows).toHaveLength(1);
    expect(rows[0].completedAt?.toISOString()).toBe(first.completedAt?.toISOString());
  });

  it('converges concurrent submits of the SAME qualifying attempt to exactly one LessonProgress row', async () => {
    const setup = await setUpAccessibleQuizLesson('completion-concurrent-same-attempt');
    await setUpTwoQuestions(setup.tenantId, setup.quizId);
    const started = await start(setup).expect(HttpStatus.CREATED);
    const attemptId = responseBody<{ attemptId: string }>(started).attemptId;

    const responses = await Promise.all(
      [1, 2, 3].map(() =>
        request(server)
          .post(submitPath(setup, attemptId))
          .set('Authorization', `Bearer ${setup.token}`)
          .set(INSTALLATION_ID_HEADER, setup.installationId),
      ),
    );
    for (const response of responses) {
      expect(response.status).toBe(HttpStatus.OK);
    }

    await expect(prisma.client.lessonProgress.count()).resolves.toBe(1);
    const row = await prisma.client.lessonProgress.findFirstOrThrow();
    expect(row.status).toBe(LessonProgressStatus.COMPLETED);
    expect(row.completedAt?.toISOString()).toBe(NOW.toISOString());
  });

  it('converges concurrent qualifying submits of TWO SEPARATE attempts for the same Quiz Lesson to exactly one LessonProgress row', async () => {
    const setup = await setUpAccessibleQuizLesson('completion-concurrent-separate-attempts');
    await setUpTwoQuestions(setup.tenantId, setup.quizId);

    const startedA = await start(setup).expect(HttpStatus.CREATED);
    const attemptAId = responseBody<{ attemptId: string }>(startedA).attemptId;
    const startedB = await start(setup).expect(HttpStatus.CREATED);
    const attemptBId = responseBody<{ attemptId: string }>(startedB).attemptId;

    const responses = await Promise.all([
      request(server)
        .post(submitPath(setup, attemptAId))
        .set('Authorization', `Bearer ${setup.token}`)
        .set(INSTALLATION_ID_HEADER, setup.installationId),
      request(server)
        .post(submitPath(setup, attemptBId))
        .set('Authorization', `Bearer ${setup.token}`)
        .set(INSTALLATION_ID_HEADER, setup.installationId),
    ]);
    for (const response of responses) {
      expect(response.status).toBe(HttpStatus.OK);
    }

    // Both attempts individually graded successfully; only progress converges to one row.
    await expect(
      prisma.client.quizAttempt.count({ where: { id: { in: [attemptAId, attemptBId] } } }),
    ).resolves.toBe(2);
    await expect(
      prisma.client.quizAttempt.count({ where: { id: { in: [attemptAId, attemptBId] }, status: QuizAttemptStatus.GRADED } }),
    ).resolves.toBe(2);

    await expect(prisma.client.lessonProgress.count()).resolves.toBe(1);
    const row = await prisma.client.lessonProgress.findFirstOrThrow();
    expect(row.status).toBe(LessonProgressStatus.COMPLETED);
    expect(row.completedAt?.toISOString()).toBe(NOW.toISOString());
  });

  it("ties completed progress exclusively to the submitting student's own Enrollment/Lesson, never a foreign student's", async () => {
    const setup = await setUpAccessibleQuizLesson('completion-isolation');
    await setUpTwoQuestions(setup.tenantId, setup.quizId);

    // A second, independently-enrolled student on the SAME Course/Lesson.
    const otherStudentId = await createStudent('completion-isolation-other-student');
    await createTenantStudent(setup.tenantId, otherStudentId, TenantStudentStatus.ACTIVE);
    const otherEnrollmentId = await createEnrollmentDirect(
      setup.tenantId,
      otherStudentId,
      setup.courseId,
      setup.instructorId,
      EnrollmentStatus.ACTIVE,
    );
    const otherInstallationId = installation();
    await createActiveDevice(otherStudentId, otherInstallationId);
    const otherToken = await issueAccessToken(otherStudentId, PlatformRole.STUDENT);

    const startedOwn = await start(setup).expect(HttpStatus.CREATED);
    await request(server)
      .post(submitPath(setup, responseBody<{ attemptId: string }>(startedOwn).attemptId))
      .set('Authorization', `Bearer ${setup.token}`)
      .set(INSTALLATION_ID_HEADER, setup.installationId)
      .expect(HttpStatus.OK);

    const startedOther = await request(server)
      .post(startPath(setup))
      .set('Authorization', `Bearer ${otherToken}`)
      .set(INSTALLATION_ID_HEADER, otherInstallationId)
      .expect(HttpStatus.CREATED);
    await request(server)
      .post(submitPath(setup, responseBody<{ attemptId: string }>(startedOther).attemptId))
      .set('Authorization', `Bearer ${otherToken}`)
      .set(INSTALLATION_ID_HEADER, otherInstallationId)
      .expect(HttpStatus.OK);

    const rows = await prisma.client.lessonProgress.findMany();
    expect(rows).toHaveLength(2);
    const ownRow = rows.find((r) => r.studentUserId === setup.studentId);
    const otherRow = rows.find((r) => r.studentUserId === otherStudentId);
    expect(ownRow).toMatchObject({ enrollmentId: setup.enrollmentId, lessonId: setup.lessonId, status: LessonProgressStatus.COMPLETED });
    expect(otherRow).toMatchObject({ enrollmentId: otherEnrollmentId, lessonId: setup.lessonId, status: LessonProgressStatus.COMPLETED });
    expect(ownRow?.enrollmentId).not.toBe(otherRow?.enrollmentId);
  });

  it('still rejects QUIZ Lessons via the generic manual completion endpoint, while VIDEO and DOCUMENT completion continue to work', async () => {
    const setup = await setUpAccessibleQuizLesson('completion-generic-endpoint-protection');
    await setUpTwoQuestions(setup.tenantId, setup.quizId);

    const videoAssetId = await createVideoAssetDirect(setup.tenantId, setup.instructorId);
    const videoLessonId = await createLessonDirect(setup.tenantId, setup.courseId, setup.sectionId, {
      title: 'Video lesson',
      position: 2,
      status: LessonStatus.PUBLISHED,
      videoAssetId,
    });
    const documentAssetId = await createDocumentAssetDirect(setup.tenantId, setup.instructorId);
    const documentLessonId = await createLessonDirect(setup.tenantId, setup.courseId, setup.sectionId, {
      title: 'Document lesson',
      position: 3,
      status: LessonStatus.PUBLISHED,
      documentAssetId,
    });

    const quizRejected = await request(server)
      .post(`/student/courses/${setup.courseId}/lessons/${setup.lessonId}/complete`)
      .set('Authorization', `Bearer ${setup.token}`)
      .set(INSTALLATION_ID_HEADER, setup.installationId)
      .expect(HttpStatus.BAD_REQUEST);
    expect(quizRejected.body).toMatchObject({ error: { code: 'QUIZ_LESSON_COMPLETION_NOT_ALLOWED' } });

    const videoCompleted = await request(server)
      .post(`/student/courses/${setup.courseId}/lessons/${videoLessonId}/complete`)
      .set('Authorization', `Bearer ${setup.token}`)
      .set(INSTALLATION_ID_HEADER, setup.installationId)
      .expect(HttpStatus.OK);
    expect(videoCompleted.body).toMatchObject({ lessonId: videoLessonId, status: 'COMPLETED' });

    const documentCompleted = await request(server)
      .post(`/student/courses/${setup.courseId}/lessons/${documentLessonId}/complete`)
      .set('Authorization', `Bearer ${setup.token}`)
      .set(INSTALLATION_ID_HEADER, setup.installationId)
      .expect(HttpStatus.OK);
    expect(documentCompleted.body).toMatchObject({ lessonId: documentLessonId, status: 'COMPLETED' });

    const rows = await prisma.client.lessonProgress.findMany();
    expect(rows.map((r) => r.lessonId).sort()).toEqual([videoLessonId, documentLessonId].sort());
    expect(rows.find((r) => r.lessonId === setup.lessonId)).toBeUndefined();
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
    await prisma.client.documentAsset.deleteMany();
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
      where: { slug: { startsWith: 'student-quiz-attempt-test-' } },
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
        name: `Student Quiz Attempt Tenant ${slugSuffix}`,
        slug: `student-quiz-attempt-test-${slugSuffix}`,
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
      documentAssetId?: string;
      availableFrom?: Date;
      availableUntil?: Date;
    },
  ): Promise<string> {
    const id = uuid.create();
    const type = spec.quizId ? LessonType.QUIZ : spec.documentAssetId ? LessonType.DOCUMENT : LessonType.VIDEO;
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
    } else if (type === LessonType.DOCUMENT) {
      await prisma.client.documentLesson.create({
        data: { lessonId: id, tenantId, documentAssetId: spec.documentAssetId as string },
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

  async function createDocumentAssetDirect(tenantId: string, uploadedByUserId: string): Promise<string> {
    const id = uuid.create();
    await prisma.client.documentAsset.create({
      data: {
        id,
        tenantId,
        uploadedByUserId,
        externalAssetRef: `test-provider/document/${id}`,
        fileName: 'notes.pdf',
        mimeType: 'application/pdf',
        fileSizeBytes: BigInt(1024),
      },
    });
    return id;
  }

  async function createQuizDirect(
    tenantId: string,
    title: string,
    status: QuizStatus,
    passingScorePercent?: number,
    attemptLimit?: number,
  ): Promise<string> {
    const id = uuid.create();
    await prisma.client.quiz.create({
      data: {
        id,
        tenantId,
        title,
        status,
        passingScorePercent: passingScorePercent ?? null,
        attemptLimit: attemptLimit ?? null,
      },
    });
    return id;
  }

  async function createQuestionDirect(
    tenantId: string,
    quizId: string,
    type: QuestionType,
    position: number,
    status: QuestionStatus,
    points: number,
  ): Promise<string> {
    const id = uuid.create();
    await prisma.client.question.create({
      data: { id, tenantId, quizId, type, prompt: `Prompt ${position}`, position, points, status },
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
