import { HttpStatus, INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import * as cookieParser from 'cookie-parser';
import * as request from 'supertest';
import type { App } from 'supertest/types';
import {
  AccountStatus,
  CourseStatus,
  EnrollmentStatus,
  LessonStatus,
  LessonType,
  PlatformRole,
  QuestionStatus,
  QuestionType,
  QuizAttemptStatus,
  QuizStatus,
  SectionStatus,
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
import { RefreshSessionService } from '../auth/services/refresh-session.service';
import { UuidV7Service } from '../auth/services/uuid-v7.service';
import { testAuthConfig } from '../auth/test-helpers';
import { CoursesModule } from '../courses/courses.module';
import { TenancyModule } from '../tenancy/tenancy.module';
import { QuizzesModule } from './quizzes.module';

const testDatabaseUrl = process.env.TEST_DATABASE_URL;
const maybeDescribe = testDatabaseUrl ? describe : describe.skip;
const trustedOrigin = 'http://localhost:3000';
const NOW = new Date('2026-06-15T12:00:00.000Z');

maybeDescribe('instructor quiz attempts reporting HTTP PostgreSQL integration', () => {
  let app: INestApplication;
  let server: App;
  let prisma: PrismaService;
  let accessTokens: AccessTokenService;
  let refreshSessions: RefreshSessionService;
  let uuid: UuidV7Service;

  beforeEach(async () => {
    const databaseConfig: DatabaseRuntimeConfig = {
      databaseUrl: testDatabaseUrl as string,
      pool: { maxConnections: 8, connectionTimeoutMillis: 5_000, idleTimeoutMillis: 10_000 },
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
      .compile();

    app = moduleRef.createNestApplication();
    app.use(cookieParser());
    app.useGlobalPipes(
      new ValidationPipe({ transform: true, whitelist: true, forbidNonWhitelisted: true, forbidUnknownValues: true }),
    );
    app.useGlobalFilters(new ApiExceptionFilter());
    await app.init();
    server = app.getHttpServer() as App;

    prisma = moduleRef.get(PrismaService);
    accessTokens = moduleRef.get(AccessTokenService);
    refreshSessions = moduleRef.get(RefreshSessionService);
    uuid = moduleRef.get(UuidV7Service);

    await clearData();
  });

  afterEach(async () => {
    await clearData();
    await app?.close();
  });

  it('lists Attempts scoped to the exact tenant/Quiz, with correct student summary, IN_PROGRESS included, deterministic ordering', async () => {
    const { instructorId, tenantId, token } = await createInstructorTenant('scope');
    const quizId = await createQuizDirect(tenantId, 'Scope quiz', QuizStatus.PUBLISHED);
    const otherQuizId = await createQuizDirect(tenantId, 'Other quiz', QuizStatus.PUBLISHED);
    const courseId = await createCourseDirect(tenantId, instructorId, 'Scope course');
    const sectionId = await createSectionDirect(tenantId, courseId, 'Section', 1);
    const lessonId = await createQuizLessonDirect(tenantId, courseId, sectionId, quizId, 1);

    const studentA = await createStudentWithTenant('scope-student-a', tenantId, instructorId);
    const studentB = await createStudentWithTenant('scope-student-b', tenantId, instructorId);
    const enrollA = await createEnrollmentDirect(tenantId, studentA, courseId, instructorId);
    const enrollB = await createEnrollmentDirect(tenantId, studentB, courseId, instructorId);

    const gradedAttempt = await createAttemptDirect({
      tenantId, quizId, lessonId, studentUserId: studentA, enrollmentId: enrollA, attemptNumber: 1,
      status: QuizAttemptStatus.GRADED, startedAt: new Date('2026-06-01T00:00:00.000Z'),
      submittedAt: new Date('2026-06-01T00:10:00.000Z'), scorePoints: '8', maxPoints: '10', passed: true,
    });
    const inProgressAttempt = await createAttemptDirect({
      tenantId, quizId, lessonId, studentUserId: studentB, enrollmentId: enrollB, attemptNumber: 1,
      status: QuizAttemptStatus.IN_PROGRESS, startedAt: new Date('2026-06-02T00:00:00.000Z'),
    });
    // A different Quiz's Attempt — must never appear in `quizId`'s report.
    await createAttemptDirect({
      tenantId, quizId: otherQuizId, lessonId, studentUserId: studentA, enrollmentId: enrollA, attemptNumber: 1,
      status: QuizAttemptStatus.GRADED, startedAt: new Date('2026-06-03T00:00:00.000Z'),
      submittedAt: new Date('2026-06-03T00:10:00.000Z'), scorePoints: '5', maxPoints: '10', passed: false,
    });

    const response = await request(server)
      .get(`/instructor/tenants/${tenantId}/quizzes/${quizId}/attempts`)
      .set('Authorization', `Bearer ${token}`)
      .expect(HttpStatus.OK);
    type Row = {
      attemptId: string; quizId: string; status: string; scorePoints: string | null; maxPoints: string | null;
      percentage: string | null; passed: boolean | null;
      student: { studentUserId: string; email: string; displayName: string | null; accountStatus: string };
    };
    const items = responseBody<{ items: Row[] }>(response).items;
    // Newest (startedAt-adjacent createdAt) first: in-progress attempt was created after the graded one.
    expect(items.map((item) => item.attemptId)).toEqual([inProgressAttempt, gradedAttempt]);
    expect(items.every((item) => item.quizId === quizId)).toBe(true);

    const graded = items.find((item) => item.attemptId === gradedAttempt) as Row;
    expect(graded.status).toBe(QuizAttemptStatus.GRADED);
    expect(graded.scorePoints).toBe('8');
    expect(graded.maxPoints).toBe('10');
    expect(graded.percentage).toBe('80');
    expect(graded.passed).toBe(true);
    expect(graded.student).toMatchObject({ studentUserId: studentA, email: 'scope-student-a@example.test' });

    const inProgress = items.find((item) => item.attemptId === inProgressAttempt) as Row;
    expect(inProgress.status).toBe(QuizAttemptStatus.IN_PROGRESS);
    expect(inProgress.scorePoints).toBeNull();
    expect(inProgress.maxPoints).toBeNull();
    expect(inProgress.percentage).toBeNull();
    expect(inProgress.passed).toBeNull();
  });

  it('reflects the exact historical persisted score/max/percentage/passed, unaffected by a later edit to the live Question', async () => {
    const { instructorId, tenantId, token } = await createInstructorTenant('historical');
    const quizId = await createQuizDirect(tenantId, 'Historical quiz', QuizStatus.PUBLISHED);
    const courseId = await createCourseDirect(tenantId, instructorId, 'Historical course');
    const sectionId = await createSectionDirect(tenantId, courseId, 'Section', 1);
    const lessonId = await createQuizLessonDirect(tenantId, courseId, sectionId, quizId, 1);
    const questionId = await createQuestionDirect(tenantId, quizId, QuestionType.TRUE_FALSE, 1, 5);
    await createOptionDirect(tenantId, questionId, 'True', 1, true);
    await createOptionDirect(tenantId, questionId, 'False', 2, false);

    const studentId = await createStudentWithTenant('historical-student', tenantId, instructorId);
    const enrollmentId = await createEnrollmentDirect(tenantId, studentId, courseId, instructorId);
    const attemptId = await createAttemptDirect({
      tenantId, quizId, lessonId, studentUserId: studentId, enrollmentId, attemptNumber: 1,
      status: QuizAttemptStatus.GRADED, startedAt: new Date('2026-06-01T00:00:00.000Z'),
      submittedAt: new Date('2026-06-01T00:10:00.000Z'), scorePoints: '5', maxPoints: '5', passed: true,
    });

    // The live Question is edited AFTER grading — points doubled. The historical Attempt must not
    // change: its own frozen scorePoints/maxPoints/percentage/passed are read verbatim.
    await prisma.client.question.update({ where: { id: questionId }, data: { points: 10 } });

    const response = await request(server)
      .get(`/instructor/tenants/${tenantId}/quizzes/${quizId}/attempts`)
      .set('Authorization', `Bearer ${token}`)
      .expect(HttpStatus.OK);
    type Row = { attemptId: string; scorePoints: string | null; maxPoints: string | null; percentage: string | null; passed: boolean | null };
    const row = responseBody<{ items: Row[] }>(response).items.find((item) => item.attemptId === attemptId) as Row;
    expect(row.scorePoints).toBe('5');
    expect(row.maxPoints).toBe('5');
    expect(row.percentage).toBe('100');
    expect(row.passed).toBe(true);
  });

  it('never exposes answer-key/snapshot internals in the HTTP response', async () => {
    const { instructorId, tenantId, token } = await createInstructorTenant('safety');
    const quizId = await createQuizDirect(tenantId, 'Safety quiz', QuizStatus.PUBLISHED);
    const courseId = await createCourseDirect(tenantId, instructorId, 'Safety course');
    const sectionId = await createSectionDirect(tenantId, courseId, 'Section', 1);
    const lessonId = await createQuizLessonDirect(tenantId, courseId, sectionId, quizId, 1);
    const questionId = await createQuestionDirect(tenantId, quizId, QuestionType.TRUE_FALSE, 1, 5);
    const correctOption = await createOptionDirect(tenantId, questionId, 'True', 1, true);
    await createOptionDirect(tenantId, questionId, 'False', 2, false);

    const studentId = await createStudentWithTenant('safety-student', tenantId, instructorId);
    const enrollmentId = await createEnrollmentDirect(tenantId, studentId, courseId, instructorId);
    const attemptId = await createAttemptDirect({
      tenantId, quizId, lessonId, studentUserId: studentId, enrollmentId, attemptNumber: 1,
      status: QuizAttemptStatus.GRADED, startedAt: NOW, submittedAt: NOW, scorePoints: '5', maxPoints: '5', passed: true,
    });
    await prisma.client.quizAttemptAnswer.create({
      data: {
        id: uuid.create(),
        attemptId,
        questionId,
        questionSnapshot: { questionId, type: 'TRUE_FALSE', prompt: 'Prompt', position: 1 },
        optionsSnapshot: [{ optionId: correctOption, label: null, text: 'True', position: 1 }],
        selectedOptionIdsSnapshot: [correctOption],
        correctAnswerSnapshot: { correctOptionIds: [correctOption] },
        pointsAwarded: '5',
        pointsPossible: '5',
      },
    });

    const response = await request(server)
      .get(`/instructor/tenants/${tenantId}/quizzes/${quizId}/attempts`)
      .set('Authorization', `Bearer ${token}`)
      .expect(HttpStatus.OK);
    const raw = JSON.stringify(response.body);
    expect(raw).not.toContain('correctAnswerSnapshot');
    expect(raw).not.toContain('questionSnapshot');
    expect(raw).not.toContain('optionsSnapshot');
    expect(raw).not.toContain('selectedOptionIdsSnapshot');
    expect(raw).not.toContain('pointsAwarded');
    expect(raw).not.toContain('pointsPossible');
    expect(raw).not.toContain('answers');
  });

  it('paginates deterministically and supports studentUserId/passed filters', async () => {
    const { instructorId, tenantId, token } = await createInstructorTenant('filters');
    const quizId = await createQuizDirect(tenantId, 'Filters quiz', QuizStatus.PUBLISHED);
    const courseId = await createCourseDirect(tenantId, instructorId, 'Filters course');
    const sectionId = await createSectionDirect(tenantId, courseId, 'Section', 1);
    const lessonId = await createQuizLessonDirect(tenantId, courseId, sectionId, quizId, 1);

    const studentX = await createStudentWithTenant('filters-student-x', tenantId, instructorId);
    const studentY = await createStudentWithTenant('filters-student-y', tenantId, instructorId);
    const enrollX = await createEnrollmentDirect(tenantId, studentX, courseId, instructorId);
    const enrollY = await createEnrollmentDirect(tenantId, studentY, courseId, instructorId);

    const passedAttempt = await createAttemptDirect({
      tenantId, quizId, lessonId, studentUserId: studentX, enrollmentId: enrollX, attemptNumber: 1,
      status: QuizAttemptStatus.GRADED, startedAt: new Date('2026-06-01T00:00:00.000Z'),
      submittedAt: new Date('2026-06-01T00:10:00.000Z'), scorePoints: '9', maxPoints: '10', passed: true,
    });
    const failedAttempt = await createAttemptDirect({
      tenantId, quizId, lessonId, studentUserId: studentX, enrollmentId: enrollX, attemptNumber: 2,
      status: QuizAttemptStatus.GRADED, startedAt: new Date('2026-06-02T00:00:00.000Z'),
      submittedAt: new Date('2026-06-02T00:10:00.000Z'), scorePoints: '2', maxPoints: '10', passed: false,
    });
    const otherStudentAttempt = await createAttemptDirect({
      tenantId, quizId, lessonId, studentUserId: studentY, enrollmentId: enrollY, attemptNumber: 1,
      status: QuizAttemptStatus.GRADED, startedAt: new Date('2026-06-03T00:00:00.000Z'),
      submittedAt: new Date('2026-06-03T00:10:00.000Z'), scorePoints: '10', maxPoints: '10', passed: true,
    });

    type Row = { attemptId: string };
    type Page = { items: Row[]; hasMore: boolean };

    const firstPage = await request(server)
      .get(`/instructor/tenants/${tenantId}/quizzes/${quizId}/attempts`)
      .query({ limit: 2, offset: 0 })
      .set('Authorization', `Bearer ${token}`)
      .expect(HttpStatus.OK);
    const firstBody = responseBody<Page>(firstPage);
    expect(firstBody.items.map((item) => item.attemptId)).toEqual([otherStudentAttempt, failedAttempt]);
    // Three Attempts exist, limit is 2 — a real next page exists.
    expect(firstBody.hasMore).toBe(true);

    const secondPage = await request(server)
      .get(`/instructor/tenants/${tenantId}/quizzes/${quizId}/attempts`)
      .query({ limit: 2, offset: 2 })
      .set('Authorization', `Bearer ${token}`)
      .expect(HttpStatus.OK);
    const secondBody = responseBody<Page>(secondPage);
    expect(secondBody.items.map((item) => item.attemptId)).toEqual([passedAttempt]);
    expect(secondBody.hasMore).toBe(false);

    const byStudent = await request(server)
      .get(`/instructor/tenants/${tenantId}/quizzes/${quizId}/attempts`)
      .query({ studentUserId: studentX })
      .set('Authorization', `Bearer ${token}`)
      .expect(HttpStatus.OK);
    const byStudentBody = responseBody<Page>(byStudent);
    expect(byStudentBody.items.map((item) => item.attemptId).sort()).toEqual([passedAttempt, failedAttempt].sort());
    // `hasMore` must reflect the filtered (2-row) result set, not the unfiltered 3-row table.
    expect(byStudentBody.hasMore).toBe(false);

    const byPassed = await request(server)
      .get(`/instructor/tenants/${tenantId}/quizzes/${quizId}/attempts`)
      .query({ passed: 'true' })
      .set('Authorization', `Bearer ${token}`)
      .expect(HttpStatus.OK);
    const byPassedBody = responseBody<Page>(byPassed);
    expect(byPassedBody.items.map((item) => item.attemptId).sort()).toEqual([passedAttempt, otherStudentAttempt].sort());
    expect(byPassedBody.hasMore).toBe(false);
  });

  it('denies a foreign/random Quiz and a foreign instructor without leaking existence', async () => {
    const { instructorId, tenantId, token } = await createInstructorTenant('deny');
    const { instructorId: otherInstructorId, tenantId: otherTenantId, token: otherToken } =
      await createInstructorTenant('deny-other');
    const quizId = await createQuizDirect(tenantId, 'Deny quiz', QuizStatus.PUBLISHED);
    const otherQuizId = await createQuizDirect(otherTenantId, 'Other tenant quiz', QuizStatus.PUBLISHED);
    void instructorId;
    void otherInstructorId;

    const randomQuiz = await request(server)
      .get(`/instructor/tenants/${tenantId}/quizzes/${uuid.create()}/attempts`)
      .set('Authorization', `Bearer ${token}`)
      .expect(HttpStatus.NOT_FOUND);
    expect(randomQuiz.body).toMatchObject({ error: { code: 'QUIZ_NOT_FOUND' } });

    const foreignQuiz = await request(server)
      .get(`/instructor/tenants/${tenantId}/quizzes/${otherQuizId}/attempts`)
      .set('Authorization', `Bearer ${token}`)
      .expect(HttpStatus.NOT_FOUND);
    expect(foreignQuiz.body).toMatchObject({ error: { code: 'QUIZ_NOT_FOUND' } });

    await request(server)
      .get(`/instructor/tenants/${tenantId}/quizzes/${quizId}/attempts`)
      .set('Authorization', `Bearer ${otherToken}`)
      .expect(HttpStatus.FORBIDDEN);
  });

  async function clearData(): Promise<void> {
    await prisma.client.quizAttemptAnswer.deleteMany();
    await prisma.client.quizAttempt.deleteMany();
    await prisma.client.lessonProgress.deleteMany();
    await prisma.client.enrollment.deleteMany();
    await prisma.client.quizLesson.deleteMany();
    await prisma.client.questionOption.deleteMany();
    await prisma.client.question.deleteMany();
    await prisma.client.quiz.deleteMany();
    await prisma.client.lesson.deleteMany();
    await prisma.client.courseSection.deleteMany();
    await prisma.client.course.deleteMany();
    await prisma.client.securityEvent.deleteMany();
    await prisma.client.notification.deleteMany();
    await prisma.client.tenantStudent.deleteMany();
    await prisma.client.tenantMembership.deleteMany();
    await prisma.client.studentDevice.deleteMany();
    await prisma.client.studentProfile.deleteMany();
    await prisma.client.instructorProfile.deleteMany();
    await prisma.client.refreshSession.deleteMany();
    await prisma.client.authCredential.deleteMany();
    await prisma.client.tenant.deleteMany({ where: { slug: { startsWith: 'instructor-attempts-test-' } } });
    await prisma.client.user.deleteMany({ where: { normalizedEmail: { endsWith: '@example.test' } } });
  }

  async function createUser(emailPrefix: string, platformRole: PlatformRole): Promise<string> {
    const id = uuid.create();
    await prisma.client.user.create({
      data: { id, email: `${emailPrefix}@example.test`, normalizedEmail: `${emailPrefix}@example.test`, accountStatus: AccountStatus.ACTIVE, platformRole },
    });
    return id;
  }

  async function createInstructorTenant(slugSuffix: string): Promise<{ instructorId: string; tenantId: string; token: string }> {
    const instructorId = await createUser(`instructor-${slugSuffix}`, PlatformRole.INSTRUCTOR);
    await prisma.client.instructorProfile.create({ data: { id: uuid.create(), userId: instructorId } });
    const tenant = await prisma.client.tenant.create({
      data: {
        id: uuid.create(),
        name: `Instructor Attempts Tenant ${slugSuffix}`,
        slug: `instructor-attempts-test-${slugSuffix}`,
        status: TenantStatus.ACTIVE,
      },
    });
    await prisma.client.tenantMembership.create({
      data: { id: uuid.create(), tenantId: tenant.id, userId: instructorId, role: TenantMembershipRole.OWNER, status: TenantMembershipStatus.ACTIVE },
    });
    return { instructorId, tenantId: tenant.id, token: await issueAccessToken(instructorId, PlatformRole.INSTRUCTOR) };
  }

  async function createStudentWithTenant(emailPrefix: string, tenantId: string, createdByUserId: string): Promise<string> {
    const studentId = await createUser(emailPrefix, PlatformRole.STUDENT);
    await prisma.client.studentProfile.create({ data: { id: uuid.create(), userId: studentId } });
    await prisma.client.tenantStudent.create({
      data: {
        id: uuid.create(),
        tenantId,
        studentUserId: studentId,
        status: TenantStudentStatus.ACTIVE,
        createdByUserId,
        activatedAt: NOW,
        createdAt: NOW,
      },
    });
    return studentId;
  }

  async function createCourseDirect(tenantId: string, createdByUserId: string, title: string): Promise<string> {
    const id = uuid.create();
    await prisma.client.course.create({ data: { id, tenantId, createdByUserId, title, status: CourseStatus.PUBLISHED } });
    return id;
  }

  async function createSectionDirect(tenantId: string, courseId: string, title: string, position: number): Promise<string> {
    const id = uuid.create();
    await prisma.client.courseSection.create({ data: { id, tenantId, courseId, title, position, status: SectionStatus.PUBLISHED } });
    return id;
  }

  async function createQuizLessonDirect(tenantId: string, courseId: string, sectionId: string, quizId: string, position: number): Promise<string> {
    const id = uuid.create();
    await prisma.client.lesson.create({
      data: { id, tenantId, courseId, sectionId, title: `Quiz lesson ${position}`, position, type: LessonType.QUIZ, status: LessonStatus.PUBLISHED },
    });
    await prisma.client.quizLesson.create({ data: { lessonId: id, tenantId, quizId } });
    return id;
  }

  async function createQuizDirect(tenantId: string, title: string, status: QuizStatus): Promise<string> {
    const id = uuid.create();
    await prisma.client.quiz.create({ data: { id, tenantId, title, status } });
    return id;
  }

  async function createQuestionDirect(tenantId: string, quizId: string, type: QuestionType, position: number, points: number): Promise<string> {
    const id = uuid.create();
    await prisma.client.question.create({
      data: { id, tenantId, quizId, type, prompt: `Prompt ${position}`, position, points, status: QuestionStatus.ACTIVE },
    });
    return id;
  }

  async function createOptionDirect(tenantId: string, questionId: string, text: string, position: number, isCorrect: boolean): Promise<string> {
    const id = uuid.create();
    await prisma.client.questionOption.create({ data: { id, tenantId, questionId, text, position, isCorrect } });
    return id;
  }

  async function createEnrollmentDirect(tenantId: string, studentUserId: string, courseId: string, grantedByUserId: string): Promise<string> {
    const id = uuid.create();
    await prisma.client.enrollment.create({
      data: { id, tenantId, studentUserId, courseId, grantedByUserId, status: EnrollmentStatus.ACTIVE },
    });
    return id;
  }

  async function createAttemptDirect(input: {
    tenantId: string;
    quizId: string;
    lessonId: string;
    studentUserId: string;
    enrollmentId: string;
    attemptNumber: number;
    status: QuizAttemptStatus;
    startedAt: Date;
    submittedAt?: Date;
    scorePoints?: string;
    maxPoints?: string;
    passed?: boolean;
  }): Promise<string> {
    const id = uuid.create();
    await prisma.client.quizAttempt.create({
      data: {
        id,
        tenantId: input.tenantId,
        quizId: input.quizId,
        lessonId: input.lessonId,
        studentUserId: input.studentUserId,
        enrollmentId: input.enrollmentId,
        attemptNumber: input.attemptNumber,
        status: input.status,
        startedAt: input.startedAt,
        submittedAt: input.submittedAt ?? null,
        gradedAt: input.submittedAt ?? null,
        scorePoints: input.scorePoints ?? null,
        maxPoints: input.maxPoints ?? null,
        passed: input.passed ?? null,
        createdAt: input.startedAt,
        updatedAt: input.submittedAt ?? input.startedAt,
      },
    });
    return id;
  }

  async function issueAccessToken(userId: string, platformRole: PlatformRole): Promise<string> {
    const session = await refreshSessions.createSession({ userId, channel: 'MOBILE' });
    return accessTokens.sign({ userId, sessionId: session.sessionId, platformRole });
  }
});

function responseBody<T>(response: request.Response): T {
  return response.body as T;
}
