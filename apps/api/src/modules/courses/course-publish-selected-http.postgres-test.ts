import { HttpStatus, INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import * as cookieParser from 'cookie-parser';
import * as request from 'supertest';
import type { App } from 'supertest/types';
import {
  AccountStatus,
  AssetProcessingStatus,
  CourseStatus,
  LessonStatus,
  LessonType,
  PlatformRole,
  QuestionStatus,
  QuestionType,
  QuizStatus,
  SectionStatus,
  TenantMembershipRole,
  TenantMembershipStatus,
  TenantStatus,
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
import { UuidV7Service } from '../auth/services/uuid-v7.service';
import { testAuthConfig } from '../auth/test-helpers';
import { QuizzesModule } from '../quizzes/quizzes.module';
import { TenancyModule } from '../tenancy/tenancy.module';
import { CoursesModule } from './courses.module';

const testDatabaseUrl = process.env.TEST_DATABASE_URL;
const maybeDescribe = testDatabaseUrl ? describe : describe.skip;
const trustedOrigin = 'http://localhost:3000';
const NOW = new Date('2026-09-03T12:00:00.000Z');

type ReadinessIssueBody = {
  reasonCode: string;
  entityType: string;
  entityId: string;
  parentSectionId?: string;
  parentLessonId?: string;
  title?: string;
  detail?: string;
};

type PublishSelectedBody = {
  courseId: string;
  status: string;
  published: { sectionIds: string[]; lessonIds: string[]; quizIds: string[] };
};

type ErrorBody = { error: { code: string; message: string; blockers?: ReadinessIssueBody[] } };

maybeDescribe('instructor Course publish-selected HTTP PostgreSQL integration', () => {
  let app: INestApplication;
  let server: App;
  let prisma: PrismaService;
  let accessTokens: AccessTokenService;
  let refreshSessions: RefreshSessionService;
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
    uuid = moduleRef.get(UuidV7Service);

    await clearData();
  });

  afterEach(async () => {
    await clearData();
    await app?.close();
  });

  function publishSelected(tenantId: string, courseId: string, token: string, body: { sectionIds: string[]; lessonIds: string[] }) {
    return request(server)
      .post(`/instructor/tenants/${tenantId}/courses/${courseId}/publish-selected`)
      .set('Authorization', `Bearer ${token}`)
      .send(body);
  }

  it('BASIC FIRST PUBLISH: publishes a single selected Section + ready Video Lesson and stamps Course.publishedAt', async () => {
    const { token, tenantId, instructorId } = await createInstructorTenant('basic');
    const courseId = await createCourseDirect(tenantId, instructorId);
    const sectionId = await createSectionDirect(tenantId, courseId, SectionStatus.DRAFT, 1);
    const videoAssetId = await createVideoAssetDirect(tenantId, instructorId, AssetProcessingStatus.READY);
    const lessonId = await createVideoLessonDirect(tenantId, courseId, sectionId, LessonStatus.DRAFT, videoAssetId, 1);

    const response = await publishSelected(tenantId, courseId, token, {
      sectionIds: [sectionId],
      lessonIds: [lessonId],
    }).expect(HttpStatus.OK);

    const body = responseBody<PublishSelectedBody>(response);
    expect(body).toEqual({
      courseId,
      status: 'PUBLISHED',
      published: { sectionIds: [sectionId], lessonIds: [lessonId], quizIds: [] },
    });

    await expect(prisma.client.course.findUniqueOrThrow({ where: { id: courseId } })).resolves.toMatchObject({
      status: CourseStatus.PUBLISHED,
      publishedAt: NOW,
    });
    await expect(prisma.client.courseSection.findUniqueOrThrow({ where: { id: sectionId } })).resolves.toMatchObject({
      status: SectionStatus.PUBLISHED,
    });
    await expect(prisma.client.lesson.findUniqueOrThrow({ where: { id: lessonId } })).resolves.toMatchObject({
      status: LessonStatus.PUBLISHED,
    });
  });

  it('MIXED CONTENT: publishes exactly Section A + A1/A2/A3 and the derived Draft Quiz, leaving Section B/B1 untouched', async () => {
    const { token, tenantId, instructorId } = await createInstructorTenant('mixed');
    const courseId = await createCourseDirect(tenantId, instructorId);

    const sectionAId = await createSectionDirect(tenantId, courseId, SectionStatus.DRAFT, 1);
    const readyVideoAssetId = await createVideoAssetDirect(tenantId, instructorId, AssetProcessingStatus.READY);
    const a1 = await createVideoLessonDirect(tenantId, courseId, sectionAId, LessonStatus.DRAFT, readyVideoAssetId, 1);
    const readyDocumentAssetId = await createDocumentAssetDirect(tenantId, instructorId, AssetProcessingStatus.READY);
    const a2 = await createDocumentLessonDirect(tenantId, courseId, sectionAId, LessonStatus.DRAFT, readyDocumentAssetId, 2);
    const validDraftQuizId = await createValidQuizDirect(tenantId, QuizStatus.DRAFT);
    const a3 = await createQuizLessonDirect(tenantId, courseId, sectionAId, LessonStatus.DRAFT, validDraftQuizId, 3);

    const sectionBId = await createSectionDirect(tenantId, courseId, SectionStatus.DRAFT, 2);
    const preparingVideoAssetId = await createVideoAssetDirect(tenantId, instructorId, AssetProcessingStatus.PROCESSING);
    const b1 = await createVideoLessonDirect(tenantId, courseId, sectionBId, LessonStatus.DRAFT, preparingVideoAssetId, 1);

    const response = await publishSelected(tenantId, courseId, token, {
      sectionIds: [sectionAId],
      lessonIds: [a1, a2, a3],
    }).expect(HttpStatus.OK);

    const body = responseBody<PublishSelectedBody>(response);
    expect(new Set(body.published.sectionIds)).toEqual(new Set([sectionAId]));
    expect(new Set(body.published.lessonIds)).toEqual(new Set([a1, a2, a3]));
    expect(body.published.quizIds).toEqual([validDraftQuizId]);

    await expect(prisma.client.courseSection.findUniqueOrThrow({ where: { id: sectionAId } })).resolves.toMatchObject({
      status: SectionStatus.PUBLISHED,
    });
    for (const lessonId of [a1, a2, a3]) {
      await expect(prisma.client.lesson.findUniqueOrThrow({ where: { id: lessonId } })).resolves.toMatchObject({
        status: LessonStatus.PUBLISHED,
      });
    }
    await expect(prisma.client.quiz.findUniqueOrThrow({ where: { id: validDraftQuizId } })).resolves.toMatchObject({
      status: QuizStatus.PUBLISHED,
    });

    // Section B / Lesson B1 remain exactly untouched, and B1's VideoAsset was never mutated.
    await expect(prisma.client.courseSection.findUniqueOrThrow({ where: { id: sectionBId } })).resolves.toMatchObject({
      status: SectionStatus.DRAFT,
    });
    await expect(prisma.client.lesson.findUniqueOrThrow({ where: { id: b1 } })).resolves.toMatchObject({
      status: LessonStatus.DRAFT,
    });
    await expect(prisma.client.videoAsset.findUniqueOrThrow({ where: { id: preparingVideoAssetId } })).resolves.toMatchObject({
      processingStatus: AssetProcessingStatus.PROCESSING,
    });
  });

  it('EXPLICIT-INCLUSION RACE: a Lesson that becomes ready after review but was never selected stays DRAFT', async () => {
    const { token, tenantId, instructorId } = await createInstructorTenant('inclusion-race');
    const courseId = await createCourseDirect(tenantId, instructorId);
    const sectionId = await createSectionDirect(tenantId, courseId, SectionStatus.DRAFT, 1);

    const selectedVideoAssetId = await createVideoAssetDirect(tenantId, instructorId, AssetProcessingStatus.READY);
    const selectedLessonId = await createVideoLessonDirect(tenantId, courseId, sectionId, LessonStatus.DRAFT, selectedVideoAssetId, 1);

    const unselectedVideoAssetId = await createVideoAssetDirect(tenantId, instructorId, AssetProcessingStatus.UPLOADING);
    const unselectedLessonId = await createVideoLessonDirect(tenantId, courseId, sectionId, LessonStatus.DRAFT, unselectedVideoAssetId, 2);

    // Simulates the unselected Lesson's video finishing processing between the Instructor's review
    // and this publish-selected call — it must not be swept in just because it is now "ready".
    await prisma.client.videoAsset.update({
      where: { id: unselectedVideoAssetId },
      data: { processingStatus: AssetProcessingStatus.READY },
    });

    await publishSelected(tenantId, courseId, token, {
      sectionIds: [sectionId],
      lessonIds: [selectedLessonId],
    }).expect(HttpStatus.OK);

    await expect(prisma.client.lesson.findUniqueOrThrow({ where: { id: selectedLessonId } })).resolves.toMatchObject({
      status: LessonStatus.PUBLISHED,
    });
    await expect(prisma.client.lesson.findUniqueOrThrow({ where: { id: unselectedLessonId } })).resolves.toMatchObject({
      status: LessonStatus.DRAFT,
    });
  });

  it('STALE SELECTED VIDEO: rejects the whole selection atomically when the selected Video regresses before publish', async () => {
    const { token, tenantId, instructorId } = await createInstructorTenant('stale-video');
    const courseId = await createCourseDirect(tenantId, instructorId);
    const sectionId = await createSectionDirect(tenantId, courseId, SectionStatus.DRAFT, 1);
    const videoAssetId = await createVideoAssetDirect(tenantId, instructorId, AssetProcessingStatus.READY);
    const lessonId = await createVideoLessonDirect(tenantId, courseId, sectionId, LessonStatus.DRAFT, videoAssetId, 1);

    // Regresses after the Instructor's review, before the publish-selected call.
    await prisma.client.videoAsset.update({
      where: { id: videoAssetId },
      data: { processingStatus: AssetProcessingStatus.FAILED, failureCode: 'TEST_REGRESSION' },
    });

    const response = await publishSelected(tenantId, courseId, token, {
      sectionIds: [sectionId],
      lessonIds: [lessonId],
    }).expect(HttpStatus.CONFLICT);

    const body = responseBody<ErrorBody>(response);
    expect(body.error.code).toBe('PUBLISH_SELECTION_STALE');
    expect(body.error.blockers).toEqual([
      expect.objectContaining({ reasonCode: 'VIDEO_FAILED', entityType: 'VIDEO_ASSET', entityId: videoAssetId }),
    ]);

    await expect(prisma.client.course.findUniqueOrThrow({ where: { id: courseId } })).resolves.toMatchObject({
      status: CourseStatus.DRAFT,
      publishedAt: null,
    });
    await expect(prisma.client.courseSection.findUniqueOrThrow({ where: { id: sectionId } })).resolves.toMatchObject({
      status: SectionStatus.DRAFT,
    });
    await expect(prisma.client.lesson.findUniqueOrThrow({ where: { id: lessonId } })).resolves.toMatchObject({
      status: LessonStatus.DRAFT,
    });
  });

  it('STALE SELECTED QUIZ: rejects atomically when a valid Draft Quiz is broken via the existing Option endpoint before publish', async () => {
    const { token, tenantId, instructorId } = await createInstructorTenant('stale-quiz');
    const courseId = await createCourseDirect(tenantId, instructorId);
    const sectionId = await createSectionDirect(tenantId, courseId, SectionStatus.DRAFT, 1);
    const quizId = await createQuizDirect(tenantId, QuizStatus.DRAFT);
    const questionId = await createQuestionDirect(tenantId, quizId, QuestionType.TRUE_FALSE, QuestionStatus.ACTIVE);
    const correctOptionId = await createOptionDirect(tenantId, questionId, true, 1);
    await createOptionDirect(tenantId, questionId, false, 2);
    const lessonId = await createQuizLessonDirect(tenantId, courseId, sectionId, LessonStatus.DRAFT, quizId, 1);

    // Breaks the Quiz's aggregate through the real, supported Option-update backend path — allowed
    // while the Quiz is DRAFT (DEC-0048: a DRAFT Quiz is exempt from the aggregate check).
    await request(server)
      .patch(`/instructor/tenants/${tenantId}/quizzes/${quizId}/questions/${questionId}/options/${correctOptionId}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ isCorrect: false })
      .expect(HttpStatus.OK);

    const response = await publishSelected(tenantId, courseId, token, {
      sectionIds: [sectionId],
      lessonIds: [lessonId],
    }).expect(HttpStatus.CONFLICT);

    const body = responseBody<ErrorBody>(response);
    expect(body.error.code).toBe('PUBLISH_SELECTION_STALE');
    expect(body.error.blockers).toEqual([
      expect.objectContaining({ reasonCode: 'QUIZ_NOT_PUBLISHABLE_MISSING_CORRECT_OPTION', entityType: 'QUIZ', entityId: quizId }),
    ]);

    await expect(prisma.client.quiz.findUniqueOrThrow({ where: { id: quizId } })).resolves.toMatchObject({
      status: QuizStatus.DRAFT,
    });
    await expect(prisma.client.lesson.findUniqueOrThrow({ where: { id: lessonId } })).resolves.toMatchObject({
      status: LessonStatus.DRAFT,
    });
    await expect(prisma.client.course.findUniqueOrThrow({ where: { id: courseId } })).resolves.toMatchObject({
      publishedAt: null,
    });
  });

  describe('STRUCTURAL RULE', () => {
    it('rejects a selected Lesson whose DRAFT Section is not included in sectionIds', async () => {
      const { token, tenantId, instructorId } = await createInstructorTenant('structural-missing-section');
      const courseId = await createCourseDirect(tenantId, instructorId);
      const sectionId = await createSectionDirect(tenantId, courseId, SectionStatus.DRAFT, 1);
      const videoAssetId = await createVideoAssetDirect(tenantId, instructorId, AssetProcessingStatus.READY);
      const lessonId = await createVideoLessonDirect(tenantId, courseId, sectionId, LessonStatus.DRAFT, videoAssetId, 1);

      const response = await publishSelected(tenantId, courseId, token, {
        sectionIds: [],
        lessonIds: [lessonId],
      }).expect(HttpStatus.CONFLICT);

      const body = responseBody<ErrorBody>(response);
      expect(body.error.code).toBe('PUBLISH_SELECTION_STALE');
      expect(body.error.blockers).toEqual([
        expect.objectContaining({ reasonCode: 'LESSON_SECTION_NOT_INCLUDED', entityType: 'LESSON', entityId: lessonId }),
      ]);

      await expect(prisma.client.lesson.findUniqueOrThrow({ where: { id: lessonId } })).resolves.toMatchObject({
        status: LessonStatus.DRAFT,
      });
      await expect(prisma.client.course.findUniqueOrThrow({ where: { id: courseId } })).resolves.toMatchObject({
        publishedAt: null,
      });
    });

    it('accepts the same shape of Lesson with empty sectionIds when its Section is already PUBLISHED', async () => {
      const { token, tenantId, instructorId } = await createInstructorTenant('structural-published-section');
      const courseId = await createCourseDirect(tenantId, instructorId);
      const sectionId = await createSectionDirect(tenantId, courseId, SectionStatus.PUBLISHED, 1);
      const videoAssetId = await createVideoAssetDirect(tenantId, instructorId, AssetProcessingStatus.READY);
      const lessonId = await createVideoLessonDirect(tenantId, courseId, sectionId, LessonStatus.DRAFT, videoAssetId, 1);

      const response = await publishSelected(tenantId, courseId, token, {
        sectionIds: [],
        lessonIds: [lessonId],
      }).expect(HttpStatus.OK);

      const body = responseBody<PublishSelectedBody>(response);
      expect(body.published).toEqual({ sectionIds: [], lessonIds: [lessonId], quizIds: [] });

      await expect(prisma.client.lesson.findUniqueOrThrow({ where: { id: lessonId } })).resolves.toMatchObject({
        status: LessonStatus.PUBLISHED,
      });
    });
  });

  it('EMPTY SELECTION: rejects sectionIds=[] and lessonIds=[] at the request-validation layer, before touching the Course', async () => {
    const { token, tenantId, instructorId } = await createInstructorTenant('empty-selection');
    const courseId = await createCourseDirect(tenantId, instructorId);

    const response = await publishSelected(tenantId, courseId, token, { sectionIds: [], lessonIds: [] }).expect(
      HttpStatus.BAD_REQUEST,
    );

    expect(responseBody<ErrorBody>(response).error.code).toBe('VALIDATION_FAILED');
    await expect(prisma.client.course.findUniqueOrThrow({ where: { id: courseId } })).resolves.toMatchObject({
      status: CourseStatus.DRAFT,
      publishedAt: null,
    });
  });

  it('CROSS COURSE / TENANT: a Section/Lesson injected from another Course or tenant cannot be published and leaks no existence', async () => {
    const { token, tenantId, instructorId } = await createInstructorTenant('cross-victim');
    const courseId = await createCourseDirect(tenantId, instructorId);
    const sectionId = await createSectionDirect(tenantId, courseId, SectionStatus.DRAFT, 1);
    const videoAssetId = await createVideoAssetDirect(tenantId, instructorId, AssetProcessingStatus.READY);
    const lessonId = await createVideoLessonDirect(tenantId, courseId, sectionId, LessonStatus.DRAFT, videoAssetId, 1);

    // A foreign Section/Lesson pair from a different Course in the SAME tenant.
    const foreignCourseId = await createCourseDirect(tenantId, instructorId);
    const foreignSectionId = await createSectionDirect(tenantId, foreignCourseId, SectionStatus.DRAFT, 1);
    const foreignVideoAssetId = await createVideoAssetDirect(tenantId, instructorId, AssetProcessingStatus.READY);
    const foreignLessonId = await createVideoLessonDirect(
      tenantId,
      foreignCourseId,
      foreignSectionId,
      LessonStatus.DRAFT,
      foreignVideoAssetId,
      1,
    );

    const crossCourse = await publishSelected(tenantId, courseId, token, {
      sectionIds: [sectionId, foreignSectionId],
      lessonIds: [lessonId, foreignLessonId],
    }).expect(HttpStatus.NOT_FOUND);
    expect(responseBody<ErrorBody>(crossCourse).error.code).toBe('SECTION_NOT_FOUND');

    // A Section/Lesson pair from an entirely different tenant.
    const { tenantId: otherTenantId, instructorId: otherInstructorId } = await createInstructorTenant('cross-other-tenant');
    const otherCourseId = await createCourseDirect(otherTenantId, otherInstructorId);
    const otherSectionId = await createSectionDirect(otherTenantId, otherCourseId, SectionStatus.DRAFT, 1);
    const otherVideoAssetId = await createVideoAssetDirect(otherTenantId, otherInstructorId, AssetProcessingStatus.READY);
    const otherLessonId = await createVideoLessonDirect(
      otherTenantId,
      otherCourseId,
      otherSectionId,
      LessonStatus.DRAFT,
      otherVideoAssetId,
      1,
    );

    const crossTenant = await publishSelected(tenantId, courseId, token, {
      sectionIds: [sectionId],
      lessonIds: [lessonId, otherLessonId],
    }).expect(HttpStatus.NOT_FOUND);
    expect(responseBody<ErrorBody>(crossTenant).error.code).toBe('LESSON_NOT_FOUND');

    // Nothing mutated anywhere, in either attempt.
    for (const id of [sectionId, foreignSectionId, otherSectionId]) {
      await expect(prisma.client.courseSection.findUniqueOrThrow({ where: { id } })).resolves.toMatchObject({
        status: SectionStatus.DRAFT,
      });
    }
    for (const id of [lessonId, foreignLessonId, otherLessonId]) {
      await expect(prisma.client.lesson.findUniqueOrThrow({ where: { id } })).resolves.toMatchObject({
        status: LessonStatus.DRAFT,
      });
    }
    await expect(prisma.client.course.findUniqueOrThrow({ where: { id: courseId } })).resolves.toMatchObject({
      publishedAt: null,
    });
  });

  describe('ALREADY PUBLISHED', () => {
    it('rejects with COURSE_ALREADY_PUBLISHED_ONCE for a Course that was published then taken offline', async () => {
      const { token, tenantId, instructorId } = await createInstructorTenant('already-published-once');
      const courseId = await createCourseDirect(tenantId, instructorId, {
        status: CourseStatus.DRAFT,
        publishedAt: new Date('2026-01-01T00:00:00.000Z'),
      });
      const sectionId = await createSectionDirect(tenantId, courseId, SectionStatus.DRAFT, 1);
      const videoAssetId = await createVideoAssetDirect(tenantId, instructorId, AssetProcessingStatus.READY);
      const lessonId = await createVideoLessonDirect(tenantId, courseId, sectionId, LessonStatus.DRAFT, videoAssetId, 1);

      const response = await publishSelected(tenantId, courseId, token, {
        sectionIds: [sectionId],
        lessonIds: [lessonId],
      }).expect(HttpStatus.CONFLICT);

      expect(responseBody<ErrorBody>(response).error.code).toBe('COURSE_ALREADY_PUBLISHED_ONCE');
      await expect(prisma.client.lesson.findUniqueOrThrow({ where: { id: lessonId } })).resolves.toMatchObject({
        status: LessonStatus.DRAFT,
      });
    });

    it('rejects an already-PUBLISHED Course the same way', async () => {
      const { token, tenantId, instructorId } = await createInstructorTenant('already-published-live');
      const courseId = await createCourseDirect(tenantId, instructorId, {
        status: CourseStatus.PUBLISHED,
        publishedAt: NOW,
      });

      const response = await publishSelected(tenantId, courseId, token, { sectionIds: [], lessonIds: [uuid.create()] }).expect(
        HttpStatus.CONFLICT,
      );
      expect(responseBody<ErrorBody>(response).error.code).toBe('COURSE_ALREADY_PUBLISHED_ONCE');
    });

    it('leaves the existing granular /publish endpoint behavior unchanged: idempotent on an already-PUBLISHED Course', async () => {
      const { token, tenantId, instructorId } = await createInstructorTenant('granular-publish-unchanged');
      const courseId = await createCourseDirect(tenantId, instructorId, {
        status: CourseStatus.PUBLISHED,
        publishedAt: new Date('2026-01-01T00:00:00.000Z'),
      });

      const response = await request(server)
        .post(`/instructor/tenants/${tenantId}/courses/${courseId}/publish`)
        .set('Authorization', `Bearer ${token}`)
        .expect(HttpStatus.OK);

      // Idempotent: publishing an already-PUBLISHED Course succeeds and does not re-stamp
      // publishedAt (unlike DRAFT -> PUBLISHED, which does — that pre-existing behavior is
      // intentionally left unchanged and out of scope for this slice).
      expect(responseBody<{ status: string; publishedAt: string }>(response).status).toBe('PUBLISHED');
      await expect(prisma.client.course.findUniqueOrThrow({ where: { id: courseId } })).resolves.toMatchObject({
        status: CourseStatus.PUBLISHED,
        publishedAt: new Date('2026-01-01T00:00:00.000Z'),
      });
    });
  });

  it('ARCHIVED COURSE: rejects publish-selected with the existing INVALID_COURSE_LIFECYCLE_TRANSITION error', async () => {
    const { token, tenantId, instructorId } = await createInstructorTenant('archived-course');
    const courseId = await createCourseDirect(tenantId, instructorId, { status: CourseStatus.ARCHIVED });

    const response = await publishSelected(tenantId, courseId, token, { sectionIds: [], lessonIds: [uuid.create()] }).expect(
      HttpStatus.CONFLICT,
    );
    expect(responseBody<ErrorBody>(response).error.code).toBe('INVALID_COURSE_LIFECYCLE_TRANSITION');
  });

  describe('ARCHIVED SELECTED SECTION/LESSON', () => {
    it('treats a submitted ARCHIVED Section as a stale selection and publishes nothing', async () => {
      const { token, tenantId, instructorId } = await createInstructorTenant('archived-section-selected');
      const courseId = await createCourseDirect(tenantId, instructorId);
      const archivedSectionId = await createSectionDirect(tenantId, courseId, SectionStatus.ARCHIVED, 1);
      const otherSectionId = await createSectionDirect(tenantId, courseId, SectionStatus.DRAFT, 2);
      const videoAssetId = await createVideoAssetDirect(tenantId, instructorId, AssetProcessingStatus.READY);
      const lessonId = await createVideoLessonDirect(tenantId, courseId, otherSectionId, LessonStatus.DRAFT, videoAssetId, 1);

      const response = await publishSelected(tenantId, courseId, token, {
        sectionIds: [archivedSectionId, otherSectionId],
        lessonIds: [lessonId],
      }).expect(HttpStatus.CONFLICT);

      const body = responseBody<ErrorBody>(response);
      expect(body.error.code).toBe('PUBLISH_SELECTION_STALE');
      expect(body.error.blockers).toEqual([
        expect.objectContaining({ reasonCode: 'SECTION_NOT_SELECTABLE', entityId: archivedSectionId, detail: 'ARCHIVED' }),
      ]);

      await expect(prisma.client.courseSection.findUniqueOrThrow({ where: { id: otherSectionId } })).resolves.toMatchObject({
        status: SectionStatus.DRAFT,
      });
      await expect(prisma.client.lesson.findUniqueOrThrow({ where: { id: lessonId } })).resolves.toMatchObject({
        status: LessonStatus.DRAFT,
      });
    });

    it('treats a submitted ARCHIVED Lesson as a stale selection and publishes nothing', async () => {
      const { token, tenantId, instructorId } = await createInstructorTenant('archived-lesson-selected');
      const courseId = await createCourseDirect(tenantId, instructorId);
      const sectionId = await createSectionDirect(tenantId, courseId, SectionStatus.DRAFT, 1);
      const videoAssetId = await createVideoAssetDirect(tenantId, instructorId, AssetProcessingStatus.READY);
      const archivedLessonId = await createVideoLessonDirect(tenantId, courseId, sectionId, LessonStatus.ARCHIVED, videoAssetId, 1);

      const response = await publishSelected(tenantId, courseId, token, {
        sectionIds: [sectionId],
        lessonIds: [archivedLessonId],
      }).expect(HttpStatus.CONFLICT);

      const body = responseBody<ErrorBody>(response);
      expect(body.error.code).toBe('PUBLISH_SELECTION_STALE');
      expect(body.error.blockers).toEqual([
        expect.objectContaining({ reasonCode: 'LESSON_NOT_SELECTABLE', entityId: archivedLessonId, detail: 'ARCHIVED' }),
      ]);

      await expect(prisma.client.courseSection.findUniqueOrThrow({ where: { id: sectionId } })).resolves.toMatchObject({
        status: SectionStatus.DRAFT,
      });
    });
  });

  describe('QUIZ', () => {
    it('publishes the Lesson and leaves an already-PUBLISHED referenced Quiz unchanged', async () => {
      const { token, tenantId, instructorId } = await createInstructorTenant('quiz-published');
      const courseId = await createCourseDirect(tenantId, instructorId);
      const sectionId = await createSectionDirect(tenantId, courseId, SectionStatus.DRAFT, 1);
      const quizId = await createValidQuizDirect(tenantId, QuizStatus.PUBLISHED);
      const lessonId = await createQuizLessonDirect(tenantId, courseId, sectionId, LessonStatus.DRAFT, quizId, 1);

      const response = await publishSelected(tenantId, courseId, token, {
        sectionIds: [sectionId],
        lessonIds: [lessonId],
      }).expect(HttpStatus.OK);

      expect(responseBody<PublishSelectedBody>(response).published.quizIds).toEqual([]);
      await expect(prisma.client.lesson.findUniqueOrThrow({ where: { id: lessonId } })).resolves.toMatchObject({
        status: LessonStatus.PUBLISHED,
      });
    });

    it('publishes a valid Draft Quiz alongside its Lesson', async () => {
      const { token, tenantId, instructorId } = await createInstructorTenant('quiz-draft-valid');
      const courseId = await createCourseDirect(tenantId, instructorId);
      const sectionId = await createSectionDirect(tenantId, courseId, SectionStatus.DRAFT, 1);
      const quizId = await createValidQuizDirect(tenantId, QuizStatus.DRAFT);
      const lessonId = await createQuizLessonDirect(tenantId, courseId, sectionId, LessonStatus.DRAFT, quizId, 1);

      const response = await publishSelected(tenantId, courseId, token, {
        sectionIds: [sectionId],
        lessonIds: [lessonId],
      }).expect(HttpStatus.OK);

      expect(responseBody<PublishSelectedBody>(response).published.quizIds).toEqual([quizId]);
      await expect(prisma.client.quiz.findUniqueOrThrow({ where: { id: quizId } })).resolves.toMatchObject({
        status: QuizStatus.PUBLISHED,
        publishedAt: NOW,
      });
    });

    it('rejects an invalid Draft Quiz (no active questions) as stale', async () => {
      const { token, tenantId, instructorId } = await createInstructorTenant('quiz-draft-invalid');
      const courseId = await createCourseDirect(tenantId, instructorId);
      const sectionId = await createSectionDirect(tenantId, courseId, SectionStatus.DRAFT, 1);
      const quizId = await createQuizDirect(tenantId, QuizStatus.DRAFT);
      const lessonId = await createQuizLessonDirect(tenantId, courseId, sectionId, LessonStatus.DRAFT, quizId, 1);

      const response = await publishSelected(tenantId, courseId, token, {
        sectionIds: [sectionId],
        lessonIds: [lessonId],
      }).expect(HttpStatus.CONFLICT);

      const body = responseBody<ErrorBody>(response);
      expect(body.error.blockers).toEqual([
        expect.objectContaining({ reasonCode: 'QUIZ_NOT_PUBLISHABLE_NO_QUESTIONS', entityId: quizId }),
      ]);
      await expect(prisma.client.quiz.findUniqueOrThrow({ where: { id: quizId } })).resolves.toMatchObject({
        status: QuizStatus.DRAFT,
      });
    });

    it('rejects an ARCHIVED referenced Quiz as stale', async () => {
      const { token, tenantId, instructorId } = await createInstructorTenant('quiz-archived');
      const courseId = await createCourseDirect(tenantId, instructorId);
      const sectionId = await createSectionDirect(tenantId, courseId, SectionStatus.DRAFT, 1);
      const quizId = await createValidQuizDirect(tenantId, QuizStatus.ARCHIVED);
      const lessonId = await createQuizLessonDirect(tenantId, courseId, sectionId, LessonStatus.DRAFT, quizId, 1);

      const response = await publishSelected(tenantId, courseId, token, {
        sectionIds: [sectionId],
        lessonIds: [lessonId],
      }).expect(HttpStatus.CONFLICT);

      expect(responseBody<ErrorBody>(response).error.blockers).toEqual([
        expect.objectContaining({ reasonCode: 'QUIZ_ARCHIVED', entityId: quizId }),
      ]);
    });

    it('acquires locks deterministically and publishes all Quizzes when multiple selected Lessons reference distinct Draft Quizzes', async () => {
      const { token, tenantId, instructorId } = await createInstructorTenant('quiz-multiple');
      const courseId = await createCourseDirect(tenantId, instructorId);
      const sectionId = await createSectionDirect(tenantId, courseId, SectionStatus.DRAFT, 1);

      const quizIds: string[] = [];
      const lessonIds: string[] = [];
      for (let i = 0; i < 4; i += 1) {
        const quizId = await createValidQuizDirect(tenantId, QuizStatus.DRAFT);
        const lessonId = await createQuizLessonDirect(tenantId, courseId, sectionId, LessonStatus.DRAFT, quizId, i + 1);
        quizIds.push(quizId);
        lessonIds.push(lessonId);
      }

      const response = await publishSelected(tenantId, courseId, token, {
        sectionIds: [sectionId],
        lessonIds,
      }).expect(HttpStatus.OK);

      expect(new Set(responseBody<PublishSelectedBody>(response).published.quizIds)).toEqual(new Set(quizIds));
      for (const quizId of quizIds) {
        await expect(prisma.client.quiz.findUniqueOrThrow({ where: { id: quizId } })).resolves.toMatchObject({
          status: QuizStatus.PUBLISHED,
        });
      }
    });
  });

  it('DOUBLE FIRST-PUBLISH CONCURRENCY: exactly one of two concurrent valid publish-selected calls succeeds', async () => {
    const { token, tenantId, instructorId } = await createInstructorTenant('double-first-publish');
    const courseId = await createCourseDirect(tenantId, instructorId);
    const sectionId = await createSectionDirect(tenantId, courseId, SectionStatus.DRAFT, 1);
    const videoAssetId = await createVideoAssetDirect(tenantId, instructorId, AssetProcessingStatus.READY);
    const lessonId = await createVideoLessonDirect(tenantId, courseId, sectionId, LessonStatus.DRAFT, videoAssetId, 1);

    const [first, second] = await Promise.all([
      publishSelected(tenantId, courseId, token, { sectionIds: [sectionId], lessonIds: [lessonId] }),
      publishSelected(tenantId, courseId, token, { sectionIds: [sectionId], lessonIds: [lessonId] }),
    ]);

    const conflictStatus: number = HttpStatus.CONFLICT;
    const okStatus: number = HttpStatus.OK;
    const statuses = [first.status, second.status].sort();
    expect(statuses).toEqual([conflictStatus, okStatus].sort());

    const conflictResponse = first.status === conflictStatus ? first : second;
    expect(responseBody<ErrorBody>(conflictResponse).error.code).toBe('COURSE_ALREADY_PUBLISHED_ONCE');

    await expect(prisma.client.course.findUniqueOrThrow({ where: { id: courseId } })).resolves.toMatchObject({
      status: CourseStatus.PUBLISHED,
    });
    await expect(prisma.client.courseSection.findUniqueOrThrow({ where: { id: sectionId } })).resolves.toMatchObject({
      status: SectionStatus.PUBLISHED,
    });
    await expect(prisma.client.lesson.findUniqueOrThrow({ where: { id: lessonId } })).resolves.toMatchObject({
      status: LessonStatus.PUBLISHED,
    });
  });

  it('QUIZ LOCK CONCURRENCY: racing publish-selected against a publishability-affecting Option mutation never yields a PUBLISHED, aggregate-invalid Quiz', async () => {
    const { token, tenantId, instructorId } = await createInstructorTenant('quiz-lock-race');
    const courseId = await createCourseDirect(tenantId, instructorId);
    const sectionId = await createSectionDirect(tenantId, courseId, SectionStatus.DRAFT, 1);
    const quizId = await createQuizDirect(tenantId, QuizStatus.DRAFT);
    const questionId = await createQuestionDirect(tenantId, quizId, QuestionType.TRUE_FALSE, QuestionStatus.ACTIVE);
    const correctOptionId = await createOptionDirect(tenantId, questionId, true, 1);
    await createOptionDirect(tenantId, questionId, false, 2);
    const lessonId = await createQuizLessonDirect(tenantId, courseId, sectionId, LessonStatus.DRAFT, quizId, 1);

    const [publishResponse, optionResponse] = await Promise.all([
      publishSelected(tenantId, courseId, token, { sectionIds: [sectionId], lessonIds: [lessonId] }),
      request(server)
        .patch(`/instructor/tenants/${tenantId}/quizzes/${quizId}/questions/${questionId}/options/${correctOptionId}`)
        .set('Authorization', `Bearer ${token}`)
        .send({ isCorrect: false }),
    ]);

    const quiz = await prisma.client.quiz.findUniqueOrThrow({ where: { id: quizId } });
    const options = await prisma.client.questionOption.findMany({ where: { questionId } });
    const correctCount = options.filter((option) => option.isCorrect).length;

    if (quiz.status === QuizStatus.PUBLISHED) {
      // publish-selected won the lock first: the Quiz aggregate must still be valid, and the
      // concurrent Option mutation that would have broken it must itself have been rejected.
      expect(correctCount).toBe(1);
      expect(publishResponse.status).toBe(HttpStatus.OK);
      expect(optionResponse.status).toBe(HttpStatus.CONFLICT);
    } else {
      // The Option mutation won the lock first: the Quiz is still DRAFT (exempt from the aggregate
      // check), the Option update succeeded, and publish-selected must have rejected the now-invalid
      // selection atomically rather than publishing an aggregate-invalid Quiz.
      expect(quiz.status).toBe(QuizStatus.DRAFT);
      expect(optionResponse.status).toBe(HttpStatus.OK);
      expect(publishResponse.status).toBe(HttpStatus.CONFLICT);
      await expect(prisma.client.lesson.findUniqueOrThrow({ where: { id: lessonId } })).resolves.toMatchObject({
        status: LessonStatus.DRAFT,
      });
    }
  });

  describe('GRANULAR LIFECYCLE RACE (selected Section/Lesson vs. an existing granular lifecycle endpoint)', () => {
    // Neither `archiveSection()` nor `archiveLesson()` ever rejects on a source-state mismatch —
    // both accept DRAFT or PUBLISHED as a valid source and simply re-read-and-return under a
    // conflicting concurrent write (see their unconditional `updateMany` + best-effort re-read,
    // with no affected-row-count check). publish-selected never itself sets a Section/Lesson to
    // ARCHIVED. So across every possible interleaving with the *one* concurrent archive call below,
    // the archive call always succeeds (200) and the targeted row always ends ARCHIVED — the
    // genuinely non-deterministic part is only whether publish-selected's own conditional mutation
    // commits before or after that archive, which is exactly the invariant under test. Both
    // requests are fully awaited (via `Promise.all`) before any assertion runs, so which branch
    // occurred is always known deterministically by the time we inspect the database — nothing
    // about the assertions themselves is racy.
    //
    // A companion Draft-Quiz Lesson is included in every selection below purely to widen the real,
    // production-code timing window between publish-selected's initial validation read and its
    // final conditional Section/Lesson `UPDATE` (extra genuine round trips: advisory-lock
    // acquisition, a Quiz fetch, and a Quiz `UPDATE`) — this uses only real request/response work,
    // not a test-only hook, and is the same "establish a real race window through genuine extra
    // work" technique already used by `QUIZ LOCK CONCURRENCY` above.

    it('SELECTED SECTION RACE: publish-selected vs. a granular archive of the exact selected Section', async () => {
      const { token, tenantId, instructorId } = await createInstructorTenant('section-race');
      const courseId = await createCourseDirect(tenantId, instructorId);
      const sectionId = await createSectionDirect(tenantId, courseId, SectionStatus.DRAFT, 1);

      const videoAssetId = await createVideoAssetDirect(tenantId, instructorId, AssetProcessingStatus.READY);
      const videoLessonId = await createVideoLessonDirect(tenantId, courseId, sectionId, LessonStatus.DRAFT, videoAssetId, 1);
      const quizId = await createValidQuizDirect(tenantId, QuizStatus.DRAFT);
      const quizLessonId = await createQuizLessonDirect(tenantId, courseId, sectionId, LessonStatus.DRAFT, quizId, 2);

      const [publishResponse, archiveResponse] = await Promise.all([
        publishSelected(tenantId, courseId, token, {
          sectionIds: [sectionId],
          lessonIds: [videoLessonId, quizLessonId],
        }),
        request(server)
          .post(`/instructor/tenants/${tenantId}/courses/${courseId}/sections/${sectionId}/archive`)
          .set('Authorization', `Bearer ${token}`),
      ]);

      // The granular archive is unaffected by this race either way — its own existing contract
      // (DRAFT or PUBLISHED are both valid archive sources) is honored regardless of ordering.
      expect(archiveResponse.status).toBe(HttpStatus.OK);
      await expect(prisma.client.courseSection.findUniqueOrThrow({ where: { id: sectionId } })).resolves.toMatchObject({
        status: SectionStatus.ARCHIVED,
      });

      const course = await prisma.client.course.findUniqueOrThrow({ where: { id: courseId } });

      if (course.status === CourseStatus.PUBLISHED) {
        // publish-selected's own conditional Section UPDATE committed first: the Course, the
        // Section (transiently, before the concurrent archive then moved it on to ARCHIVED per its
        // own unrelated contract), the Lesson, and the Quiz were all genuinely published.
        expect(publishResponse.status).toBe(HttpStatus.OK);
        expect(course.publishedAt).toEqual(NOW);
        await expect(prisma.client.lesson.findUniqueOrThrow({ where: { id: videoLessonId } })).resolves.toMatchObject({
          status: LessonStatus.PUBLISHED,
        });
        await expect(prisma.client.lesson.findUniqueOrThrow({ where: { id: quizLessonId } })).resolves.toMatchObject({
          status: LessonStatus.PUBLISHED,
        });
        await expect(prisma.client.quiz.findUniqueOrThrow({ where: { id: quizId } })).resolves.toMatchObject({
          status: QuizStatus.PUBLISHED,
        });
      } else {
        // The archive committed first (either before publish-selected's validation read — rejected
        // there as a stale SECTION_NOT_SELECTABLE blocker — or strictly between that read and
        // publish-selected's own conditional Section UPDATE, caught by the affected-row-count
        // re-check). Either way, publish-selected's ENTIRE transaction rolled back: the Course
        // first-publish claim is undone, and neither the video Lesson, the quiz Lesson, nor the
        // Quiz transitioned — no partial publication, no mixed impossible lifecycle state.
        expect(publishResponse.status).toBe(HttpStatus.CONFLICT);
        expect(responseBody<ErrorBody>(publishResponse).error.code).toBe('PUBLISH_SELECTION_STALE');
        expect(course.status).toBe(CourseStatus.DRAFT);
        expect(course.publishedAt).toBeNull();
        await expect(prisma.client.lesson.findUniqueOrThrow({ where: { id: videoLessonId } })).resolves.toMatchObject({
          status: LessonStatus.DRAFT,
        });
        await expect(prisma.client.lesson.findUniqueOrThrow({ where: { id: quizLessonId } })).resolves.toMatchObject({
          status: LessonStatus.DRAFT,
        });
        await expect(prisma.client.quiz.findUniqueOrThrow({ where: { id: quizId } })).resolves.toMatchObject({
          status: QuizStatus.DRAFT,
        });
      }
    });

    it('SELECTED LESSON RACE: publish-selected vs. a granular archive of the exact selected Lesson', async () => {
      const { token, tenantId, instructorId } = await createInstructorTenant('lesson-race');
      const courseId = await createCourseDirect(tenantId, instructorId);
      const sectionId = await createSectionDirect(tenantId, courseId, SectionStatus.DRAFT, 1);

      const videoAssetId = await createVideoAssetDirect(tenantId, instructorId, AssetProcessingStatus.READY);
      const targetLessonId = await createVideoLessonDirect(tenantId, courseId, sectionId, LessonStatus.DRAFT, videoAssetId, 1);
      const quizId = await createValidQuizDirect(tenantId, QuizStatus.DRAFT);
      const quizLessonId = await createQuizLessonDirect(tenantId, courseId, sectionId, LessonStatus.DRAFT, quizId, 2);

      // An unselected sibling Lesson under the same Section, to also prove unrelated/unselected
      // rows stay untouched regardless of which branch of the race occurs.
      const unselectedVideoAssetId = await createVideoAssetDirect(tenantId, instructorId, AssetProcessingStatus.READY);
      const unselectedLessonId = await createVideoLessonDirect(
        tenantId,
        courseId,
        sectionId,
        LessonStatus.DRAFT,
        unselectedVideoAssetId,
        3,
      );

      const [publishResponse, archiveResponse] = await Promise.all([
        publishSelected(tenantId, courseId, token, {
          sectionIds: [sectionId],
          lessonIds: [targetLessonId, quizLessonId],
        }),
        request(server)
          .post(
            `/instructor/tenants/${tenantId}/courses/${courseId}/sections/${sectionId}/lessons/${targetLessonId}/archive`,
          )
          .set('Authorization', `Bearer ${token}`),
      ]);

      // Same reasoning as the Section race: `archiveLesson()` accepts DRAFT or PUBLISHED as a
      // valid source and never rejects on this race, regardless of ordering.
      expect(archiveResponse.status).toBe(HttpStatus.OK);
      await expect(prisma.client.lesson.findUniqueOrThrow({ where: { id: targetLessonId } })).resolves.toMatchObject({
        status: LessonStatus.ARCHIVED,
      });

      const course = await prisma.client.course.findUniqueOrThrow({ where: { id: courseId } });

      if (course.status === CourseStatus.PUBLISHED) {
        // publish-selected's own conditional Lesson UPDATE committed first (the target Lesson was
        // genuinely PUBLISHED before the concurrent archive then moved it on, per its own
        // unrelated, unchanged contract). The Section and the companion Quiz Lesson/Quiz were
        // genuinely published too.
        expect(publishResponse.status).toBe(HttpStatus.OK);
        await expect(prisma.client.courseSection.findUniqueOrThrow({ where: { id: sectionId } })).resolves.toMatchObject({
          status: SectionStatus.PUBLISHED,
        });
        await expect(prisma.client.lesson.findUniqueOrThrow({ where: { id: quizLessonId } })).resolves.toMatchObject({
          status: LessonStatus.PUBLISHED,
        });
        await expect(prisma.client.quiz.findUniqueOrThrow({ where: { id: quizId } })).resolves.toMatchObject({
          status: QuizStatus.PUBLISHED,
        });
      } else {
        // The archive committed first — either observed at publish-selected's initial validation
        // read (a stale LESSON_NOT_SELECTABLE blocker) or caught only by the final
        // affected-row-count re-check on publish-selected's own conditional Lesson `UPDATE`
        // (`updatedLessons.count !== submittedLessonIds.length`), which is exactly the
        // previously-untested defensive path this test exists to exercise. Either way,
        // publish-selected's ENTIRE transaction rolled back: the Course stays DRAFT/unpublished,
        // and neither the Section nor the companion Quiz Lesson/Quiz transitioned.
        expect(publishResponse.status).toBe(HttpStatus.CONFLICT);
        expect(responseBody<ErrorBody>(publishResponse).error.code).toBe('PUBLISH_SELECTION_STALE');
        expect(course.status).toBe(CourseStatus.DRAFT);
        expect(course.publishedAt).toBeNull();
        await expect(prisma.client.courseSection.findUniqueOrThrow({ where: { id: sectionId } })).resolves.toMatchObject({
          status: SectionStatus.DRAFT,
        });
        await expect(prisma.client.lesson.findUniqueOrThrow({ where: { id: quizLessonId } })).resolves.toMatchObject({
          status: LessonStatus.DRAFT,
        });
        await expect(prisma.client.quiz.findUniqueOrThrow({ where: { id: quizId } })).resolves.toMatchObject({
          status: QuizStatus.DRAFT,
        });
      }

      // Unrelated/unselected sibling Lesson is untouched regardless of which branch occurred.
      await expect(prisma.client.lesson.findUniqueOrThrow({ where: { id: unselectedLessonId } })).resolves.toMatchObject({
        status: LessonStatus.DRAFT,
      });
    });
  });

  it('ATOMIC ROLLBACK: zero selected entities transition when one item in an otherwise-valid selection is stale', async () => {
    const { token, tenantId, instructorId } = await createInstructorTenant('atomic-rollback');
    const courseId = await createCourseDirect(tenantId, instructorId);
    const sectionId = await createSectionDirect(tenantId, courseId, SectionStatus.DRAFT, 1);

    const readyVideoAssetId = await createVideoAssetDirect(tenantId, instructorId, AssetProcessingStatus.READY);
    const validLessonId = await createVideoLessonDirect(tenantId, courseId, sectionId, LessonStatus.DRAFT, readyVideoAssetId, 1);
    const validDraftQuizId = await createValidQuizDirect(tenantId, QuizStatus.DRAFT);
    const validQuizLessonId = await createQuizLessonDirect(tenantId, courseId, sectionId, LessonStatus.DRAFT, validDraftQuizId, 2);

    const failedVideoAssetId = await createVideoAssetDirect(tenantId, instructorId, AssetProcessingStatus.FAILED);
    const staleLessonId = await createVideoLessonDirect(tenantId, courseId, sectionId, LessonStatus.DRAFT, failedVideoAssetId, 3);

    const response = await publishSelected(tenantId, courseId, token, {
      sectionIds: [sectionId],
      lessonIds: [validLessonId, validQuizLessonId, staleLessonId],
    }).expect(HttpStatus.CONFLICT);

    expect(responseBody<ErrorBody>(response).error.code).toBe('PUBLISH_SELECTION_STALE');

    await expect(prisma.client.course.findUniqueOrThrow({ where: { id: courseId } })).resolves.toMatchObject({
      status: CourseStatus.DRAFT,
      publishedAt: null,
    });
    await expect(prisma.client.courseSection.findUniqueOrThrow({ where: { id: sectionId } })).resolves.toMatchObject({
      status: SectionStatus.DRAFT,
    });
    for (const lessonId of [validLessonId, validQuizLessonId, staleLessonId]) {
      await expect(prisma.client.lesson.findUniqueOrThrow({ where: { id: lessonId } })).resolves.toMatchObject({
        status: LessonStatus.DRAFT,
      });
    }
    await expect(prisma.client.quiz.findUniqueOrThrow({ where: { id: validDraftQuizId } })).resolves.toMatchObject({
      status: QuizStatus.DRAFT,
    });
  });

  it('NO UNSELECTED SWEEP: every unselected ready Section/Lesson/Quiz remains exactly unchanged', async () => {
    const { token, tenantId, instructorId } = await createInstructorTenant('no-sweep');
    const courseId = await createCourseDirect(tenantId, instructorId);

    const selectedSectionId = await createSectionDirect(tenantId, courseId, SectionStatus.DRAFT, 1);
    const selectedVideoAssetId = await createVideoAssetDirect(tenantId, instructorId, AssetProcessingStatus.READY);
    const selectedLessonId = await createVideoLessonDirect(
      tenantId,
      courseId,
      selectedSectionId,
      LessonStatus.DRAFT,
      selectedVideoAssetId,
      1,
    );

    // Several other ready-and-otherwise-selectable Sections/Lessons/Quizzes, deliberately not
    // submitted.
    const unselectedSectionId = await createSectionDirect(tenantId, courseId, SectionStatus.DRAFT, 2);
    const unselectedVideoAssetId = await createVideoAssetDirect(tenantId, instructorId, AssetProcessingStatus.READY);
    const unselectedVideoLessonId = await createVideoLessonDirect(
      tenantId,
      courseId,
      unselectedSectionId,
      LessonStatus.DRAFT,
      unselectedVideoAssetId,
      1,
    );
    const unselectedDraftQuizId = await createValidQuizDirect(tenantId, QuizStatus.DRAFT);
    const unselectedQuizLessonId = await createQuizLessonDirect(
      tenantId,
      courseId,
      unselectedSectionId,
      LessonStatus.DRAFT,
      unselectedDraftQuizId,
      2,
    );

    await publishSelected(tenantId, courseId, token, {
      sectionIds: [selectedSectionId],
      lessonIds: [selectedLessonId],
    }).expect(HttpStatus.OK);

    await expect(prisma.client.courseSection.findUniqueOrThrow({ where: { id: unselectedSectionId } })).resolves.toMatchObject({
      status: SectionStatus.DRAFT,
    });
    await expect(prisma.client.lesson.findUniqueOrThrow({ where: { id: unselectedVideoLessonId } })).resolves.toMatchObject({
      status: LessonStatus.DRAFT,
    });
    await expect(prisma.client.lesson.findUniqueOrThrow({ where: { id: unselectedQuizLessonId } })).resolves.toMatchObject({
      status: LessonStatus.DRAFT,
    });
    await expect(prisma.client.quiz.findUniqueOrThrow({ where: { id: unselectedDraftQuizId } })).resolves.toMatchObject({
      status: QuizStatus.DRAFT,
    });
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
    await prisma.client.tenant.deleteMany({ where: { slug: { startsWith: 'publish-selected-test-' } } });
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

  async function createInstructorTenant(
    suffix: string,
  ): Promise<{ instructorId: string; tenantId: string; token: string }> {
    const instructorId = await createUser(`instructor-${suffix}`, PlatformRole.INSTRUCTOR);
    await prisma.client.instructorProfile.create({ data: { id: uuid.create(), userId: instructorId } });
    const tenant = await prisma.client.tenant.create({
      data: {
        id: uuid.create(),
        name: `Publish Selected Tenant ${suffix}`,
        slug: `publish-selected-test-${suffix}`,
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

  async function createCourseDirect(
    tenantId: string,
    createdByUserId: string,
    overrides: { status?: CourseStatus; publishedAt?: Date | null } = {},
  ): Promise<string> {
    const id = uuid.create();
    await prisma.client.course.create({
      data: {
        id,
        tenantId,
        createdByUserId,
        title: `Course ${id}`,
        status: overrides.status ?? CourseStatus.DRAFT,
        publishedAt: overrides.publishedAt ?? null,
      },
    });
    return id;
  }

  async function createSectionDirect(
    tenantId: string,
    courseId: string,
    status: SectionStatus,
    position: number,
  ): Promise<string> {
    const id = uuid.create();
    await prisma.client.courseSection.create({
      data: { id, tenantId, courseId, title: `Section ${id}`, position, status },
    });
    return id;
  }

  async function createVideoAssetDirect(
    tenantId: string,
    uploadedByUserId: string,
    processingStatus: AssetProcessingStatus,
  ): Promise<string> {
    const id = uuid.create();
    await prisma.client.videoAsset.create({
      data: {
        id,
        tenantId,
        uploadedByUserId,
        externalAssetRef: `test-provider/video/${id}`,
        processingStatus,
        ...(processingStatus === AssetProcessingStatus.FAILED ? { failureCode: 'TEST_FAILURE_CODE' } : {}),
      },
    });
    return id;
  }

  async function createDocumentAssetDirect(
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

  async function createVideoLessonDirect(
    tenantId: string,
    courseId: string,
    sectionId: string,
    status: LessonStatus,
    videoAssetId: string,
    position: number,
  ): Promise<string> {
    const id = uuid.create();
    await prisma.client.lesson.create({
      data: { id, tenantId, courseId, sectionId, title: `Lesson ${id}`, position, type: LessonType.VIDEO, status },
    });
    await prisma.client.videoLesson.create({ data: { lessonId: id, tenantId, videoAssetId } });
    return id;
  }

  async function createDocumentLessonDirect(
    tenantId: string,
    courseId: string,
    sectionId: string,
    status: LessonStatus,
    documentAssetId: string,
    position: number,
  ): Promise<string> {
    const id = uuid.create();
    await prisma.client.lesson.create({
      data: { id, tenantId, courseId, sectionId, title: `Lesson ${id}`, position, type: LessonType.DOCUMENT, status },
    });
    await prisma.client.documentLesson.create({ data: { lessonId: id, tenantId, documentAssetId } });
    return id;
  }

  async function createQuizLessonDirect(
    tenantId: string,
    courseId: string,
    sectionId: string,
    status: LessonStatus,
    quizId: string,
    position: number,
  ): Promise<string> {
    const id = uuid.create();
    await prisma.client.lesson.create({
      data: { id, tenantId, courseId, sectionId, title: `Lesson ${id}`, position, type: LessonType.QUIZ, status },
    });
    await prisma.client.quizLesson.create({ data: { lessonId: id, tenantId, quizId } });
    return id;
  }

  async function createQuizDirect(tenantId: string, status: QuizStatus): Promise<string> {
    const id = uuid.create();
    await prisma.client.quiz.create({ data: { id, tenantId, title: `Quiz ${id}`, status } });
    return id;
  }

  async function createValidQuizDirect(tenantId: string, status: QuizStatus): Promise<string> {
    const quizId = await createQuizDirect(tenantId, status);
    const questionId = await createQuestionDirect(tenantId, quizId, QuestionType.TRUE_FALSE, QuestionStatus.ACTIVE);
    await createOptionDirect(tenantId, questionId, true, 1);
    await createOptionDirect(tenantId, questionId, false, 2);
    return quizId;
  }

  async function createQuestionDirect(
    tenantId: string,
    quizId: string,
    type: QuestionType,
    status: QuestionStatus,
    points = 1,
  ): Promise<string> {
    const id = uuid.create();
    const position = (await prisma.client.question.count({ where: { quizId } })) + 1;
    await prisma.client.question.create({
      data: { id, tenantId, quizId, type, prompt: `Question ${id}`, position, points, status },
    });
    return id;
  }

  async function createOptionDirect(
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

  async function issueAccessToken(userId: string, platformRole: PlatformRole): Promise<string> {
    const session = await refreshSessions.createSession({ userId, channel: 'MOBILE' });
    return accessTokens.sign({ userId, sessionId: session.sessionId, platformRole });
  }
});

function responseBody<T>(response: request.Response): T {
  return response.body as T;
}
