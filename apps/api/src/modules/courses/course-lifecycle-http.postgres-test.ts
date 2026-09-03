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

  it('supports Course PUBLISHED->DRAFT take-offline without cascading, preserves publishedAt, rejects ARCHIVED, and republishes', async () => {
    const { token, tenantId, instructorId } = await createInstructorTenant('course-unpublish');
    const courseId = await createCourse(tenantId, instructorId, CourseStatus.DRAFT);
    const sectionId = await createSection(tenantId, courseId, SectionStatus.PUBLISHED);
    const quizId = await createValidQuiz(tenantId, QuizStatus.PUBLISHED);
    const lessonId = await createQuizLesson(tenantId, courseId, sectionId, LessonStatus.PUBLISHED, quizId);

    await request(server)
      .post(`/instructor/tenants/${tenantId}/courses/${courseId}/publish`)
      .set('Authorization', `Bearer ${token}`)
      .expect(HttpStatus.OK);

    const publishedAt = (await prisma.client.course.findUniqueOrThrow({ where: { id: courseId } })).publishedAt;
    expect(publishedAt).toEqual(NOW);

    await request(server)
      .post(`/instructor/tenants/${tenantId}/courses/${courseId}/unpublish`)
      .set('Authorization', `Bearer ${token}`)
      .expect(HttpStatus.OK)
      .expect(({ body }) => expect(body).toMatchObject({ courseId, status: CourseStatus.DRAFT }));

    await expect(prisma.client.course.findUniqueOrThrow({ where: { id: courseId } })).resolves.toMatchObject({
      status: CourseStatus.DRAFT,
      publishedAt,
    });
    await expect(prisma.client.courseSection.findUniqueOrThrow({ where: { id: sectionId } })).resolves.toMatchObject({
      status: SectionStatus.PUBLISHED,
    });
    await expect(prisma.client.lesson.findUniqueOrThrow({ where: { id: lessonId } })).resolves.toMatchObject({
      status: LessonStatus.PUBLISHED,
    });
    await expect(prisma.client.quiz.findUniqueOrThrow({ where: { id: quizId } })).resolves.toMatchObject({
      status: QuizStatus.PUBLISHED,
    });

    await request(server)
      .post(`/instructor/tenants/${tenantId}/courses/${courseId}/unpublish`)
      .set('Authorization', `Bearer ${token}`)
      .expect(HttpStatus.OK)
      .expect(({ body }) => expect(body).toMatchObject({ status: CourseStatus.DRAFT }));

    await request(server)
      .post(`/instructor/tenants/${tenantId}/courses/${courseId}/publish`)
      .set('Authorization', `Bearer ${token}`)
      .expect(HttpStatus.OK)
      .expect(({ body }) => expect(body).toMatchObject({ status: CourseStatus.PUBLISHED }));
    await expect(prisma.client.course.findUniqueOrThrow({ where: { id: courseId } })).resolves.toMatchObject({
      status: CourseStatus.PUBLISHED,
      publishedAt,
    });

    await request(server)
      .post(`/instructor/tenants/${tenantId}/courses/${courseId}/archive`)
      .set('Authorization', `Bearer ${token}`)
      .expect(HttpStatus.OK);
    await request(server)
      .post(`/instructor/tenants/${tenantId}/courses/${courseId}/unpublish`)
      .set('Authorization', `Bearer ${token}`)
      .expect(HttpStatus.CONFLICT)
      .expect(({ body }) =>
        expect(body).toMatchObject({ error: { code: 'INVALID_COURSE_LIFECYCLE_TRANSITION' } }),
      );
    await expect(prisma.client.course.findUniqueOrThrow({ where: { id: courseId } })).resolves.toMatchObject({
      status: CourseStatus.ARCHIVED,
    });
  });

  it('rejects ordinary metadata edits once Course/Section/Lesson/Quiz is ARCHIVED, while DRAFT and PUBLISHED edits remain allowed (DEC-0048)', async () => {
    const { token, tenantId, instructorId } = await createInstructorTenant('archived-immutability');

    // Course: DRAFT edit succeeds, PUBLISHED edit succeeds, ARCHIVED edit is rejected and the
    // last successfully-written value is preserved untouched.
    const courseId = await createCourse(tenantId, instructorId, CourseStatus.DRAFT);
    await request(server)
      .patch(`/instructor/tenants/${tenantId}/courses/${courseId}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ title: 'Draft course edit' })
      .expect(HttpStatus.OK)
      .expect(({ body }) => expect(body).toMatchObject({ title: 'Draft course edit' }));

    await request(server)
      .post(`/instructor/tenants/${tenantId}/courses/${courseId}/publish`)
      .set('Authorization', `Bearer ${token}`)
      .expect(HttpStatus.OK);

    await request(server)
      .patch(`/instructor/tenants/${tenantId}/courses/${courseId}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ title: 'Published course edit' })
      .expect(HttpStatus.OK)
      .expect(({ body }) => expect(body).toMatchObject({ title: 'Published course edit' }));

    await request(server)
      .post(`/instructor/tenants/${tenantId}/courses/${courseId}/archive`)
      .set('Authorization', `Bearer ${token}`)
      .expect(HttpStatus.OK);

    await request(server)
      .patch(`/instructor/tenants/${tenantId}/courses/${courseId}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ title: 'Archived course edit attempt' })
      .expect(HttpStatus.CONFLICT)
      .expect(({ body }) => expect(body).toMatchObject({ error: { code: 'INVALID_COURSE_LIFECYCLE_TRANSITION' } }));

    await expect(prisma.client.course.findUniqueOrThrow({ where: { id: courseId } })).resolves.toMatchObject({
      title: 'Published course edit',
      status: CourseStatus.ARCHIVED,
    });

    // Section: identical DRAFT -> PUBLISHED -> ARCHIVED progression through the real endpoints.
    const sectionCourseId = await createCourse(tenantId, instructorId, CourseStatus.DRAFT);
    const sectionId = await createSection(tenantId, sectionCourseId, SectionStatus.DRAFT);

    await request(server)
      .patch(`/instructor/tenants/${tenantId}/courses/${sectionCourseId}/sections/${sectionId}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ title: 'Draft section edit' })
      .expect(HttpStatus.OK);

    await request(server)
      .post(`/instructor/tenants/${tenantId}/courses/${sectionCourseId}/sections/${sectionId}/publish`)
      .set('Authorization', `Bearer ${token}`)
      .expect(HttpStatus.OK);

    await request(server)
      .patch(`/instructor/tenants/${tenantId}/courses/${sectionCourseId}/sections/${sectionId}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ title: 'Published section edit' })
      .expect(HttpStatus.OK);

    await request(server)
      .post(`/instructor/tenants/${tenantId}/courses/${sectionCourseId}/sections/${sectionId}/archive`)
      .set('Authorization', `Bearer ${token}`)
      .expect(HttpStatus.OK);

    await request(server)
      .patch(`/instructor/tenants/${tenantId}/courses/${sectionCourseId}/sections/${sectionId}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ title: 'Archived section edit attempt' })
      .expect(HttpStatus.CONFLICT)
      .expect(({ body }) => expect(body).toMatchObject({ error: { code: 'INVALID_SECTION_LIFECYCLE_TRANSITION' } }));

    await expect(prisma.client.courseSection.findUniqueOrThrow({ where: { id: sectionId } })).resolves.toMatchObject({
      title: 'Published section edit',
      status: SectionStatus.ARCHIVED,
    });

    // Lesson: a real PUBLISHED Quiz-backed lesson so the publish step goes through actual
    // content-readiness validation, unaffected by this change.
    const lessonCourseId = await createCourse(tenantId, instructorId, CourseStatus.DRAFT);
    const lessonSectionId = await createSection(tenantId, lessonCourseId, SectionStatus.DRAFT);
    const lessonQuizId = await createValidQuiz(tenantId, QuizStatus.PUBLISHED);
    const lessonId = await createQuizLesson(tenantId, lessonCourseId, lessonSectionId, LessonStatus.DRAFT, lessonQuizId);

    await request(server)
      .patch(`/instructor/tenants/${tenantId}/courses/${lessonCourseId}/sections/${lessonSectionId}/lessons/${lessonId}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ title: 'Draft lesson edit' })
      .expect(HttpStatus.OK);

    await request(server)
      .post(`/instructor/tenants/${tenantId}/courses/${lessonCourseId}/sections/${lessonSectionId}/lessons/${lessonId}/publish`)
      .set('Authorization', `Bearer ${token}`)
      .expect(HttpStatus.OK);

    await request(server)
      .patch(`/instructor/tenants/${tenantId}/courses/${lessonCourseId}/sections/${lessonSectionId}/lessons/${lessonId}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ title: 'Published lesson edit' })
      .expect(HttpStatus.OK);

    await request(server)
      .post(`/instructor/tenants/${tenantId}/courses/${lessonCourseId}/sections/${lessonSectionId}/lessons/${lessonId}/archive`)
      .set('Authorization', `Bearer ${token}`)
      .expect(HttpStatus.OK);

    await request(server)
      .patch(`/instructor/tenants/${tenantId}/courses/${lessonCourseId}/sections/${lessonSectionId}/lessons/${lessonId}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ title: 'Archived lesson edit attempt' })
      .expect(HttpStatus.CONFLICT)
      .expect(({ body }) => expect(body).toMatchObject({ error: { code: 'INVALID_LESSON_LIFECYCLE_TRANSITION' } }));

    await expect(prisma.client.lesson.findUniqueOrThrow({ where: { id: lessonId } })).resolves.toMatchObject({
      title: 'Published lesson edit',
      status: LessonStatus.ARCHIVED,
    });

    // Quiz: PUBLISHED metadata update must still work (title/attemptLimit are not
    // publishability-affecting fields, so the existing aggregate rule is untouched), then
    // ARCHIVED must reject.
    const quizId = await createValidQuiz(tenantId, QuizStatus.DRAFT);
    await request(server)
      .patch(`/instructor/tenants/${tenantId}/quizzes/${quizId}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ title: 'Draft quiz edit' })
      .expect(HttpStatus.OK);

    await request(server)
      .post(`/instructor/tenants/${tenantId}/quizzes/${quizId}/publish`)
      .set('Authorization', `Bearer ${token}`)
      .expect(HttpStatus.OK);

    await request(server)
      .patch(`/instructor/tenants/${tenantId}/quizzes/${quizId}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ title: 'Published quiz edit', attemptLimit: 3 })
      .expect(HttpStatus.OK)
      .expect(({ body }) =>
        expect(body).toMatchObject({ title: 'Published quiz edit', attemptLimit: 3, status: QuizStatus.PUBLISHED }),
      );

    await request(server)
      .post(`/instructor/tenants/${tenantId}/quizzes/${quizId}/archive`)
      .set('Authorization', `Bearer ${token}`)
      .expect(HttpStatus.OK);

    await request(server)
      .patch(`/instructor/tenants/${tenantId}/quizzes/${quizId}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ title: 'Archived quiz edit attempt' })
      .expect(HttpStatus.CONFLICT)
      .expect(({ body }) => expect(body).toMatchObject({ error: { code: 'INVALID_QUIZ_LIFECYCLE_TRANSITION' } }));

    await expect(prisma.client.quiz.findUniqueOrThrow({ where: { id: quizId } })).resolves.toMatchObject({
      title: 'Published quiz edit',
      attemptLimit: 3,
      status: QuizStatus.ARCHIVED,
    });
  });

  it('an archive/metadata-edit race can never leave an ARCHIVED Course or Quiz with a metadata mutation silently applied after archival', async () => {
    const { token, tenantId, instructorId } = await createInstructorTenant('archive-edit-race');

    const courseId = await createCourse(tenantId, instructorId, CourseStatus.PUBLISHED);
    const racedCourse = await Promise.all([
      request(server)
        .patch(`/instructor/tenants/${tenantId}/courses/${courseId}`)
        .set('Authorization', `Bearer ${token}`)
        .send({ title: 'Raced course edit' }),
      request(server).post(`/instructor/tenants/${tenantId}/courses/${courseId}/archive`).set('Authorization', `Bearer ${token}`),
    ]);
    const [courseEditResponse, courseArchiveResponse] = racedCourse;
    expect(courseArchiveResponse.status).toBe(HttpStatus.OK);
    expect([HttpStatus.OK, HttpStatus.CONFLICT]).toContain(courseEditResponse.status);

    const finalCourse = await prisma.client.course.findUniqueOrThrow({ where: { id: courseId } });
    expect(finalCourse.status).toBe(CourseStatus.ARCHIVED);
    // The reported HTTP outcome and the persisted row must never disagree: a 409 can never
    // coexist with the edit having actually landed, and a 200 can never coexist with the old title.
    const courseEditSucceeded = [HttpStatus.OK].includes(courseEditResponse.status);
    if (courseEditSucceeded) {
      expect(finalCourse.title).toBe('Raced course edit');
    } else {
      expect(finalCourse.title).not.toBe('Raced course edit');
    }

    const quizId = await createValidQuiz(tenantId, QuizStatus.PUBLISHED);
    const racedQuiz = await Promise.all([
      request(server)
        .patch(`/instructor/tenants/${tenantId}/quizzes/${quizId}`)
        .set('Authorization', `Bearer ${token}`)
        .send({ title: 'Raced quiz edit' }),
      request(server).post(`/instructor/tenants/${tenantId}/quizzes/${quizId}/archive`).set('Authorization', `Bearer ${token}`),
    ]);
    const [quizEditResponse, quizArchiveResponse] = racedQuiz;
    expect(quizArchiveResponse.status).toBe(HttpStatus.OK);
    expect([HttpStatus.OK, HttpStatus.CONFLICT]).toContain(quizEditResponse.status);

    const finalQuiz = await prisma.client.quiz.findUniqueOrThrow({ where: { id: quizId } });
    expect(finalQuiz.status).toBe(QuizStatus.ARCHIVED);
    const quizEditSucceeded = [HttpStatus.OK].includes(quizEditResponse.status);
    if (quizEditSucceeded) {
      expect(finalQuiz.title).toBe('Raced quiz edit');
    } else {
      expect(finalQuiz.title).not.toBe('Raced quiz edit');
    }
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
    const lessonId = await createQuizLesson(tenantId, courseId, sectionId, LessonStatus.DRAFT, quizId);
    const otherLessonId = await createQuizLesson(otherTenantId, otherCourseId, otherSectionId, LessonStatus.DRAFT, otherQuizId);

    await request(server)
      .post(`/instructor/tenants/${tenantId}/courses/${courseId}/publish`)
      .set('Authorization', `Bearer ${otherToken}`)
      .expect(HttpStatus.FORBIDDEN);

    await request(server)
      .post(`/instructor/tenants/${tenantId}/courses/${courseId}/unpublish`)
      .set('Authorization', `Bearer ${otherToken}`)
      .expect(HttpStatus.FORBIDDEN);

    await request(server)
      .post(`/instructor/tenants/${tenantId}/courses/${courseId}/restore`)
      .set('Authorization', `Bearer ${otherToken}`)
      .expect(HttpStatus.FORBIDDEN);

    await request(server)
      .post(`/instructor/tenants/${tenantId}/courses/${otherCourseId}/publish`)
      .set('Authorization', `Bearer ${token}`)
      .expect(HttpStatus.NOT_FOUND);

    await request(server)
      .post(`/instructor/tenants/${tenantId}/courses/${otherCourseId}/unpublish`)
      .set('Authorization', `Bearer ${token}`)
      .expect(HttpStatus.NOT_FOUND);

    await request(server)
      .post(`/instructor/tenants/${tenantId}/courses/${otherCourseId}/restore`)
      .set('Authorization', `Bearer ${token}`)
      .expect(HttpStatus.NOT_FOUND);

    await request(server)
      .post(`/instructor/tenants/${tenantId}/courses/${courseId}/sections/${otherSectionId}/publish`)
      .set('Authorization', `Bearer ${token}`)
      .expect(HttpStatus.NOT_FOUND);

    await request(server)
      .post(`/instructor/tenants/${tenantId}/courses/${courseId}/sections/${otherSectionId}/unpublish`)
      .set('Authorization', `Bearer ${token}`)
      .expect(HttpStatus.NOT_FOUND);

    await request(server)
      .post(`/instructor/tenants/${tenantId}/courses/${courseId}/sections/${otherSectionId}/restore`)
      .set('Authorization', `Bearer ${token}`)
      .expect(HttpStatus.NOT_FOUND);

    await request(server)
      .post(
        `/instructor/tenants/${tenantId}/courses/${courseId}/sections/${sectionId}/lessons/${otherLessonId}/publish`,
      )
      .set('Authorization', `Bearer ${token}`)
      .expect(HttpStatus.NOT_FOUND);

    await request(server)
      .post(
        `/instructor/tenants/${tenantId}/courses/${courseId}/sections/${sectionId}/lessons/${otherLessonId}/unpublish`,
      )
      .set('Authorization', `Bearer ${token}`)
      .expect(HttpStatus.NOT_FOUND);

    await request(server)
      .post(
        `/instructor/tenants/${tenantId}/courses/${courseId}/sections/${sectionId}/lessons/${otherLessonId}/restore`,
      )
      .set('Authorization', `Bearer ${token}`)
      .expect(HttpStatus.NOT_FOUND);

    await request(server)
      .post(`/instructor/tenants/${tenantId}/quizzes/${otherQuizId}/publish`)
      .set('Authorization', `Bearer ${token}`)
      .expect(HttpStatus.NOT_FOUND);

    await request(server)
      .post(`/instructor/tenants/${tenantId}/quizzes/${otherQuizId}/unpublish`)
      .set('Authorization', `Bearer ${token}`)
      .expect(HttpStatus.NOT_FOUND);

    await request(server)
      .post(`/instructor/tenants/${tenantId}/quizzes/${otherQuizId}/restore`)
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
    await request(server)
      .post(`/instructor/tenants/${tenantId}/courses/${randomId}/unpublish`)
      .set('Authorization', `Bearer ${token}`)
      .expect(HttpStatus.NOT_FOUND);
    await request(server)
      .post(`/instructor/tenants/${tenantId}/quizzes/${randomId}/unpublish`)
      .set('Authorization', `Bearer ${token}`)
      .expect(HttpStatus.NOT_FOUND);
    await request(server)
      .post(`/instructor/tenants/${tenantId}/courses/${randomId}/restore`)
      .set('Authorization', `Bearer ${token}`)
      .expect(HttpStatus.NOT_FOUND);
    await request(server)
      .post(`/instructor/tenants/${tenantId}/quizzes/${randomId}/restore`)
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
    await expect(prisma.client.lesson.findUniqueOrThrow({ where: { id: lessonId } })).resolves.toMatchObject({
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

  it('supports Section PUBLISHED->DRAFT take-offline without cascading, preserves position, rejects ARCHIVED, and republishes', async () => {
    const { token, tenantId, instructorId } = await createInstructorTenant('section-unpublish');
    const courseId = await createCourse(tenantId, instructorId, CourseStatus.DRAFT);
    const sectionId = await createSection(tenantId, courseId, SectionStatus.DRAFT, 7);
    const lessonId = await createQuizLesson(tenantId, courseId, sectionId, LessonStatus.PUBLISHED, await createValidQuiz(tenantId));

    await request(server)
      .post(`/instructor/tenants/${tenantId}/courses/${courseId}/sections/${sectionId}/publish`)
      .set('Authorization', `Bearer ${token}`)
      .expect(HttpStatus.OK);

    await request(server)
      .post(`/instructor/tenants/${tenantId}/courses/${courseId}/sections/${sectionId}/unpublish`)
      .set('Authorization', `Bearer ${token}`)
      .expect(HttpStatus.OK)
      .expect(({ body }) => expect(body).toMatchObject({ sectionId, status: SectionStatus.DRAFT, position: 7 }));

    await expect(prisma.client.courseSection.findUniqueOrThrow({ where: { id: sectionId } })).resolves.toMatchObject({
      status: SectionStatus.DRAFT,
      position: 7,
    });
    await expect(prisma.client.lesson.findUniqueOrThrow({ where: { id: lessonId } })).resolves.toMatchObject({
      status: LessonStatus.PUBLISHED,
    });

    await request(server)
      .post(`/instructor/tenants/${tenantId}/courses/${courseId}/sections/${sectionId}/publish`)
      .set('Authorization', `Bearer ${token}`)
      .expect(HttpStatus.OK)
      .expect(({ body }) => expect(body).toMatchObject({ status: SectionStatus.PUBLISHED, position: 7 }));

    await request(server)
      .post(`/instructor/tenants/${tenantId}/courses/${courseId}/sections/${sectionId}/archive`)
      .set('Authorization', `Bearer ${token}`)
      .expect(HttpStatus.OK);
    await request(server)
      .post(`/instructor/tenants/${tenantId}/courses/${courseId}/sections/${sectionId}/unpublish`)
      .set('Authorization', `Bearer ${token}`)
      .expect(HttpStatus.CONFLICT)
      .expect(({ body }) =>
        expect(body).toMatchObject({ error: { code: 'INVALID_SECTION_LIFECYCLE_TRANSITION' } }),
      );
    await expect(prisma.client.courseSection.findUniqueOrThrow({ where: { id: sectionId } })).resolves.toMatchObject({
      status: SectionStatus.ARCHIVED,
      position: 7,
    });
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

  it('supports Lesson PUBLISHED->DRAFT take-offline while preserving content, progress, availability, linked Quiz, and republish behavior', async () => {
    const { token, tenantId, instructorId } = await createInstructorTenant('lesson-unpublish');
    const studentId = await createStudent('lesson-unpublish-student');
    await createTenantStudent(tenantId, studentId);
    const courseId = await createCourse(tenantId, instructorId, CourseStatus.PUBLISHED);
    const sectionId = await createSection(tenantId, courseId, SectionStatus.PUBLISHED);
    const quizId = await createValidQuiz(tenantId, QuizStatus.PUBLISHED);
    const availableFrom = new Date('2026-06-01T00:00:00.000Z');
    const availableUntil = new Date('2026-07-01T00:00:00.000Z');
    const lessonId = await createQuizLesson(tenantId, courseId, sectionId, LessonStatus.PUBLISHED, quizId);
    await prisma.client.lesson.update({
      where: { id: lessonId },
      data: { availableFrom, availableUntil },
    });
    const enrollmentId = await createEnrollment(tenantId, studentId, courseId, instructorId);
    const progressId = await createLessonProgress(tenantId, courseId, lessonId, studentId, enrollmentId);
    const progressBefore = await prisma.client.lessonProgress.findUniqueOrThrow({ where: { id: progressId } });
    const linkedQuizBefore = await prisma.client.quizLesson.findUniqueOrThrow({ where: { lessonId } });

    await request(server)
      .post(`/instructor/tenants/${tenantId}/courses/${courseId}/sections/${sectionId}/lessons/${lessonId}/unpublish`)
      .set('Authorization', `Bearer ${token}`)
      .expect(HttpStatus.OK)
      .expect(({ body }) =>
        expect(body).toMatchObject({
          lessonId,
          status: LessonStatus.DRAFT,
          quizId,
          availableFrom: availableFrom.toISOString(),
          availableUntil: availableUntil.toISOString(),
        }),
      );

    await expect(prisma.client.lesson.findUniqueOrThrow({ where: { id: lessonId } })).resolves.toMatchObject({
      status: LessonStatus.DRAFT,
      availableFrom,
      availableUntil,
    });
    await expect(prisma.client.quizLesson.findUniqueOrThrow({ where: { lessonId } })).resolves.toEqual(linkedQuizBefore);
    await expect(prisma.client.lessonProgress.findUniqueOrThrow({ where: { id: progressId } })).resolves.toEqual(progressBefore);
    await expect(prisma.client.quiz.findUniqueOrThrow({ where: { id: quizId } })).resolves.toMatchObject({
      status: QuizStatus.PUBLISHED,
    });

    await request(server)
      .post(`/instructor/tenants/${tenantId}/courses/${courseId}/sections/${sectionId}/lessons/${lessonId}/publish`)
      .set('Authorization', `Bearer ${token}`)
      .expect(HttpStatus.OK)
      .expect(({ body }) => expect(body).toMatchObject({ status: LessonStatus.PUBLISHED, quizId }));

    await request(server)
      .post(`/instructor/tenants/${tenantId}/courses/${courseId}/sections/${sectionId}/lessons/${lessonId}/archive`)
      .set('Authorization', `Bearer ${token}`)
      .expect(HttpStatus.OK);
    await request(server)
      .post(`/instructor/tenants/${tenantId}/courses/${courseId}/sections/${sectionId}/lessons/${lessonId}/unpublish`)
      .set('Authorization', `Bearer ${token}`)
      .expect(HttpStatus.CONFLICT)
      .expect(({ body }) =>
        expect(body).toMatchObject({ error: { code: 'INVALID_LESSON_LIFECYCLE_TRANSITION' } }),
      );
    await expect(prisma.client.lesson.findUniqueOrThrow({ where: { id: lessonId } })).resolves.toMatchObject({
      status: LessonStatus.ARCHIVED,
      availableFrom,
      availableUntil,
    });
  });

  it('validates Quiz aggregate state before publishing and rejects direct ARCHIVED publish', async () => {
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

  it('supports Quiz PUBLISHED->DRAFT take-offline while preserving publishedAt, questions, options, attempts, and answers', async () => {
    const { token, tenantId, instructorId } = await createInstructorTenant('quiz-unpublish');
    const studentId = await createStudent('quiz-unpublish-student');
    await createTenantStudent(tenantId, studentId);
    const courseId = await createCourse(tenantId, instructorId, CourseStatus.PUBLISHED);
    const sectionId = await createSection(tenantId, courseId, SectionStatus.PUBLISHED);
    const quizId = await createValidQuiz(tenantId, QuizStatus.DRAFT);
    const lessonId = await createQuizLesson(tenantId, courseId, sectionId, LessonStatus.PUBLISHED, quizId);
    const enrollmentId = await createEnrollment(tenantId, studentId, courseId, instructorId);

    await request(server)
      .post(`/instructor/tenants/${tenantId}/quizzes/${quizId}/publish`)
      .set('Authorization', `Bearer ${token}`)
      .expect(HttpStatus.OK);

    const publishedAt = (await prisma.client.quiz.findUniqueOrThrow({ where: { id: quizId } })).publishedAt;
    expect(publishedAt).toEqual(NOW);
    const questionsBefore = await prisma.client.question.findMany({ where: { quizId }, orderBy: { position: 'asc' } });
    const optionsBefore = await prisma.client.questionOption.findMany({
      where: { questionId: { in: questionsBefore.map((question) => question.id) } },
      orderBy: [{ questionId: 'asc' }, { position: 'asc' }],
    });
    const attemptId = await createQuizAttempt(tenantId, quizId, lessonId, studentId, enrollmentId);
    const answerId = await createQuizAttemptAnswer(attemptId, questionsBefore[0].id, optionsBefore[0].id);
    const attemptBefore = await prisma.client.quizAttempt.findUniqueOrThrow({ where: { id: attemptId } });
    const answerBefore = await prisma.client.quizAttemptAnswer.findUniqueOrThrow({ where: { id: answerId } });

    await request(server)
      .post(`/instructor/tenants/${tenantId}/quizzes/${quizId}/unpublish`)
      .set('Authorization', `Bearer ${token}`)
      .expect(HttpStatus.OK)
      .expect(({ body }) => expect(body).toMatchObject({ quizId, status: QuizStatus.DRAFT }));

    await expect(prisma.client.quiz.findUniqueOrThrow({ where: { id: quizId } })).resolves.toMatchObject({
      status: QuizStatus.DRAFT,
      publishedAt,
    });
    await expect(prisma.client.question.findMany({ where: { quizId }, orderBy: { position: 'asc' } })).resolves.toEqual(
      questionsBefore,
    );
    await expect(
      prisma.client.questionOption.findMany({
        where: { questionId: { in: questionsBefore.map((question) => question.id) } },
        orderBy: [{ questionId: 'asc' }, { position: 'asc' }],
      }),
    ).resolves.toEqual(optionsBefore);
    await expect(prisma.client.quizAttempt.findUniqueOrThrow({ where: { id: attemptId } })).resolves.toEqual(attemptBefore);
    await expect(prisma.client.quizAttemptAnswer.findUniqueOrThrow({ where: { id: answerId } })).resolves.toEqual(answerBefore);

    await request(server)
      .patch(`/instructor/tenants/${tenantId}/quizzes/${quizId}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ title: 'Edited after take offline' })
      .expect(HttpStatus.OK)
      .expect(({ body }) => expect(body).toMatchObject({ status: QuizStatus.DRAFT, title: 'Edited after take offline' }));

    await request(server)
      .post(`/instructor/tenants/${tenantId}/quizzes/${quizId}/publish`)
      .set('Authorization', `Bearer ${token}`)
      .expect(HttpStatus.OK)
      .expect(({ body }) => expect(body).toMatchObject({ status: QuizStatus.PUBLISHED, publishedAt: publishedAt?.toISOString() }));

    await request(server)
      .post(`/instructor/tenants/${tenantId}/quizzes/${quizId}/archive`)
      .set('Authorization', `Bearer ${token}`)
      .expect(HttpStatus.OK);
    await request(server)
      .post(`/instructor/tenants/${tenantId}/quizzes/${quizId}/unpublish`)
      .set('Authorization', `Bearer ${token}`)
      .expect(HttpStatus.CONFLICT)
      .expect(({ body }) =>
        expect(body).toMatchObject({ error: { code: 'INVALID_QUIZ_LIFECYCLE_TRANSITION' } }),
      );
    await expect(prisma.client.quiz.findUniqueOrThrow({ where: { id: quizId } })).resolves.toMatchObject({
      status: QuizStatus.ARCHIVED,
      publishedAt,
    });
  });

  it('serializes Quiz unpublish with publishability-affecting mutations under the publication-boundary lock', async () => {
    const { token, tenantId } = await createInstructorTenant('quiz-unpublish-race');

    for (let attempt = 0; attempt < 5; attempt += 1) {
      const quizId = await createQuiz(tenantId, QuizStatus.DRAFT);
      const questionId = await createQuestion(tenantId, quizId, QuestionType.MULTIPLE_CHOICE, QuestionStatus.ACTIVE);
      const correctOption = await createOption(tenantId, questionId, true, 1);
      await createOption(tenantId, questionId, false, 2);
      await request(server)
        .post(`/instructor/tenants/${tenantId}/quizzes/${quizId}/publish`)
        .set('Authorization', `Bearer ${token}`)
        .expect(HttpStatus.OK);

      const [unpublishResponse, updateResponse] = await Promise.all([
        request(server).post(`/instructor/tenants/${tenantId}/quizzes/${quizId}/unpublish`).set('Authorization', `Bearer ${token}`),
        request(server)
          .patch(`/instructor/tenants/${tenantId}/quizzes/${quizId}/questions/${questionId}/options/${correctOption}`)
          .set('Authorization', `Bearer ${token}`)
          .send({ isCorrect: false }),
      ]);

      const updateStatus: number = updateResponse.status;
      expect(unpublishResponse.status).toBe(HttpStatus.OK);
      expect([HttpStatus.OK, HttpStatus.CONFLICT]).toContain(updateStatus);

      const quiz = await prisma.client.quiz.findUniqueOrThrow({ where: { id: quizId } });
      const options = await prisma.client.questionOption.findMany({ where: { questionId } });
      expect(quiz.status).toBe(QuizStatus.DRAFT);
      if (updateStatus === 200) {
        expect(options.filter((option) => option.isCorrect)).toHaveLength(0);
      } else {
        expect(updateResponse.body).toMatchObject({ error: { code: 'QUIZ_NOT_PUBLISHABLE' } });
        expect(options.filter((option) => option.isCorrect)).toHaveLength(1);
      }
    }
  });

  it('restores an ARCHIVED Course to DRAFT without cascading, preserves publishedAt/history, and publishes afterward', async () => {
    const { token, tenantId, instructorId } = await createInstructorTenant('course-restore');
    const studentId = await createStudent('course-restore-student');
    const installationId = installation();
    await createTenantStudent(tenantId, studentId);
    await createActiveDevice(studentId, installationId);
    const studentToken = await issueAccessToken(studentId, PlatformRole.STUDENT);

    const courseId = await createCourse(tenantId, instructorId, CourseStatus.DRAFT);
    const sectionId = await createSection(tenantId, courseId, SectionStatus.ARCHIVED, 3);
    const quizId = await createValidQuiz(tenantId, QuizStatus.ARCHIVED);
    const lessonId = await createQuizLesson(tenantId, courseId, sectionId, LessonStatus.PUBLISHED, quizId);
    const enrollmentId = await createEnrollment(tenantId, studentId, courseId, instructorId);
    const enrollmentBefore = await prisma.client.enrollment.findUniqueOrThrow({ where: { id: enrollmentId } });

    await request(server)
      .post(`/instructor/tenants/${tenantId}/courses/${courseId}/publish`)
      .set('Authorization', `Bearer ${token}`)
      .expect(HttpStatus.OK);
    const publishedAt = (await prisma.client.course.findUniqueOrThrow({ where: { id: courseId } })).publishedAt;

    await request(server)
      .post(`/instructor/tenants/${tenantId}/courses/${courseId}/archive`)
      .set('Authorization', `Bearer ${token}`)
      .expect(HttpStatus.OK);
    await request(server)
      .post(`/instructor/tenants/${tenantId}/courses/${courseId}/restore`)
      .set('Authorization', `Bearer ${token}`)
      .expect(HttpStatus.OK)
      .expect(({ body }) => expect(body).toMatchObject({ courseId, status: CourseStatus.DRAFT }));

    await expect(prisma.client.course.findUniqueOrThrow({ where: { id: courseId } })).resolves.toMatchObject({
      status: CourseStatus.DRAFT,
      publishedAt,
    });
    await expect(prisma.client.courseSection.findUniqueOrThrow({ where: { id: sectionId } })).resolves.toMatchObject({
      status: SectionStatus.ARCHIVED,
      position: 3,
    });
    await expect(prisma.client.lesson.findUniqueOrThrow({ where: { id: lessonId } })).resolves.toMatchObject({
      status: LessonStatus.PUBLISHED,
    });
    await expect(prisma.client.quiz.findUniqueOrThrow({ where: { id: quizId } })).resolves.toMatchObject({
      status: QuizStatus.ARCHIVED,
    });
    await expect(prisma.client.enrollment.findUniqueOrThrow({ where: { id: enrollmentId } })).resolves.toEqual(enrollmentBefore);

    await request(server)
      .get(`/student/courses/${courseId}`)
      .set('Authorization', `Bearer ${studentToken}`)
      .set(INSTALLATION_ID_HEADER, installationId)
      .expect(HttpStatus.NOT_FOUND);

    await request(server)
      .post(`/instructor/tenants/${tenantId}/courses/${courseId}/restore`)
      .set('Authorization', `Bearer ${token}`)
      .expect(HttpStatus.OK)
      .expect(({ body }) => expect(body).toMatchObject({ status: CourseStatus.DRAFT }));

    await request(server)
      .post(`/instructor/tenants/${tenantId}/courses/${courseId}/publish`)
      .set('Authorization', `Bearer ${token}`)
      .expect(HttpStatus.OK)
      .expect(({ body }) => expect(body).toMatchObject({ status: CourseStatus.PUBLISHED }));
    await request(server)
      .get(`/student/courses/${courseId}`)
      .set('Authorization', `Bearer ${studentToken}`)
      .set(INSTALLATION_ID_HEADER, installationId)
      .expect(HttpStatus.OK);

    await request(server)
      .post(`/instructor/tenants/${tenantId}/courses/${courseId}/restore`)
      .set('Authorization', `Bearer ${token}`)
      .expect(HttpStatus.CONFLICT)
      .expect(({ body }) =>
        expect(body).toMatchObject({ error: { code: 'INVALID_COURSE_LIFECYCLE_TRANSITION' } }),
      );
  });

  it('restores an ARCHIVED Section to DRAFT without lesson cascade, preserves position, and publishes afterward', async () => {
    const { token, tenantId, instructorId } = await createInstructorTenant('section-restore');
    const courseId = await createCourse(tenantId, instructorId, CourseStatus.PUBLISHED);
    const sectionId = await createSection(tenantId, courseId, SectionStatus.ARCHIVED, 7);
    const lessonId = await createQuizLesson(tenantId, courseId, sectionId, LessonStatus.ARCHIVED, await createValidQuiz(tenantId));

    await request(server)
      .post(`/instructor/tenants/${tenantId}/courses/${courseId}/sections/${sectionId}/restore`)
      .set('Authorization', `Bearer ${token}`)
      .expect(HttpStatus.OK)
      .expect(({ body }) => expect(body).toMatchObject({ sectionId, status: SectionStatus.DRAFT, position: 7 }));

    await expect(prisma.client.courseSection.findUniqueOrThrow({ where: { id: sectionId } })).resolves.toMatchObject({
      status: SectionStatus.DRAFT,
      position: 7,
    });
    await expect(prisma.client.lesson.findUniqueOrThrow({ where: { id: lessonId } })).resolves.toMatchObject({
      status: LessonStatus.ARCHIVED,
    });

    await request(server)
      .post(`/instructor/tenants/${tenantId}/courses/${courseId}/sections/${sectionId}/restore`)
      .set('Authorization', `Bearer ${token}`)
      .expect(HttpStatus.OK)
      .expect(({ body }) => expect(body).toMatchObject({ status: SectionStatus.DRAFT, position: 7 }));

    await request(server)
      .post(`/instructor/tenants/${tenantId}/courses/${courseId}/sections/${sectionId}/publish`)
      .set('Authorization', `Bearer ${token}`)
      .expect(HttpStatus.OK)
      .expect(({ body }) => expect(body).toMatchObject({ status: SectionStatus.PUBLISHED, position: 7 }));

    await request(server)
      .post(`/instructor/tenants/${tenantId}/courses/${courseId}/sections/${sectionId}/restore`)
      .set('Authorization', `Bearer ${token}`)
      .expect(HttpStatus.CONFLICT)
      .expect(({ body }) =>
        expect(body).toMatchObject({ error: { code: 'INVALID_SECTION_LIFECYCLE_TRANSITION' } }),
      );
  });

  it('restores an ARCHIVED Lesson to DRAFT without changing content, availability, progress, attempts, or linked Quiz', async () => {
    const { token, tenantId, instructorId } = await createInstructorTenant('lesson-restore');
    const studentId = await createStudent('lesson-restore-student');
    await createTenantStudent(tenantId, studentId);
    const courseId = await createCourse(tenantId, instructorId, CourseStatus.PUBLISHED);
    const sectionId = await createSection(tenantId, courseId, SectionStatus.PUBLISHED);
    const quizId = await createValidQuiz(tenantId, QuizStatus.ARCHIVED);
    const lessonId = await createQuizLesson(tenantId, courseId, sectionId, LessonStatus.ARCHIVED, quizId);
    const availableFrom = new Date('2026-06-01T00:00:00.000Z');
    const availableUntil = new Date('2026-07-01T00:00:00.000Z');
    await prisma.client.lesson.update({ where: { id: lessonId }, data: { availableFrom, availableUntil } });
    const enrollmentId = await createEnrollment(tenantId, studentId, courseId, instructorId);
    const progressId = await createLessonProgress(tenantId, courseId, lessonId, studentId, enrollmentId);
    const attemptId = await createQuizAttempt(tenantId, quizId, lessonId, studentId, enrollmentId);
    const questionId = (await prisma.client.question.findFirstOrThrow({ where: { quizId } })).id;
    const selectedOptionId = (await prisma.client.questionOption.findFirstOrThrow({ where: { questionId } })).id;
    const answerId = await createQuizAttemptAnswer(attemptId, questionId, selectedOptionId);
    const lessonBefore = await prisma.client.lesson.findUniqueOrThrow({ where: { id: lessonId } });
    const linkBefore = await prisma.client.quizLesson.findUniqueOrThrow({ where: { lessonId } });
    const progressBefore = await prisma.client.lessonProgress.findUniqueOrThrow({ where: { id: progressId } });
    const attemptBefore = await prisma.client.quizAttempt.findUniqueOrThrow({ where: { id: attemptId } });
    const answerBefore = await prisma.client.quizAttemptAnswer.findUniqueOrThrow({ where: { id: answerId } });

    await request(server)
      .post(`/instructor/tenants/${tenantId}/courses/${courseId}/sections/${sectionId}/lessons/${lessonId}/restore`)
      .set('Authorization', `Bearer ${token}`)
      .expect(HttpStatus.OK)
      .expect(({ body }) =>
        expect(body).toMatchObject({
          lessonId,
          status: LessonStatus.DRAFT,
          quizId,
          availableFrom: availableFrom.toISOString(),
          availableUntil: availableUntil.toISOString(),
        }),
      );

    await expect(prisma.client.lesson.findUniqueOrThrow({ where: { id: lessonId } })).resolves.toMatchObject({
      id: lessonBefore.id,
      tenantId: lessonBefore.tenantId,
      courseId: lessonBefore.courseId,
      sectionId: lessonBefore.sectionId,
      title: lessonBefore.title,
      description: lessonBefore.description,
      type: lessonBefore.type,
      position: lessonBefore.position,
      status: LessonStatus.DRAFT,
      availableFrom,
      availableUntil,
    });
    await expect(prisma.client.quizLesson.findUniqueOrThrow({ where: { lessonId } })).resolves.toEqual(linkBefore);
    await expect(prisma.client.lessonProgress.findUniqueOrThrow({ where: { id: progressId } })).resolves.toEqual(progressBefore);
    await expect(prisma.client.quizAttempt.findUniqueOrThrow({ where: { id: attemptId } })).resolves.toEqual(attemptBefore);
    await expect(prisma.client.quizAttemptAnswer.findUniqueOrThrow({ where: { id: answerId } })).resolves.toEqual(answerBefore);
    await expect(prisma.client.quiz.findUniqueOrThrow({ where: { id: quizId } })).resolves.toMatchObject({
      status: QuizStatus.ARCHIVED,
    });

    await request(server)
      .post(`/instructor/tenants/${tenantId}/courses/${courseId}/sections/${sectionId}/lessons/${lessonId}/publish`)
      .set('Authorization', `Bearer ${token}`)
      .expect(HttpStatus.CONFLICT)
      .expect(({ body }) => expect(body).toMatchObject({ error: { code: 'LESSON_CONTENT_NOT_READY' } }));

    await request(server)
      .post(`/instructor/tenants/${tenantId}/quizzes/${quizId}/restore`)
      .set('Authorization', `Bearer ${token}`)
      .expect(HttpStatus.OK);
    await request(server)
      .post(`/instructor/tenants/${tenantId}/quizzes/${quizId}/publish`)
      .set('Authorization', `Bearer ${token}`)
      .expect(HttpStatus.OK);
    await request(server)
      .post(`/instructor/tenants/${tenantId}/courses/${courseId}/sections/${sectionId}/lessons/${lessonId}/publish`)
      .set('Authorization', `Bearer ${token}`)
      .expect(HttpStatus.OK)
      .expect(({ body }) => expect(body).toMatchObject({ status: LessonStatus.PUBLISHED, quizId }));

    await request(server)
      .post(`/instructor/tenants/${tenantId}/courses/${courseId}/sections/${sectionId}/lessons/${lessonId}/restore`)
      .set('Authorization', `Bearer ${token}`)
      .expect(HttpStatus.CONFLICT)
      .expect(({ body }) =>
        expect(body).toMatchObject({ error: { code: 'INVALID_LESSON_LIFECYCLE_TRANSITION' } }),
      );
  });

  it('restores an ARCHIVED Quiz to DRAFT without publishability validation or question/history mutation', async () => {
    const { token, tenantId, instructorId } = await createInstructorTenant('quiz-restore');
    const studentId = await createStudent('quiz-restore-student');
    await createTenantStudent(tenantId, studentId);
    const courseId = await createCourse(tenantId, instructorId, CourseStatus.PUBLISHED);
    const sectionId = await createSection(tenantId, courseId, SectionStatus.PUBLISHED);
    const quizId = await createValidQuiz(tenantId, QuizStatus.DRAFT);
    const lessonId = await createQuizLesson(tenantId, courseId, sectionId, LessonStatus.PUBLISHED, quizId);
    const enrollmentId = await createEnrollment(tenantId, studentId, courseId, instructorId);

    await request(server)
      .post(`/instructor/tenants/${tenantId}/quizzes/${quizId}/publish`)
      .set('Authorization', `Bearer ${token}`)
      .expect(HttpStatus.OK);
    const publishedAt = (await prisma.client.quiz.findUniqueOrThrow({ where: { id: quizId } })).publishedAt;
    await request(server)
      .post(`/instructor/tenants/${tenantId}/quizzes/${quizId}/archive`)
      .set('Authorization', `Bearer ${token}`)
      .expect(HttpStatus.OK);

    const questionsBefore = await prisma.client.question.findMany({ where: { quizId }, orderBy: { position: 'asc' } });
    const optionsBefore = await prisma.client.questionOption.findMany({
      where: { questionId: { in: questionsBefore.map((question) => question.id) } },
      orderBy: [{ questionId: 'asc' }, { position: 'asc' }],
    });
    const attemptId = await createQuizAttempt(tenantId, quizId, lessonId, studentId, enrollmentId);
    const answerId = await createQuizAttemptAnswer(attemptId, questionsBefore[0].id, optionsBefore[0].id);
    const attemptBefore = await prisma.client.quizAttempt.findUniqueOrThrow({ where: { id: attemptId } });
    const answerBefore = await prisma.client.quizAttemptAnswer.findUniqueOrThrow({ where: { id: answerId } });

    await request(server)
      .post(`/instructor/tenants/${tenantId}/quizzes/${quizId}/restore`)
      .set('Authorization', `Bearer ${token}`)
      .expect(HttpStatus.OK)
      .expect(({ body }) => expect(body).toMatchObject({ quizId, status: QuizStatus.DRAFT, publishedAt: publishedAt?.toISOString() }));

    await expect(prisma.client.quiz.findUniqueOrThrow({ where: { id: quizId } })).resolves.toMatchObject({
      status: QuizStatus.DRAFT,
      publishedAt,
    });
    await expect(prisma.client.question.findMany({ where: { quizId }, orderBy: { position: 'asc' } })).resolves.toEqual(
      questionsBefore,
    );
    await expect(
      prisma.client.questionOption.findMany({
        where: { questionId: { in: questionsBefore.map((question) => question.id) } },
        orderBy: [{ questionId: 'asc' }, { position: 'asc' }],
      }),
    ).resolves.toEqual(optionsBefore);
    await expect(prisma.client.quizAttempt.findUniqueOrThrow({ where: { id: attemptId } })).resolves.toEqual(attemptBefore);
    await expect(prisma.client.quizAttemptAnswer.findUniqueOrThrow({ where: { id: answerId } })).resolves.toEqual(answerBefore);

    await request(server)
      .post(`/instructor/tenants/${tenantId}/quizzes/${quizId}/restore`)
      .set('Authorization', `Bearer ${token}`)
      .expect(HttpStatus.OK)
      .expect(({ body }) => expect(body).toMatchObject({ status: QuizStatus.DRAFT }));
    await request(server)
      .post(`/instructor/tenants/${tenantId}/quizzes/${quizId}/publish`)
      .set('Authorization', `Bearer ${token}`)
      .expect(HttpStatus.OK)
      .expect(({ body }) => expect(body).toMatchObject({ status: QuizStatus.PUBLISHED, publishedAt: publishedAt?.toISOString() }));
    await request(server)
      .post(`/instructor/tenants/${tenantId}/quizzes/${quizId}/restore`)
      .set('Authorization', `Bearer ${token}`)
      .expect(HttpStatus.CONFLICT)
      .expect(({ body }) =>
        expect(body).toMatchObject({ error: { code: 'INVALID_QUIZ_LIFECYCLE_TRANSITION' } }),
      );

    const incompleteQuiz = await createQuiz(tenantId, QuizStatus.ARCHIVED);
    await request(server)
      .post(`/instructor/tenants/${tenantId}/quizzes/${incompleteQuiz}/restore`)
      .set('Authorization', `Bearer ${token}`)
      .expect(HttpStatus.OK)
      .expect(({ body }) => expect(body).toMatchObject({ status: QuizStatus.DRAFT }));
    await request(server)
      .post(`/instructor/tenants/${tenantId}/quizzes/${incompleteQuiz}/publish`)
      .set('Authorization', `Bearer ${token}`)
      .expect(HttpStatus.CONFLICT)
      .expect(({ body }) => expect(body).toMatchObject({ error: { code: 'QUIZ_NOT_PUBLISHABLE' } }));
  });

  it('proves Restore is explicit and non-cascading across Course, Section, Lesson, Quiz, and Question state', async () => {
    const { token, tenantId, instructorId } = await createInstructorTenant('restore-noncascade');
    const courseId = await createCourse(tenantId, instructorId, CourseStatus.ARCHIVED);
    const sectionId = await createSection(tenantId, courseId, SectionStatus.ARCHIVED, 2);
    const quizId = await createQuiz(tenantId, QuizStatus.ARCHIVED);
    const activeQuestionId = await createQuestion(tenantId, quizId, QuestionType.TRUE_FALSE, QuestionStatus.ACTIVE);
    const archivedQuestionId = await createQuestion(tenantId, quizId, QuestionType.TRUE_FALSE, QuestionStatus.ARCHIVED);
    await createOption(tenantId, activeQuestionId, true, 1);
    await createOption(tenantId, activeQuestionId, false, 2);
    await createOption(tenantId, archivedQuestionId, true, 1);
    await createOption(tenantId, archivedQuestionId, false, 2);
    const lessonId = await createQuizLesson(tenantId, courseId, sectionId, LessonStatus.ARCHIVED, quizId);
    const questionStatusesBefore = await prisma.client.question.findMany({
      where: { quizId },
      orderBy: { position: 'asc' },
      select: { id: true, status: true },
    });

    await request(server)
      .post(`/instructor/tenants/${tenantId}/courses/${courseId}/restore`)
      .set('Authorization', `Bearer ${token}`)
      .expect(HttpStatus.OK)
      .expect(({ body }) => expect(body).toMatchObject({ status: CourseStatus.DRAFT }));
    await expect(prisma.client.courseSection.findUniqueOrThrow({ where: { id: sectionId } })).resolves.toMatchObject({
      status: SectionStatus.ARCHIVED,
    });
    await expect(prisma.client.lesson.findUniqueOrThrow({ where: { id: lessonId } })).resolves.toMatchObject({
      status: LessonStatus.ARCHIVED,
    });
    await expect(prisma.client.quiz.findUniqueOrThrow({ where: { id: quizId } })).resolves.toMatchObject({
      status: QuizStatus.ARCHIVED,
    });

    await request(server)
      .post(`/instructor/tenants/${tenantId}/courses/${courseId}/sections/${sectionId}/restore`)
      .set('Authorization', `Bearer ${token}`)
      .expect(HttpStatus.OK)
      .expect(({ body }) => expect(body).toMatchObject({ status: SectionStatus.DRAFT, position: 2 }));
    await expect(prisma.client.lesson.findUniqueOrThrow({ where: { id: lessonId } })).resolves.toMatchObject({
      status: LessonStatus.ARCHIVED,
    });
    await expect(prisma.client.quiz.findUniqueOrThrow({ where: { id: quizId } })).resolves.toMatchObject({
      status: QuizStatus.ARCHIVED,
    });

    await request(server)
      .post(`/instructor/tenants/${tenantId}/courses/${courseId}/sections/${sectionId}/lessons/${lessonId}/restore`)
      .set('Authorization', `Bearer ${token}`)
      .expect(HttpStatus.OK)
      .expect(({ body }) => expect(body).toMatchObject({ status: LessonStatus.DRAFT, quizId }));
    await expect(prisma.client.quiz.findUniqueOrThrow({ where: { id: quizId } })).resolves.toMatchObject({
      status: QuizStatus.ARCHIVED,
    });

    await request(server)
      .post(`/instructor/tenants/${tenantId}/quizzes/${quizId}/restore`)
      .set('Authorization', `Bearer ${token}`)
      .expect(HttpStatus.OK)
      .expect(({ body }) => expect(body).toMatchObject({ status: QuizStatus.DRAFT }));
    await expect(
      prisma.client.question.findMany({
        where: { quizId },
        orderBy: { position: 'asc' },
        select: { id: true, status: true },
      }),
    ).resolves.toEqual(questionStatusesBefore);
  });

  it('serializes Quiz restore with Question/Option mutation under the publication-boundary lock', async () => {
    const { token, tenantId } = await createInstructorTenant('quiz-restore-race');

    for (let attempt = 0; attempt < 5; attempt += 1) {
      const quizId = await createValidQuiz(tenantId, QuizStatus.ARCHIVED);
      const questionId = (await prisma.client.question.findFirstOrThrow({ where: { quizId } })).id;

      const [restoreResponse, updateResponse] = await Promise.all([
        request(server).post(`/instructor/tenants/${tenantId}/quizzes/${quizId}/restore`).set('Authorization', `Bearer ${token}`),
        request(server)
          .patch(`/instructor/tenants/${tenantId}/quizzes/${quizId}/questions/${questionId}`)
          .set('Authorization', `Bearer ${token}`)
          .send({ points: 2 }),
      ]);

      expect(restoreResponse.status).toBe(HttpStatus.OK);
      expect([HttpStatus.OK, HttpStatus.CONFLICT]).toContain(updateResponse.status);
      await expect(prisma.client.quiz.findUniqueOrThrow({ where: { id: quizId } })).resolves.toMatchObject({
        status: QuizStatus.DRAFT,
      });
      const question = await prisma.client.question.findUniqueOrThrow({ where: { id: questionId } });
      if (updateResponse.status === 200) {
        expect(question.points.toString()).toBe('2');
      } else {
        expect(updateResponse.body).toMatchObject({ error: { code: 'INVALID_QUIZ_LIFECYCLE_TRANSITION' } });
        expect(question.points.toString()).toBe('1');
      }
    }
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
      .post(`/instructor/tenants/${tenantId}/quizzes/${quizId}/unpublish`)
      .set('Authorization', `Bearer ${token}`)
      .expect(HttpStatus.OK);
    await request(server)
      .get(`/student/courses/${courseId}/lessons/${lessonId}/quiz`)
      .set('Authorization', `Bearer ${studentToken}`)
      .set(INSTALLATION_ID_HEADER, installationId)
      .expect(HttpStatus.NOT_FOUND);
    await request(server).post(`/instructor/tenants/${tenantId}/quizzes/${quizId}/publish`).set('Authorization', `Bearer ${token}`).expect(HttpStatus.OK);

    await request(server)
      .post(`/instructor/tenants/${tenantId}/courses/${courseId}/sections/${sectionId}/lessons/${lessonId}/unpublish`)
      .set('Authorization', `Bearer ${token}`)
      .expect(HttpStatus.OK);
    await request(server)
      .get(`/student/courses/${courseId}/lessons/${lessonId}/quiz`)
      .set('Authorization', `Bearer ${studentToken}`)
      .set(INSTALLATION_ID_HEADER, installationId)
      .expect(HttpStatus.NOT_FOUND);
    await request(server)
      .post(`/instructor/tenants/${tenantId}/courses/${courseId}/sections/${sectionId}/lessons/${lessonId}/publish`)
      .set('Authorization', `Bearer ${token}`)
      .expect(HttpStatus.OK);

    await request(server)
      .post(`/instructor/tenants/${tenantId}/courses/${courseId}/sections/${sectionId}/unpublish`)
      .set('Authorization', `Bearer ${token}`)
      .expect(HttpStatus.OK);
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
      .post(`/instructor/tenants/${tenantId}/courses/${courseId}/unpublish`)
      .set('Authorization', `Bearer ${token}`)
      .expect(HttpStatus.OK);
    await request(server)
      .get(`/student/courses/${courseId}`)
      .set('Authorization', `Bearer ${studentToken}`)
      .set(INSTALLATION_ID_HEADER, installationId)
      .expect(HttpStatus.NOT_FOUND);
    await request(server).post(`/instructor/tenants/${tenantId}/courses/${courseId}/publish`).set('Authorization', `Bearer ${token}`).expect(HttpStatus.OK);

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
  ): Promise<string> {
    const id = uuid.create();
    await prisma.client.enrollment.create({
      data: {
        id,
        tenantId,
        studentUserId,
        courseId,
        grantedByUserId,
        status: EnrollmentStatus.ACTIVE,
      },
    });
    return id;
  }

  async function createLessonProgress(
    tenantId: string,
    courseId: string,
    lessonId: string,
    studentUserId: string,
    enrollmentId: string,
  ): Promise<string> {
    const id = uuid.create();
    await prisma.client.lessonProgress.create({
      data: {
        id,
        tenantId,
        courseId,
        lessonId,
        studentUserId,
        enrollmentId,
        status: LessonProgressStatus.COMPLETED,
        completedAt: NOW,
      },
    });
    return id;
  }

  async function createQuizAttempt(
    tenantId: string,
    quizId: string,
    lessonId: string,
    studentUserId: string,
    enrollmentId: string,
  ): Promise<string> {
    const id = uuid.create();
    await prisma.client.quizAttempt.create({
      data: {
        id,
        tenantId,
        quizId,
        lessonId,
        studentUserId,
        enrollmentId,
        status: QuizAttemptStatus.GRADED,
        attemptNumber: 1,
        startedAt: NOW,
        passingScorePercentSnapshot: null,
        submittedAt: NOW,
        gradedAt: NOW,
        scorePoints: 1,
        maxPoints: 1,
        passed: null,
      },
    });
    return id;
  }

  async function createQuizAttemptAnswer(
    attemptId: string,
    questionId: string,
    selectedOptionId: string,
  ): Promise<string> {
    const id = uuid.create();
    await prisma.client.quizAttemptAnswer.create({
      data: {
        id,
        attemptId,
        questionId,
        questionSnapshot: { prompt: 'Question snapshot', type: QuestionType.TRUE_FALSE },
        optionsSnapshot: [{ optionId: selectedOptionId, text: 'True' }],
        selectedOptionIdsSnapshot: [selectedOptionId],
        correctAnswerSnapshot: { correctOptionIds: [selectedOptionId] },
        pointsAwarded: 1,
        pointsPossible: 1,
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
