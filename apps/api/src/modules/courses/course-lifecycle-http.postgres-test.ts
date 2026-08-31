import { HttpStatus, INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import * as cookieParser from 'cookie-parser';
import * as request from 'supertest';
import type { App } from 'supertest/types';
import {
  AccountStatus,
  AssetProcessingStatus,
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
import { INSTALLATION_ID_HEADER } from '../devices/types/device.types';
import { TenancyModule } from '../tenancy/tenancy.module';
import { QuizzesModule } from '../quizzes/quizzes.module';
import { CoursesModule } from './courses.module';

const testDatabaseUrl = process.env.TEST_DATABASE_URL;
const maybeDescribe = testDatabaseUrl ? describe : describe.skip;
const trustedOrigin = 'http://localhost:3000';
const NOW = new Date('2026-06-15T12:00:00.000Z');

maybeDescribe('instructor content lifecycle HTTP PostgreSQL integration', () => {
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
        maxConnections: 8,
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

  it('supports Course DRAFT->PUBLISHED, idempotent publish, DRAFT/PUBLISHED->ARCHIVED, and no ARCHIVED resurrection', async () => {
    const { token, tenantId, instructorId } = await createInstructorTenant('course-transitions');
    const courseId = await createCourse(tenantId, instructorId, CourseStatus.DRAFT);

    await request(server)
      .post(`/instructor/tenants/${tenantId}/courses/${courseId}/publish`)
      .set('Authorization', `Bearer ${token}`)
      .expect(HttpStatus.OK)
      .expect(({ body }) => expect(body).toMatchObject({ courseId, status: CourseStatus.PUBLISHED }));

    const publishedAt = (await prisma.client.course.findUniqueOrThrow({ where: { id: courseId } })).publishedAt;

    await request(server)
      .post(`/instructor/tenants/${tenantId}/courses/${courseId}/publish`)
      .set('Authorization', `Bearer ${token}`)
      .expect(HttpStatus.OK);
    await expect(prisma.client.course.findUniqueOrThrow({ where: { id: courseId } })).resolves.toMatchObject({
      status: CourseStatus.PUBLISHED,
      publishedAt,
    });

    await request(server)
      .post(`/instructor/tenants/${tenantId}/courses/${courseId}/archive`)
      .set('Authorization', `Bearer ${token}`)
      .expect(HttpStatus.OK)
      .expect(({ body }) => expect(body).toMatchObject({ status: CourseStatus.ARCHIVED }));

    const archivedAt = (await prisma.client.course.findUniqueOrThrow({ where: { id: courseId } })).archivedAt;
    await request(server)
      .post(`/instructor/tenants/${tenantId}/courses/${courseId}/archive`)
      .set('Authorization', `Bearer ${token}`)
      .expect(HttpStatus.OK);
    await expect(prisma.client.course.findUniqueOrThrow({ where: { id: courseId } })).resolves.toMatchObject({
      status: CourseStatus.ARCHIVED,
      archivedAt,
    });

    await request(server)
      .post(`/instructor/tenants/${tenantId}/courses/${courseId}/publish`)
      .set('Authorization', `Bearer ${token}`)
      .expect(HttpStatus.CONFLICT)
      .expect(({ body }) =>
        expect(body).toMatchObject({ error: { code: 'INVALID_COURSE_LIFECYCLE_TRANSITION' } }),
      );
    await expect(prisma.client.course.findUniqueOrThrow({ where: { id: courseId } })).resolves.toMatchObject({
      status: CourseStatus.ARCHIVED,
    });

    const draftArchiveCourse = await createCourse(tenantId, instructorId, CourseStatus.DRAFT);
    await request(server)
      .post(`/instructor/tenants/${tenantId}/courses/${draftArchiveCourse}/archive`)
      .set('Authorization', `Bearer ${token}`)
      .expect(HttpStatus.OK)
      .expect((response) =>
        expect(responseBody<{ status: CourseStatus }>(response).status).toBe(CourseStatus.ARCHIVED),
      );
  });

  it('enforces instructor tenant authorization and non-leaking ownership for lifecycle actions', async () => {
    const { token, tenantId, instructorId } = await createInstructorTenant('scope-a');
    const { token: otherToken, tenantId: otherTenantId, instructorId: otherInstructorId } =
      await createInstructorTenant('scope-b');
    const courseId = await createCourse(tenantId, instructorId, CourseStatus.DRAFT);
    const otherCourseId = await createCourse(otherTenantId, otherInstructorId, CourseStatus.DRAFT);
    const sectionId = await createSection(tenantId, courseId, SectionStatus.DRAFT);
    const otherSectionId = await createSection(otherTenantId, otherCourseId, SectionStatus.DRAFT);
    const quizId = await createValidQuiz(tenantId);
    const otherQuizId = await createValidQuiz(otherTenantId);
    await createQuizLesson(tenantId, courseId, sectionId, LessonStatus.DRAFT, quizId);
    const otherLessonId = await createQuizLesson(otherTenantId, otherCourseId, otherSectionId, LessonStatus.DRAFT, otherQuizId);

    await request(server)
      .post(`/instructor/tenants/${tenantId}/courses/${courseId}/publish`)
      .set('Authorization', `Bearer ${otherToken}`)
      .expect(HttpStatus.FORBIDDEN);

    await request(server)
      .post(`/instructor/tenants/${tenantId}/courses/${otherCourseId}/publish`)
      .set('Authorization', `Bearer ${token}`)
      .expect(HttpStatus.NOT_FOUND);

    await request(server)
      .post(`/instructor/tenants/${tenantId}/courses/${courseId}/sections/${otherSectionId}/publish`)
      .set('Authorization', `Bearer ${token}`)
      .expect(HttpStatus.NOT_FOUND);

    await request(server)
      .post(
        `/instructor/tenants/${tenantId}/courses/${courseId}/sections/${sectionId}/lessons/${otherLessonId}/publish`,
      )
      .set('Authorization', `Bearer ${token}`)
      .expect(HttpStatus.NOT_FOUND);

    await request(server)
      .post(`/instructor/tenants/${tenantId}/quizzes/${otherQuizId}/publish`)
      .set('Authorization', `Bearer ${token}`)
      .expect(HttpStatus.NOT_FOUND);

    const randomId = uuid.create();
    await request(server)
      .post(`/instructor/tenants/${tenantId}/courses/${randomId}/archive`)
      .set('Authorization', `Bearer ${token}`)
      .expect(HttpStatus.NOT_FOUND);
    await request(server)
      .post(`/instructor/tenants/${tenantId}/quizzes/${randomId}/archive`)
      .set('Authorization', `Bearer ${token}`)
      .expect(HttpStatus.NOT_FOUND);

    await expect(prisma.client.course.findUniqueOrThrow({ where: { id: otherCourseId } })).resolves.toMatchObject({
      status: CourseStatus.DRAFT,
    });
    await expect(prisma.client.courseSection.findUniqueOrThrow({ where: { id: otherSectionId } })).resolves.toMatchObject({
      status: SectionStatus.DRAFT,
    });
    await expect(prisma.client.lesson.findUniqueOrThrow({ where: { id: otherLessonId } })).resolves.toMatchObject({
      status: LessonStatus.DRAFT,
    });
  });

  it('publishes and archives Sections without cascading or changing ordering behavior', async () => {
    const { token, tenantId, instructorId } = await createInstructorTenant('section-transitions');
    const courseId = await createCourse(tenantId, instructorId, CourseStatus.DRAFT);
    const sectionId = await createSection(tenantId, courseId, SectionStatus.DRAFT, 1);
    const lessonId = await createQuizLesson(tenantId, courseId, sectionId, LessonStatus.DRAFT, await createValidQuiz(tenantId));

    await request(server)
      .post(`/instructor/tenants/${tenantId}/courses/${courseId}/sections/${sectionId}/publish`)
      .set('Authorization', `Bearer ${token}`)
      .expect(HttpStatus.OK)
      .expect((response) =>
        expect(responseBody<{ status: SectionStatus }>(response).status).toBe(SectionStatus.PUBLISHED),
      );

    await request(server)
      .post(`/instructor/tenants/${tenantId}/courses/${courseId}/sections/${sectionId}/publish`)
      .set('Authorization', `Bearer ${token}`)
      .expect(HttpStatus.OK);

    await expect(prisma.client.course.findUniqueOrThrow({ where: { id: courseId } })).resolves.toMatchObject({
      status: CourseStatus.DRAFT,
    });
    await expect(prisma.client.lesson.findUniqueOrThrow({ where: { id: lessonId } })).resolves.toMatchObject({
      status: LessonStatus.DRAFT,
    });

    await request(server)
      .post(`/instructor/tenants/${tenantId}/courses/${courseId}/sections/${sectionId}/archive`)
      .set('Authorization', `Bearer ${token}`)
      .expect(HttpStatus.OK)
      .expect(({ body }) => expect(body).toMatchObject({ status: SectionStatus.ARCHIVED, position: 1 }));

    await request(server)
      .post(`/instructor/tenants/${tenantId}/courses/${courseId}/sections/${sectionId}/publish`)
      .set('Authorization', `Bearer ${token}`)
      .expect(HttpStatus.CONFLICT)
      .expect(({ body }) =>
        expect(body).toMatchObject({ error: { code: 'INVALID_SECTION_LIFECYCLE_TRANSITION' } }),
      );
  });

  it('requires Lesson publishable content and never auto-publishes parent Course/Section or linked Quiz', async () => {
    const { token, tenantId, instructorId } = await createInstructorTenant('lesson-publishable');
    const courseId = await createCourse(tenantId, instructorId, CourseStatus.DRAFT);
    const sectionId = await createSection(tenantId, courseId, SectionStatus.DRAFT);

    const readyVideo = await createVideoAsset(tenantId, instructorId, AssetProcessingStatus.READY);
    const processingVideo = await createVideoAsset(tenantId, instructorId, AssetProcessingStatus.PROCESSING);
    const readyDoc = await createDocumentAsset(tenantId, instructorId, AssetProcessingStatus.READY);
    const processingDoc = await createDocumentAsset(tenantId, instructorId, AssetProcessingStatus.PROCESSING);
    const publishedQuiz = await createValidQuiz(tenantId, QuizStatus.PUBLISHED);
    const draftQuiz = await createValidQuiz(tenantId, QuizStatus.DRAFT);

    const readyVideoLesson = await createVideoLesson(tenantId, courseId, sectionId, LessonStatus.DRAFT, readyVideo, 1);
    const processingVideoLesson = await createVideoLesson(
      tenantId,
      courseId,
      sectionId,
      LessonStatus.DRAFT,
      processingVideo,
      2,
    );
    const readyDocLesson = await createDocumentLesson(tenantId, courseId, sectionId, LessonStatus.DRAFT, readyDoc, 3);
    const processingDocLesson = await createDocumentLesson(
      tenantId,
      courseId,
      sectionId,
      LessonStatus.DRAFT,
      processingDoc,
      4,
    );
    const publishedQuizLesson = await createQuizLesson(tenantId, courseId, sectionId, LessonStatus.DRAFT, publishedQuiz, 5);
    const draftQuizLesson = await createQuizLesson(tenantId, courseId, sectionId, LessonStatus.DRAFT, draftQuiz, 6);

    for (const lessonId of [readyVideoLesson, readyDocLesson, publishedQuizLesson]) {
      await request(server)
        .post(`/instructor/tenants/${tenantId}/courses/${courseId}/sections/${sectionId}/lessons/${lessonId}/publish`)
        .set('Authorization', `Bearer ${token}`)
        .expect(HttpStatus.OK)
        .expect((response) =>
          expect(responseBody<{ status: LessonStatus }>(response).status).toBe(LessonStatus.PUBLISHED),
        );
    }

    for (const lessonId of [processingVideoLesson, processingDocLesson, draftQuizLesson]) {
      await request(server)
        .post(`/instructor/tenants/${tenantId}/courses/${courseId}/sections/${sectionId}/lessons/${lessonId}/publish`)
        .set('Authorization', `Bearer ${token}`)
        .expect(HttpStatus.CONFLICT)
        .expect(({ body }) => expect(body).toMatchObject({ error: { code: 'LESSON_CONTENT_NOT_READY' } }));
    }

    await expect(prisma.client.course.findUniqueOrThrow({ where: { id: courseId } })).resolves.toMatchObject({
      status: CourseStatus.DRAFT,
    });
    await expect(prisma.client.courseSection.findUniqueOrThrow({ where: { id: sectionId } })).resolves.toMatchObject({
      status: SectionStatus.DRAFT,
    });
    await expect(prisma.client.quiz.findUniqueOrThrow({ where: { id: draftQuiz } })).resolves.toMatchObject({
      status: QuizStatus.DRAFT,
    });
  });

  it('validates Quiz aggregate state before publishing and treats ARCHIVED as terminal', async () => {
    const { token, tenantId } = await createInstructorTenant('quiz-transitions');
    const validQuiz = await createValidQuiz(tenantId, QuizStatus.DRAFT);

    await request(server)
      .post(`/instructor/tenants/${tenantId}/quizzes/${validQuiz}/publish`)
      .set('Authorization', `Bearer ${token}`)
      .expect(HttpStatus.OK)
      .expect((response) =>
        expect(responseBody<{ status: QuizStatus }>(response).status).toBe(QuizStatus.PUBLISHED),
      );

    const publishedAt = (await prisma.client.quiz.findUniqueOrThrow({ where: { id: validQuiz } })).publishedAt;
    await request(server)
      .post(`/instructor/tenants/${tenantId}/quizzes/${validQuiz}/publish`)
      .set('Authorization', `Bearer ${token}`)
      .expect(HttpStatus.OK);
    await expect(prisma.client.quiz.findUniqueOrThrow({ where: { id: validQuiz } })).resolves.toMatchObject({
      status: QuizStatus.PUBLISHED,
      publishedAt,
    });

    await request(server)
      .post(`/instructor/tenants/${tenantId}/quizzes/${validQuiz}/archive`)
      .set('Authorization', `Bearer ${token}`)
      .expect(HttpStatus.OK)
      .expect((response) =>
        expect(responseBody<{ status: QuizStatus }>(response).status).toBe(QuizStatus.ARCHIVED),
      );
    await request(server)
      .post(`/instructor/tenants/${tenantId}/quizzes/${validQuiz}/publish`)
      .set('Authorization', `Bearer ${token}`)
      .expect(HttpStatus.CONFLICT)
      .expect(({ body }) =>
        expect(body).toMatchObject({ error: { code: 'INVALID_QUIZ_LIFECYCLE_TRANSITION' } }),
      );

    const emptyQuiz = await createQuiz(tenantId, QuizStatus.DRAFT);
    await request(server)
      .post(`/instructor/tenants/${tenantId}/quizzes/${emptyQuiz}/publish`)
      .set('Authorization', `Bearer ${token}`)
      .expect(HttpStatus.CONFLICT)
      .expect(({ body }) => expect(body).toMatchObject({ error: { code: 'QUIZ_NOT_PUBLISHABLE' } }));

    const noCorrectQuiz = await createQuiz(tenantId, QuizStatus.DRAFT);
    const q1 = await createQuestion(tenantId, noCorrectQuiz, QuestionType.MULTIPLE_CHOICE, QuestionStatus.ACTIVE);
    await createOption(tenantId, q1, false, 1);
    await createOption(tenantId, q1, false, 2);
    await request(server)
      .post(`/instructor/tenants/${tenantId}/quizzes/${noCorrectQuiz}/publish`)
      .set('Authorization', `Bearer ${token}`)
      .expect(HttpStatus.CONFLICT);

    const archivedOnlyQuiz = await createQuiz(tenantId, QuizStatus.DRAFT);
    const archivedQuestion = await createQuestion(
      tenantId,
      archivedOnlyQuiz,
      QuestionType.TRUE_FALSE,
      QuestionStatus.ARCHIVED,
    );
    await createOption(tenantId, archivedQuestion, true, 1);
    await createOption(tenantId, archivedQuestion, false, 2);
    await request(server)
      .post(`/instructor/tenants/${tenantId}/quizzes/${archivedOnlyQuiz}/publish`)
      .set('Authorization', `Bearer ${token}`)
      .expect(HttpStatus.CONFLICT)
      .expect(({ body }) => expect(body).toMatchObject({ error: { code: 'QUIZ_NOT_PUBLISHABLE' } }));
  });

  it('lifecycle transitions are race-safe for duplicate publish and publish/archive races', async () => {
    const { token, tenantId, instructorId } = await createInstructorTenant('race');
    const courseId = await createCourse(tenantId, instructorId, CourseStatus.DRAFT);

    const duplicatePublish = await Promise.all([
      request(server).post(`/instructor/tenants/${tenantId}/courses/${courseId}/publish`).set('Authorization', `Bearer ${token}`),
      request(server).post(`/instructor/tenants/${tenantId}/courses/${courseId}/publish`).set('Authorization', `Bearer ${token}`),
    ]);
    expect(duplicatePublish.map((response) => response.status)).toEqual([HttpStatus.OK, HttpStatus.OK]);
    await expect(prisma.client.course.findUniqueOrThrow({ where: { id: courseId } })).resolves.toMatchObject({
      status: CourseStatus.PUBLISHED,
    });

    const racingCourse = await createCourse(tenantId, instructorId, CourseStatus.DRAFT);
    const raced = await Promise.all([
      request(server).post(`/instructor/tenants/${tenantId}/courses/${racingCourse}/publish`).set('Authorization', `Bearer ${token}`),
      request(server).post(`/instructor/tenants/${tenantId}/courses/${racingCourse}/archive`).set('Authorization', `Bearer ${token}`),
    ]);
    expect(raced.every((response) => [HttpStatus.OK, HttpStatus.CONFLICT].includes(response.status))).toBe(true);
    await expect(prisma.client.course.findUniqueOrThrow({ where: { id: racingCourse } })).resolves.toMatchObject({
      status: CourseStatus.ARCHIVED,
    });

    const quizId = await createValidQuiz(tenantId, QuizStatus.DRAFT);
    const quizPublishes = await Promise.all([
      request(server).post(`/instructor/tenants/${tenantId}/quizzes/${quizId}/publish`).set('Authorization', `Bearer ${token}`),
      request(server).post(`/instructor/tenants/${tenantId}/quizzes/${quizId}/publish`).set('Authorization', `Bearer ${token}`),
    ]);
    expect(quizPublishes.map((response) => response.status)).toEqual([HttpStatus.OK, HttpStatus.OK]);
    await expect(prisma.client.quiz.findUniqueOrThrow({ where: { id: quizId } })).resolves.toMatchObject({
      status: QuizStatus.PUBLISHED,
    });
  });

  it('student APIs observe explicit publish gates and archive removal through the canonical entitlement chain', async () => {
    const { token, tenantId, instructorId } = await createInstructorTenant('student-gates');
    const studentId = await createStudent('student-gates-student');
    const installationId = installation();
    await createTenantStudent(tenantId, studentId);
    await createActiveDevice(studentId, installationId);
    const studentToken = await issueAccessToken(studentId, PlatformRole.STUDENT);

    const courseId = await createCourse(tenantId, instructorId, CourseStatus.DRAFT);
    await createEnrollment(tenantId, studentId, courseId, instructorId);
    const sectionId = await createSection(tenantId, courseId, SectionStatus.DRAFT);
    const quizId = await createValidQuiz(tenantId, QuizStatus.DRAFT);
    const lessonId = await createQuizLesson(tenantId, courseId, sectionId, LessonStatus.DRAFT, quizId);

    await request(server)
      .get(`/student/courses/${courseId}`)
      .set('Authorization', `Bearer ${studentToken}`)
      .set(INSTALLATION_ID_HEADER, installationId)
      .expect(HttpStatus.NOT_FOUND);

    await request(server).post(`/instructor/tenants/${tenantId}/courses/${courseId}/publish`).set('Authorization', `Bearer ${token}`).expect(HttpStatus.OK);
    await request(server)
      .get(`/student/courses/${courseId}`)
      .set('Authorization', `Bearer ${studentToken}`)
      .set(INSTALLATION_ID_HEADER, installationId)
      .expect(HttpStatus.OK)
      .expect((response) =>
        expect(responseBody<{ sections: unknown[] }>(response).sections).toHaveLength(0),
      );

    await request(server).post(`/instructor/tenants/${tenantId}/courses/${courseId}/sections/${sectionId}/publish`).set('Authorization', `Bearer ${token}`).expect(HttpStatus.OK);
    await request(server)
      .get(`/student/courses/${courseId}`)
      .set('Authorization', `Bearer ${studentToken}`)
      .set(INSTALLATION_ID_HEADER, installationId)
      .expect(HttpStatus.OK)
      .expect((response) =>
        expect(responseBody<{ sections: Array<{ lessons: unknown[] }> }>(response).sections[0].lessons).toHaveLength(
          0,
        ),
      );

    await request(server)
      .post(`/instructor/tenants/${tenantId}/courses/${courseId}/sections/${sectionId}/lessons/${lessonId}/publish`)
      .set('Authorization', `Bearer ${token}`)
      .expect(HttpStatus.CONFLICT);

    await request(server).post(`/instructor/tenants/${tenantId}/quizzes/${quizId}/publish`).set('Authorization', `Bearer ${token}`).expect(HttpStatus.OK);
    await request(server)
      .post(`/instructor/tenants/${tenantId}/courses/${courseId}/sections/${sectionId}/lessons/${lessonId}/publish`)
      .set('Authorization', `Bearer ${token}`)
      .expect(HttpStatus.OK);

    await request(server)
      .get(`/student/courses/${courseId}/lessons/${lessonId}/quiz`)
      .set('Authorization', `Bearer ${studentToken}`)
      .set(INSTALLATION_ID_HEADER, installationId)
      .expect(HttpStatus.OK);

    await request(server)
      .post(`/instructor/tenants/${tenantId}/courses/${courseId}/sections/${sectionId}/lessons/${lessonId}/archive`)
      .set('Authorization', `Bearer ${token}`)
      .expect(HttpStatus.OK);
    await request(server)
      .get(`/student/courses/${courseId}/lessons/${lessonId}/quiz`)
      .set('Authorization', `Bearer ${studentToken}`)
      .set(INSTALLATION_ID_HEADER, installationId)
      .expect(HttpStatus.NOT_FOUND);
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
    await prisma.client.notification.deleteMany();
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
    await prisma.client.tenant.deleteMany({ where: { slug: { startsWith: 'lifecycle-test-' } } });
    await prisma.client.user.deleteMany({ where: { normalizedEmail: { endsWith: '@example.test' } } });
  }

  async function createUser(prefix: string, platformRole: PlatformRole): Promise<string> {
    const id = uuid.create();
    await prisma.client.user.create({
      data: {
        id,
        email: `${prefix}@example.test`,
        normalizedEmail: `${prefix}@example.test`,
        accountStatus: AccountStatus.ACTIVE,
        platformRole,
      },
    });
    return id;
  }

  async function createInstructorTenant(suffix: string): Promise<{ instructorId: string; tenantId: string; token: string }> {
    const instructorId = await createUser(`instructor-${suffix}`, PlatformRole.INSTRUCTOR);
    await prisma.client.instructorProfile.create({ data: { id: uuid.create(), userId: instructorId } });
    const tenant = await prisma.client.tenant.create({
      data: {
        id: uuid.create(),
        name: `Lifecycle Tenant ${suffix}`,
        slug: `lifecycle-test-${suffix}`,
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
    return { instructorId, tenantId: tenant.id, token: await issueAccessToken(instructorId, PlatformRole.INSTRUCTOR) };
  }

  async function createStudent(prefix: string): Promise<string> {
    const id = await createUser(prefix, PlatformRole.STUDENT);
    await prisma.client.studentProfile.create({ data: { id: uuid.create(), userId: id } });
    return id;
  }

  async function createTenantStudent(tenantId: string, studentUserId: string): Promise<void> {
    await prisma.client.tenantStudent.create({
      data: { id: uuid.create(), tenantId, studentUserId, status: TenantStudentStatus.ACTIVE },
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
        approvedAt: NOW,
        activatedAt: NOW,
      },
    });
  }

  async function createCourse(tenantId: string, createdByUserId: string, status: CourseStatus): Promise<string> {
    const id = uuid.create();
    await prisma.client.course.create({ data: { id, tenantId, createdByUserId, title: `Course ${id}`, status } });
    return id;
  }

  async function createSection(
    tenantId: string,
    courseId: string,
    status: SectionStatus,
    position = 1,
  ): Promise<string> {
    const id = uuid.create();
    await prisma.client.courseSection.create({ data: { id, tenantId, courseId, title: `Section ${id}`, position, status } });
    return id;
  }

  async function createVideoAsset(
    tenantId: string,
    uploadedByUserId: string,
    processingStatus: AssetProcessingStatus,
  ): Promise<string> {
    const id = uuid.create();
    await prisma.client.videoAsset.create({
      data: { id, tenantId, uploadedByUserId, externalAssetRef: `test-provider/video/${id}`, processingStatus },
    });
    return id;
  }

  async function createDocumentAsset(
    tenantId: string,
    uploadedByUserId: string,
    processingStatus: AssetProcessingStatus,
  ): Promise<string> {
    const id = uuid.create();
    await prisma.client.documentAsset.create({
      data: {
        id,
        tenantId,
        uploadedByUserId,
        externalAssetRef: `test-provider/document/${id}`,
        fileName: 'lecture-notes.pdf',
        mimeType: 'application/pdf',
        fileSizeBytes: BigInt(1024),
        processingStatus,
      },
    });
    return id;
  }

  async function createVideoLesson(
    tenantId: string,
    courseId: string,
    sectionId: string,
    status: LessonStatus,
    videoAssetId: string,
    position = 1,
  ): Promise<string> {
    return createLessonWithDetail(tenantId, courseId, sectionId, status, LessonType.VIDEO, position, { videoAssetId });
  }

  async function createDocumentLesson(
    tenantId: string,
    courseId: string,
    sectionId: string,
    status: LessonStatus,
    documentAssetId: string,
    position = 1,
  ): Promise<string> {
    return createLessonWithDetail(tenantId, courseId, sectionId, status, LessonType.DOCUMENT, position, { documentAssetId });
  }

  async function createQuizLesson(
    tenantId: string,
    courseId: string,
    sectionId: string,
    status: LessonStatus,
    quizId: string,
    position = 1,
  ): Promise<string> {
    return createLessonWithDetail(tenantId, courseId, sectionId, status, LessonType.QUIZ, position, { quizId });
  }

  async function createLessonWithDetail(
    tenantId: string,
    courseId: string,
    sectionId: string,
    status: LessonStatus,
    type: LessonType,
    position: number,
    reference: { videoAssetId?: string; documentAssetId?: string; quizId?: string },
  ): Promise<string> {
    const id = uuid.create();
    await prisma.client.lesson.create({
      data: { id, tenantId, courseId, sectionId, title: `Lesson ${id}`, position, type, status },
    });
    if (type === LessonType.VIDEO) {
      await prisma.client.videoLesson.create({ data: { lessonId: id, tenantId, videoAssetId: reference.videoAssetId as string } });
    } else if (type === LessonType.DOCUMENT) {
      await prisma.client.documentLesson.create({
        data: { lessonId: id, tenantId, documentAssetId: reference.documentAssetId as string },
      });
    } else {
      await prisma.client.quizLesson.create({ data: { lessonId: id, tenantId, quizId: reference.quizId as string } });
    }
    return id;
  }

  async function createQuiz(tenantId: string, status: QuizStatus): Promise<string> {
    const id = uuid.create();
    await prisma.client.quiz.create({ data: { id, tenantId, title: `Quiz ${id}`, status } });
    return id;
  }

  async function createValidQuiz(tenantId: string, status: QuizStatus = QuizStatus.DRAFT): Promise<string> {
    const quizId = await createQuiz(tenantId, status);
    const questionId = await createQuestion(tenantId, quizId, QuestionType.TRUE_FALSE, QuestionStatus.ACTIVE);
    await createOption(tenantId, questionId, true, 1);
    await createOption(tenantId, questionId, false, 2);
    return quizId;
  }

  async function createQuestion(
    tenantId: string,
    quizId: string,
    type: QuestionType,
    status: QuestionStatus,
  ): Promise<string> {
    const id = uuid.create();
    const position = (await prisma.client.question.count({ where: { quizId } })) + 1;
    await prisma.client.question.create({
      data: { id, tenantId, quizId, type, prompt: `Question ${id}`, position, points: 1, status },
    });
    return id;
  }

  async function createOption(
    tenantId: string,
    questionId: string,
    isCorrect: boolean,
    position: number,
  ): Promise<string> {
    const id = uuid.create();
    await prisma.client.questionOption.create({
      data: { id, tenantId, questionId, text: `Option ${id}`, position, isCorrect },
    });
    return id;
  }

  async function createEnrollment(
    tenantId: string,
    studentUserId: string,
    courseId: string,
    grantedByUserId: string,
  ): Promise<void> {
    await prisma.client.enrollment.create({
      data: {
        id: uuid.create(),
        tenantId,
        studentUserId,
        courseId,
        grantedByUserId,
        status: EnrollmentStatus.ACTIVE,
      },
    });
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
