import { HttpStatus, INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import * as cookieParser from 'cookie-parser';
import * as request from 'supertest';
import type { App } from 'supertest/types';
import {
  AccountStatus,
  AssetProcessingStatus,
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

type CourseReadinessBody = {
  courseId: string;
  ready: boolean;
  computedAt: string;
  blockers: ReadinessIssueBody[];
  advisories: ReadinessIssueBody[];
  readyToPublish: {
    sections: Array<{ sectionId: string; title: string }>;
    lessons: Array<{ lessonId: string; sectionId: string; title: string; type: string }>;
    quizzes: Array<{ quizId: string; lessonId: string; title: string }>;
  };
};

maybeDescribe('instructor Course Readiness HTTP PostgreSQL integration', () => {
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
    uuid = moduleRef.get(UuidV7Service);

    await clearData();
  });

  afterEach(async () => {
    await clearData();
    await app?.close();
  });

  it('returns deterministic, empty readiness for a Course with no Sections (ready === false)', async () => {
    const { token, tenantId, instructorId } = await createInstructorTenant('empty');
    const courseId = await createCourseDirect(tenantId, instructorId);

    const response = await request(server)
      .get(`/instructor/tenants/${tenantId}/courses/${courseId}/readiness`)
      .set('Authorization', `Bearer ${token}`)
      .expect(HttpStatus.OK);

    const body = responseBody(response);
    expect(body.courseId).toBe(courseId);
    expect(body.ready).toBe(false);
    expect(body.blockers).toEqual([]);
    expect(body.advisories).toEqual([]);
    expect(body.readyToPublish).toEqual({ sections: [], lessons: [], quizzes: [] });
    expect(new Date(body.computedAt).toISOString()).toBe(NOW.toISOString());
  });

  describe('authorization', () => {
    it('allows the owning tenant instructor and returns tenant-scoped course readiness', async () => {
      const { token, tenantId, instructorId } = await createInstructorTenant('owner');
      const courseId = await createCourseDirect(tenantId, instructorId);
      await createSectionDirect(tenantId, courseId, SectionStatus.PUBLISHED, 1);

      const response = await request(server)
        .get(`/instructor/tenants/${tenantId}/courses/${courseId}/readiness`)
        .set('Authorization', `Bearer ${token}`)
        .expect(HttpStatus.OK);

      expect(responseBody(response).courseId).toBe(courseId);
    });

    it('does not leak existence across tenants and denies membership mismatch without a 404/403 distinction that reveals data', async () => {
      const { tenantId, instructorId } = await createInstructorTenant('victim');
      const { token: otherToken } = await createInstructorTenant('attacker');
      const courseId = await createCourseDirect(tenantId, instructorId);

      // Attacker has no membership in the victim's tenant: membership check fails first (FORBIDDEN),
      // matching every other instructor Course route's authorization ordering.
      await request(server)
        .get(`/instructor/tenants/${tenantId}/courses/${courseId}/readiness`)
        .set('Authorization', `Bearer ${otherToken}`)
        .expect(HttpStatus.FORBIDDEN);

      // A random/foreign courseId under the attacker's own authorized tenant resolves to the same
      // COURSE_NOT_FOUND as a truly nonexistent course — no leakage of "exists in another tenant".
      const { tenantId: attackerTenantId, token: attackerOwnToken } = await createInstructorTenant('attacker-2');
      const notFound = await request(server)
        .get(`/instructor/tenants/${attackerTenantId}/courses/${courseId}/readiness`)
        .set('Authorization', `Bearer ${attackerOwnToken}`)
        .expect(HttpStatus.NOT_FOUND);
      expect(notFound.body).toMatchObject({ error: { code: 'COURSE_NOT_FOUND' } });
    });

    it('rejects student and platform admin callers', async () => {
      const { tenantId, instructorId } = await createInstructorTenant('role-guard');
      const courseId = await createCourseDirect(tenantId, instructorId);
      const studentId = await createUser('readiness-student', PlatformRole.STUDENT);
      const adminId = await createUser('readiness-admin', PlatformRole.PLATFORM_ADMIN);
      const studentToken = await issueAccessToken(studentId, PlatformRole.STUDENT);
      const adminToken = await issueAccessToken(adminId, PlatformRole.PLATFORM_ADMIN);

      await request(server)
        .get(`/instructor/tenants/${tenantId}/courses/${courseId}/readiness`)
        .set('Authorization', `Bearer ${studentToken}`)
        .expect(HttpStatus.FORBIDDEN);

      await request(server)
        .get(`/instructor/tenants/${tenantId}/courses/${courseId}/readiness`)
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(HttpStatus.FORBIDDEN);
    });

    it('returns COURSE_NOT_FOUND for a nonexistent course', async () => {
      const { token, tenantId } = await createInstructorTenant('missing-course');

      const response = await request(server)
        .get(`/instructor/tenants/${tenantId}/courses/${uuid.create()}/readiness`)
        .set('Authorization', `Bearer ${token}`)
        .expect(HttpStatus.NOT_FOUND);
      expect(response.body).toMatchObject({ error: { code: 'COURSE_NOT_FOUND' } });
    });
  });

  describe('Section candidacy (progressive authoring — DRAFT is the expected first-publish state)', () => {
    it('a brand-new DRAFT Section with a valid DRAFT Lesson is a first-publish candidate, with no DRAFT-lifecycle blocker', async () => {
      const { token, tenantId, instructorId } = await createInstructorTenant('section-draft-candidate');
      const courseId = await createCourseDirect(tenantId, instructorId);
      const sectionId = await createSectionDirect(tenantId, courseId, SectionStatus.DRAFT, 1);
      const videoAssetId = await createVideoAssetDirect(tenantId, instructorId, AssetProcessingStatus.READY);
      const lessonId = await createVideoLessonDirect(tenantId, courseId, sectionId, LessonStatus.DRAFT, videoAssetId, 1);

      const response = await request(server)
        .get(`/instructor/tenants/${tenantId}/courses/${courseId}/readiness`)
        .set('Authorization', `Bearer ${token}`)
        .expect(HttpStatus.OK);

      const body = responseBody(response);
      expect(body.blockers).toEqual([]);
      expect(body.ready).toBe(true);
      expect(body.readyToPublish.sections).toEqual([{ sectionId, title: `Section ${sectionId}` }]);
      expect(body.readyToPublish.lessons).toEqual([
        { lessonId, sectionId, title: `Lesson ${lessonId}`, type: 'VIDEO' },
      ]);
    });

    it('an empty DRAFT Section (no Lessons) is not a candidate and is reported as SECTION_EMPTY, not a DRAFT blocker', async () => {
      const { token, tenantId, instructorId } = await createInstructorTenant('section-empty-draft');
      const courseId = await createCourseDirect(tenantId, instructorId);
      const sectionId = await createSectionDirect(tenantId, courseId, SectionStatus.DRAFT, 1);

      const response = await request(server)
        .get(`/instructor/tenants/${tenantId}/courses/${courseId}/readiness`)
        .set('Authorization', `Bearer ${token}`)
        .expect(HttpStatus.OK);

      const body = responseBody(response);
      expect(body.blockers).toEqual([]);
      expect(body.advisories).toEqual([
        { reasonCode: 'SECTION_EMPTY', entityType: 'SECTION', entityId: sectionId, title: `Section ${sectionId}` },
      ]);
      expect(body.readyToPublish.sections).toEqual([]);
      expect(body.ready).toBe(false);
    });

    it('a DRAFT Section containing only unready Lessons is not a candidate; ready stays false if no other path exists', async () => {
      const { token, tenantId, instructorId } = await createInstructorTenant('section-only-unready');
      const courseId = await createCourseDirect(tenantId, instructorId);
      const sectionId = await createSectionDirect(tenantId, courseId, SectionStatus.DRAFT, 1);
      const videoAssetId = await createVideoAssetDirect(tenantId, instructorId, AssetProcessingStatus.PROCESSING);
      await createVideoLessonDirect(tenantId, courseId, sectionId, LessonStatus.DRAFT, videoAssetId, 1);

      const response = await request(server)
        .get(`/instructor/tenants/${tenantId}/courses/${courseId}/readiness`)
        .set('Authorization', `Bearer ${token}`)
        .expect(HttpStatus.OK);

      const body = responseBody(response);
      expect(body.advisories).toEqual([]);
      expect(body.readyToPublish.sections).toEqual([]);
      expect(body.readyToPublish.lessons).toEqual([]);
      expect(body.ready).toBe(false);
      expect(body.blockers).toEqual([expect.objectContaining({ reasonCode: 'VIDEO_PREPARING' })]);
    });

    it('an already-PUBLISHED Section is excluded from candidates (nothing to transition), even with an empty-Section advisory', async () => {
      const { token, tenantId, instructorId } = await createInstructorTenant('section-published-excluded');
      const courseId = await createCourseDirect(tenantId, instructorId);
      const sectionId = await createSectionDirect(tenantId, courseId, SectionStatus.PUBLISHED, 1);

      const response = await request(server)
        .get(`/instructor/tenants/${tenantId}/courses/${courseId}/readiness`)
        .set('Authorization', `Bearer ${token}`)
        .expect(HttpStatus.OK);

      const body = responseBody(response);
      expect(body.advisories).toEqual([
        { reasonCode: 'SECTION_EMPTY', entityType: 'SECTION', entityId: sectionId, title: `Section ${sectionId}` },
      ]);
      expect(body.readyToPublish.sections).toEqual([]);
      expect(body.ready).toBe(false);
    });

    it('a DRAFT Lesson under an already-PUBLISHED Section is still a valid Lesson candidate, without its Section needing to appear in readyToPublish.sections', async () => {
      const { token, tenantId, instructorId } = await createInstructorTenant('published-section-draft-lesson');
      const courseId = await createCourseDirect(tenantId, instructorId);
      const sectionId = await createSectionDirect(tenantId, courseId, SectionStatus.PUBLISHED, 1);
      const videoAssetId = await createVideoAssetDirect(tenantId, instructorId, AssetProcessingStatus.READY);
      const lessonId = await createVideoLessonDirect(tenantId, courseId, sectionId, LessonStatus.DRAFT, videoAssetId, 1);

      const response = await request(server)
        .get(`/instructor/tenants/${tenantId}/courses/${courseId}/readiness`)
        .set('Authorization', `Bearer ${token}`)
        .expect(HttpStatus.OK);

      const body = responseBody(response);
      expect(body.blockers).toEqual([]);
      expect(body.readyToPublish.lessons).toEqual([
        { lessonId, sectionId, title: `Lesson ${lessonId}`, type: 'VIDEO' },
      ]);
      expect(body.readyToPublish.sections).toEqual([]);
      expect(body.ready).toBe(true);
    });
  });

  describe('Lesson candidacy', () => {
    it('excludes an already-PUBLISHED Lesson from candidates (no transition needed) without emitting a blocker for it', async () => {
      const { token, tenantId, instructorId } = await createInstructorTenant('lesson-published-excluded');
      const courseId = await createCourseDirect(tenantId, instructorId);
      const sectionId = await createSectionDirect(tenantId, courseId, SectionStatus.PUBLISHED, 1);
      const videoAssetId = await createVideoAssetDirect(tenantId, instructorId, AssetProcessingStatus.READY);
      await createVideoLessonDirect(tenantId, courseId, sectionId, LessonStatus.PUBLISHED, videoAssetId, 1);

      const response = await request(server)
        .get(`/instructor/tenants/${tenantId}/courses/${courseId}/readiness`)
        .set('Authorization', `Bearer ${token}`)
        .expect(HttpStatus.OK);

      const body = responseBody(response);
      expect(body.blockers).toEqual([]);
      expect(body.readyToPublish.lessons).toEqual([]);
      expect(body.ready).toBe(false);
    });

    it('still reports a content blocker for an already-PUBLISHED Lesson whose content later failed (diagnostic value, not a candidacy gate)', async () => {
      const { token, tenantId, instructorId } = await createInstructorTenant('lesson-published-failed-diagnostic');
      const courseId = await createCourseDirect(tenantId, instructorId);
      const sectionId = await createSectionDirect(tenantId, courseId, SectionStatus.PUBLISHED, 1);
      const videoAssetId = await createVideoAssetDirect(tenantId, instructorId, AssetProcessingStatus.FAILED);
      await createVideoLessonDirect(tenantId, courseId, sectionId, LessonStatus.PUBLISHED, videoAssetId, 1);

      const response = await request(server)
        .get(`/instructor/tenants/${tenantId}/courses/${courseId}/readiness`)
        .set('Authorization', `Bearer ${token}`)
        .expect(HttpStatus.OK);

      expect(responseBody(response).blockers).toEqual([
        expect.objectContaining({ reasonCode: 'VIDEO_FAILED', entityType: 'VIDEO_ASSET', entityId: videoAssetId }),
      ]);
    });
  });

  describe('Video lesson content readiness', () => {
    it('a DRAFT Lesson with an exact READY VideoAsset is a candidate', async () => {
      const { token, tenantId, instructorId } = await createInstructorTenant('video-ready');
      const courseId = await createCourseDirect(tenantId, instructorId);
      const sectionId = await createSectionDirect(tenantId, courseId, SectionStatus.DRAFT, 1);
      const videoAssetId = await createVideoAssetDirect(tenantId, instructorId, AssetProcessingStatus.READY);
      const lessonId = await createVideoLessonDirect(tenantId, courseId, sectionId, LessonStatus.DRAFT, videoAssetId, 1);

      const response = await request(server)
        .get(`/instructor/tenants/${tenantId}/courses/${courseId}/readiness`)
        .set('Authorization', `Bearer ${token}`)
        .expect(HttpStatus.OK);

      const body = responseBody(response);
      expect(body.blockers).toEqual([]);
      expect(body.readyToPublish.lessons).toEqual([
        { lessonId, sectionId, title: `Lesson ${lessonId}`, type: 'VIDEO' },
      ]);
    });

    it.each([AssetProcessingStatus.UPLOADING, AssetProcessingStatus.PROCESSING])(
      'reports VIDEO_PREPARING for %s and excludes the Lesson from candidates',
      async (processingStatus) => {
        const { token, tenantId, instructorId } = await createInstructorTenant(`video-preparing-${processingStatus}`);
        const courseId = await createCourseDirect(tenantId, instructorId);
        const sectionId = await createSectionDirect(tenantId, courseId, SectionStatus.DRAFT, 1);
        const videoAssetId = await createVideoAssetDirect(tenantId, instructorId, processingStatus);
        await createVideoLessonDirect(tenantId, courseId, sectionId, LessonStatus.DRAFT, videoAssetId, 1);

        const response = await request(server)
          .get(`/instructor/tenants/${tenantId}/courses/${courseId}/readiness`)
          .set('Authorization', `Bearer ${token}`)
          .expect(HttpStatus.OK);

        const body = responseBody(response);
        expect(body.blockers).toEqual([
          expect.objectContaining({ reasonCode: 'VIDEO_PREPARING', entityType: 'VIDEO_ASSET', entityId: videoAssetId }),
        ]);
        expect(body.readyToPublish.lessons).toEqual([]);
      },
    );

    it('reports VIDEO_FAILED for a failed VideoAsset and excludes the Lesson from candidates', async () => {
      const { token, tenantId, instructorId } = await createInstructorTenant('video-failed');
      const courseId = await createCourseDirect(tenantId, instructorId);
      const sectionId = await createSectionDirect(tenantId, courseId, SectionStatus.DRAFT, 1);
      const videoAssetId = await createVideoAssetDirect(tenantId, instructorId, AssetProcessingStatus.FAILED);
      await createVideoLessonDirect(tenantId, courseId, sectionId, LessonStatus.DRAFT, videoAssetId, 1);

      const response = await request(server)
        .get(`/instructor/tenants/${tenantId}/courses/${courseId}/readiness`)
        .set('Authorization', `Bearer ${token}`)
        .expect(HttpStatus.OK);

      const body = responseBody(response);
      expect(body.blockers).toEqual([
        expect.objectContaining({ reasonCode: 'VIDEO_FAILED', entityType: 'VIDEO_ASSET', entityId: videoAssetId }),
      ]);
      expect(body.readyToPublish.lessons).toEqual([]);
    });

    it('reports VIDEO_ASSET_ARCHIVED for an archived VideoAsset and excludes the Lesson from candidates', async () => {
      const { token, tenantId, instructorId } = await createInstructorTenant('video-archived');
      const courseId = await createCourseDirect(tenantId, instructorId);
      const sectionId = await createSectionDirect(tenantId, courseId, SectionStatus.DRAFT, 1);
      const videoAssetId = await createVideoAssetDirect(tenantId, instructorId, AssetProcessingStatus.ARCHIVED);
      await createVideoLessonDirect(tenantId, courseId, sectionId, LessonStatus.DRAFT, videoAssetId, 1);

      const response = await request(server)
        .get(`/instructor/tenants/${tenantId}/courses/${courseId}/readiness`)
        .set('Authorization', `Bearer ${token}`)
        .expect(HttpStatus.OK);

      const body = responseBody(response);
      expect(body.blockers).toEqual([
        expect.objectContaining({ reasonCode: 'VIDEO_ASSET_ARCHIVED', entityType: 'VIDEO_ASSET', entityId: videoAssetId }),
      ]);
      expect(body.readyToPublish.lessons).toEqual([]);
    });
  });

  describe('Document lesson content readiness', () => {
    it('a DRAFT Lesson with an exact READY DocumentAsset is a candidate', async () => {
      const { token, tenantId, instructorId } = await createInstructorTenant('document-ready');
      const courseId = await createCourseDirect(tenantId, instructorId);
      const sectionId = await createSectionDirect(tenantId, courseId, SectionStatus.DRAFT, 1);
      const documentAssetId = await createDocumentAssetDirect(tenantId, instructorId, AssetProcessingStatus.READY);
      const lessonId = await createDocumentLessonDirect(
        tenantId,
        courseId,
        sectionId,
        LessonStatus.DRAFT,
        documentAssetId,
        1,
      );

      const response = await request(server)
        .get(`/instructor/tenants/${tenantId}/courses/${courseId}/readiness`)
        .set('Authorization', `Bearer ${token}`)
        .expect(HttpStatus.OK);

      const body = responseBody(response);
      expect(body.blockers).toEqual([]);
      expect(body.readyToPublish.lessons).toEqual([
        { lessonId, sectionId, title: `Lesson ${lessonId}`, type: 'DOCUMENT' },
      ]);
    });

    it('reports DOCUMENT_PREPARING while uploading and excludes the Lesson from candidates', async () => {
      const { token, tenantId, instructorId } = await createInstructorTenant('document-preparing');
      const courseId = await createCourseDirect(tenantId, instructorId);
      const sectionId = await createSectionDirect(tenantId, courseId, SectionStatus.DRAFT, 1);
      const documentAssetId = await createDocumentAssetDirect(tenantId, instructorId, AssetProcessingStatus.UPLOADING);
      await createDocumentLessonDirect(tenantId, courseId, sectionId, LessonStatus.DRAFT, documentAssetId, 1);

      const response = await request(server)
        .get(`/instructor/tenants/${tenantId}/courses/${courseId}/readiness`)
        .set('Authorization', `Bearer ${token}`)
        .expect(HttpStatus.OK);

      const body = responseBody(response);
      expect(body.blockers).toEqual([
        expect.objectContaining({ reasonCode: 'DOCUMENT_PREPARING', entityType: 'DOCUMENT_ASSET', entityId: documentAssetId }),
      ]);
      expect(body.readyToPublish.lessons).toEqual([]);
    });

    it('reports DOCUMENT_FAILED for a failed DocumentAsset and excludes the Lesson from candidates', async () => {
      const { token, tenantId, instructorId } = await createInstructorTenant('document-failed');
      const courseId = await createCourseDirect(tenantId, instructorId);
      const sectionId = await createSectionDirect(tenantId, courseId, SectionStatus.DRAFT, 1);
      const documentAssetId = await createDocumentAssetDirect(tenantId, instructorId, AssetProcessingStatus.FAILED);
      await createDocumentLessonDirect(tenantId, courseId, sectionId, LessonStatus.DRAFT, documentAssetId, 1);

      const response = await request(server)
        .get(`/instructor/tenants/${tenantId}/courses/${courseId}/readiness`)
        .set('Authorization', `Bearer ${token}`)
        .expect(HttpStatus.OK);

      const body = responseBody(response);
      expect(body.blockers).toEqual([
        expect.objectContaining({ reasonCode: 'DOCUMENT_FAILED', entityType: 'DOCUMENT_ASSET', entityId: documentAssetId }),
      ]);
      expect(body.readyToPublish.lessons).toEqual([]);
    });

    it('reports DOCUMENT_ASSET_ARCHIVED for an archived DocumentAsset and excludes the Lesson from candidates', async () => {
      const { token, tenantId, instructorId } = await createInstructorTenant('document-archived');
      const courseId = await createCourseDirect(tenantId, instructorId);
      const sectionId = await createSectionDirect(tenantId, courseId, SectionStatus.DRAFT, 1);
      const documentAssetId = await createDocumentAssetDirect(tenantId, instructorId, AssetProcessingStatus.ARCHIVED);
      await createDocumentLessonDirect(tenantId, courseId, sectionId, LessonStatus.DRAFT, documentAssetId, 1);

      const response = await request(server)
        .get(`/instructor/tenants/${tenantId}/courses/${courseId}/readiness`)
        .set('Authorization', `Bearer ${token}`)
        .expect(HttpStatus.OK);

      const body = responseBody(response);
      expect(body.blockers).toEqual([
        expect.objectContaining({ reasonCode: 'DOCUMENT_ASSET_ARCHIVED', entityType: 'DOCUMENT_ASSET', entityId: documentAssetId }),
      ]);
      expect(body.readyToPublish.lessons).toEqual([]);
    });
  });

  describe('Quiz lesson content readiness', () => {
    it('a DRAFT Lesson referencing an already-PUBLISHED valid Quiz is a candidate, and the Quiz does NOT appear in readyToPublish.quizzes (no transition needed)', async () => {
      const { token, tenantId, instructorId } = await createInstructorTenant('quiz-published');
      const courseId = await createCourseDirect(tenantId, instructorId);
      const sectionId = await createSectionDirect(tenantId, courseId, SectionStatus.DRAFT, 1);
      const quizId = await createValidQuizDirect(tenantId, QuizStatus.PUBLISHED);
      const lessonId = await createQuizLessonDirect(tenantId, courseId, sectionId, LessonStatus.DRAFT, quizId, 1);

      const response = await request(server)
        .get(`/instructor/tenants/${tenantId}/courses/${courseId}/readiness`)
        .set('Authorization', `Bearer ${token}`)
        .expect(HttpStatus.OK);

      const body = responseBody(response);
      expect(body.blockers).toEqual([]);
      expect(body.readyToPublish.lessons).toEqual([
        { lessonId, sectionId, title: `Lesson ${lessonId}`, type: 'QUIZ' },
      ]);
      expect(body.readyToPublish.quizzes).toEqual([]);
    });

    it('a DRAFT Lesson referencing a valid but still-DRAFT Quiz is a candidate, and the Quiz appears informationally in readyToPublish.quizzes', async () => {
      const { token, tenantId, instructorId } = await createInstructorTenant('quiz-draft-valid');
      const courseId = await createCourseDirect(tenantId, instructorId);
      const sectionId = await createSectionDirect(tenantId, courseId, SectionStatus.DRAFT, 1);
      const quizId = await createValidQuizDirect(tenantId, QuizStatus.DRAFT);
      const lessonId = await createQuizLessonDirect(tenantId, courseId, sectionId, LessonStatus.DRAFT, quizId, 1);

      const response = await request(server)
        .get(`/instructor/tenants/${tenantId}/courses/${courseId}/readiness`)
        .set('Authorization', `Bearer ${token}`)
        .expect(HttpStatus.OK);

      const body = responseBody(response);
      expect(body.blockers).toEqual([]);
      expect(body.readyToPublish.lessons).toEqual([
        { lessonId, sectionId, title: `Lesson ${lessonId}`, type: 'QUIZ' },
      ]);
      expect(body.readyToPublish.quizzes).toEqual([{ quizId, lessonId, title: `Quiz ${quizId}` }]);
    });

    it('a DRAFT Lesson referencing an invalid DRAFT Quiz (no questions) is not a candidate, and the exact Quiz blocker is emitted', async () => {
      const { token, tenantId, instructorId } = await createInstructorTenant('quiz-no-questions');
      const courseId = await createCourseDirect(tenantId, instructorId);
      const sectionId = await createSectionDirect(tenantId, courseId, SectionStatus.DRAFT, 1);
      const quizId = await createQuizDirect(tenantId, QuizStatus.DRAFT);
      const lessonId = await createQuizLessonDirect(tenantId, courseId, sectionId, LessonStatus.DRAFT, quizId, 1);

      const response = await request(server)
        .get(`/instructor/tenants/${tenantId}/courses/${courseId}/readiness`)
        .set('Authorization', `Bearer ${token}`)
        .expect(HttpStatus.OK);

      const body = responseBody(response);
      expect(body.blockers).toEqual([
        expect.objectContaining({ reasonCode: 'QUIZ_NOT_PUBLISHABLE_NO_QUESTIONS', entityType: 'QUIZ', entityId: quizId }),
      ]);
      expect(body.readyToPublish.lessons.some((lesson) => lesson.lessonId === lessonId)).toBe(false);
      expect(body.readyToPublish.quizzes).toEqual([]);
    });

    it('reports QUIZ_NOT_PUBLISHABLE_MISSING_CORRECT_OPTION for a Quiz whose active question has no correct option', async () => {
      const { token, tenantId, instructorId } = await createInstructorTenant('quiz-missing-correct');
      const courseId = await createCourseDirect(tenantId, instructorId);
      const sectionId = await createSectionDirect(tenantId, courseId, SectionStatus.DRAFT, 1);
      const quizId = await createQuizDirect(tenantId, QuizStatus.DRAFT);
      const questionId = await createQuestionDirect(tenantId, quizId, QuestionType.TRUE_FALSE, QuestionStatus.ACTIVE);
      await createOptionDirect(tenantId, questionId, false, 1);
      await createOptionDirect(tenantId, questionId, false, 2);
      await createQuizLessonDirect(tenantId, courseId, sectionId, LessonStatus.DRAFT, quizId, 1);

      const response = await request(server)
        .get(`/instructor/tenants/${tenantId}/courses/${courseId}/readiness`)
        .set('Authorization', `Bearer ${token}`)
        .expect(HttpStatus.OK);

      expect(responseBody(response).blockers).toEqual([
        expect.objectContaining({ reasonCode: 'QUIZ_NOT_PUBLISHABLE_MISSING_CORRECT_OPTION', entityType: 'QUIZ', entityId: quizId }),
      ]);
    });

    it('reports QUIZ_NOT_PUBLISHABLE_INVALID_POINTS for a non-positive question points value', async () => {
      const { token, tenantId, instructorId } = await createInstructorTenant('quiz-invalid-points');
      const courseId = await createCourseDirect(tenantId, instructorId);
      const sectionId = await createSectionDirect(tenantId, courseId, SectionStatus.DRAFT, 1);
      const quizId = await createQuizDirect(tenantId, QuizStatus.DRAFT);
      const questionId = await createQuestionDirect(tenantId, quizId, QuestionType.TRUE_FALSE, QuestionStatus.ACTIVE, 0);
      await createOptionDirect(tenantId, questionId, true, 1);
      await createOptionDirect(tenantId, questionId, false, 2);
      await createQuizLessonDirect(tenantId, courseId, sectionId, LessonStatus.DRAFT, quizId, 1);

      const response = await request(server)
        .get(`/instructor/tenants/${tenantId}/courses/${courseId}/readiness`)
        .set('Authorization', `Bearer ${token}`)
        .expect(HttpStatus.OK);

      expect(responseBody(response).blockers).toEqual([
        expect.objectContaining({ reasonCode: 'QUIZ_NOT_PUBLISHABLE_INVALID_POINTS', entityType: 'QUIZ', entityId: quizId }),
      ]);
    });

    it('reports QUIZ_ARCHIVED for an archived Quiz even if its aggregate is otherwise valid, and excludes the Lesson from candidates', async () => {
      const { token, tenantId, instructorId } = await createInstructorTenant('quiz-archived');
      const courseId = await createCourseDirect(tenantId, instructorId);
      const sectionId = await createSectionDirect(tenantId, courseId, SectionStatus.DRAFT, 1);
      const quizId = await createValidQuizDirect(tenantId, QuizStatus.ARCHIVED);
      await createQuizLessonDirect(tenantId, courseId, sectionId, LessonStatus.DRAFT, quizId, 1);

      const response = await request(server)
        .get(`/instructor/tenants/${tenantId}/courses/${courseId}/readiness`)
        .set('Authorization', `Bearer ${token}`)
        .expect(HttpStatus.OK);

      const body = responseBody(response);
      expect(body.blockers).toEqual([
        expect.objectContaining({ reasonCode: 'QUIZ_ARCHIVED', entityType: 'QUIZ', entityId: quizId }),
      ]);
      expect(body.readyToPublish.lessons).toEqual([]);
      expect(body.readyToPublish.quizzes).toEqual([]);
    });
  });

  describe('Lesson availability advisory', () => {
    it('reports LESSON_AVAILABILITY_WINDOW_ELAPSED without blocking candidacy', async () => {
      const { token, tenantId, instructorId } = await createInstructorTenant('availability-elapsed');
      const courseId = await createCourseDirect(tenantId, instructorId);
      const sectionId = await createSectionDirect(tenantId, courseId, SectionStatus.DRAFT, 1);
      const videoAssetId = await createVideoAssetDirect(tenantId, instructorId, AssetProcessingStatus.READY);
      const lessonId = await createVideoLessonDirect(
        tenantId,
        courseId,
        sectionId,
        LessonStatus.DRAFT,
        videoAssetId,
        1,
        { availableUntil: new Date('2026-01-01T00:00:00.000Z') },
      );

      const response = await request(server)
        .get(`/instructor/tenants/${tenantId}/courses/${courseId}/readiness`)
        .set('Authorization', `Bearer ${token}`)
        .expect(HttpStatus.OK);

      const body = responseBody(response);
      expect(body.advisories).toEqual([
        expect.objectContaining({ reasonCode: 'LESSON_AVAILABILITY_WINDOW_ELAPSED', entityType: 'LESSON', entityId: lessonId }),
      ]);
      expect(body.readyToPublish.lessons).toEqual([
        { lessonId, sectionId, title: `Lesson ${lessonId}`, type: 'VIDEO' },
      ]);
    });
  });

  it('computes the approved mandatory scenario: progressive authoring across two DRAFT Sections of a never-published Course', async () => {
    const { token, tenantId, instructorId } = await createInstructorTenant('mandatory-scenario');
    const courseId = await createCourseDirect(tenantId, instructorId);

    // Section A: DRAFT, with three DRAFT Lessons whose content is all currently publishable.
    const sectionAId = await createSectionDirect(tenantId, courseId, SectionStatus.DRAFT, 1);
    const readyVideoAssetId = await createVideoAssetDirect(tenantId, instructorId, AssetProcessingStatus.READY);
    const lessonA1Id = await createVideoLessonDirect(tenantId, courseId, sectionAId, LessonStatus.DRAFT, readyVideoAssetId, 1);
    const readyDocumentAssetId = await createDocumentAssetDirect(tenantId, instructorId, AssetProcessingStatus.READY);
    const lessonA2Id = await createDocumentLessonDirect(tenantId, courseId, sectionAId, LessonStatus.DRAFT, readyDocumentAssetId, 2);
    const validDraftQuizId = await createValidQuizDirect(tenantId, QuizStatus.DRAFT);
    const lessonA3Id = await createQuizLessonDirect(tenantId, courseId, sectionAId, LessonStatus.DRAFT, validDraftQuizId, 3);

    // Section B: DRAFT, with one DRAFT Lesson whose Video is still PROCESSING.
    const sectionBId = await createSectionDirect(tenantId, courseId, SectionStatus.DRAFT, 2);
    const preparingVideoAssetId = await createVideoAssetDirect(tenantId, instructorId, AssetProcessingStatus.PROCESSING);
    const lessonB1Id = await createVideoLessonDirect(tenantId, courseId, sectionBId, LessonStatus.DRAFT, preparingVideoAssetId, 1);

    const response = await request(server)
      .get(`/instructor/tenants/${tenantId}/courses/${courseId}/readiness`)
      .set('Authorization', `Bearer ${token}`)
      .expect(HttpStatus.OK);

    const body = responseBody(response);

    expect(body.ready).toBe(true);
    expect(body.readyToPublish.sections).toEqual([{ sectionId: sectionAId, title: `Section ${sectionAId}` }]);
    expect(new Set(body.readyToPublish.lessons.map((lesson) => lesson.lessonId))).toEqual(
      new Set([lessonA1Id, lessonA2Id, lessonA3Id]),
    );
    expect(body.readyToPublish.quizzes).toEqual([
      { quizId: validDraftQuizId, lessonId: lessonA3Id, title: `Quiz ${validDraftQuizId}` },
    ]);

    // Section B / Lesson B1 are simply absent from candidates — no DRAFT-lifecycle blocker fires for
    // either of them, only the real content blocker for B1's still-PROCESSING video.
    expect(body.readyToPublish.sections.some((s) => s.sectionId === sectionBId)).toBe(false);
    expect(body.readyToPublish.lessons.some((l) => l.lessonId === lessonB1Id)).toBe(false);
    expect(body.blockers).toEqual([
      expect.objectContaining({ reasonCode: 'VIDEO_PREPARING', entityId: preparingVideoAssetId, parentLessonId: lessonB1Id }),
    ]);
    // Draft lifecycle alone must never produce a blocker for the ready Section/Lessons.
    expect(body.blockers.some((issue) => [sectionAId, lessonA1Id, lessonA2Id, lessonA3Id].includes(issue.entityId))).toBe(
      false,
    );
  });

  it('resolves an exact referenced asset correctly as Ready even when 25 other tenant assets exist (>20-media pagination regression)', async () => {
    const { token, tenantId, instructorId } = await createInstructorTenant('media-regression');
    const courseId = await createCourseDirect(tenantId, instructorId);
    const sectionId = await createSectionDirect(tenantId, courseId, SectionStatus.DRAFT, 1);

    // Create 25 unrelated READY VideoAssets first (older createdAt, sorted first by the old
    // tenant-wide list endpoint's `orderBy: [{ createdAt: 'desc' }, ...]` — i.e. exactly the kind of
    // assets that would fill up a paginated first page).
    for (let i = 0; i < 25; i += 1) {
      await createVideoAssetDirect(tenantId, instructorId, AssetProcessingStatus.READY);
    }

    // The Lesson's own referenced VideoAsset is created last (newest `createdAt`), and would in fact
    // land on page 1 of a `createdAt desc` list — so additionally create 25 more unrelated assets
    // *after* it too, guaranteeing this asset falls in the middle of a 51-row tenant-wide list,
    // outside any fixed-size first page (old bug: `MEDIA_PAGE_SIZE = 20`) regardless of sort order.
    const referencedVideoAssetId = await createVideoAssetDirect(tenantId, instructorId, AssetProcessingStatus.READY);
    for (let i = 0; i < 25; i += 1) {
      await createVideoAssetDirect(tenantId, instructorId, AssetProcessingStatus.READY);
    }

    const totalAssets = await prisma.client.videoAsset.count({ where: { tenantId } });
    expect(totalAssets).toBeGreaterThan(20);

    const lessonId = await createVideoLessonDirect(
      tenantId,
      courseId,
      sectionId,
      LessonStatus.DRAFT,
      referencedVideoAssetId,
      1,
    );

    const response = await request(server)
      .get(`/instructor/tenants/${tenantId}/courses/${courseId}/readiness`)
      .set('Authorization', `Bearer ${token}`)
      .expect(HttpStatus.OK);

    const body = responseBody(response);
    expect(body.blockers).toEqual([]);
    expect(body.readyToPublish.lessons).toEqual([
      { lessonId, sectionId, title: `Lesson ${lessonId}`, type: 'VIDEO' },
    ]);
  });

  it('fails loudly with COURSE_DATA_INTEGRITY_VIOLATION rather than a false Ready when a Lesson has no matching type-detail row', async () => {
    const { token, tenantId, instructorId } = await createInstructorTenant('integrity-violation');
    const courseId = await createCourseDirect(tenantId, instructorId);
    const sectionId = await createSectionDirect(tenantId, courseId, SectionStatus.DRAFT, 1);

    // Bypasses the service layer entirely (LessonService.createLesson always creates the Lesson and
    // its one type-matching detail row atomically) to simulate the otherwise-impossible corrupted
    // state: a VIDEO Lesson with no VideoLesson detail row.
    const lessonId = uuid.create();
    await prisma.client.lesson.create({
      data: {
        id: lessonId,
        tenantId,
        courseId,
        sectionId,
        title: 'Corrupted lesson',
        type: LessonType.VIDEO,
        position: 1,
        status: LessonStatus.DRAFT,
      },
    });

    const response = await request(server)
      .get(`/instructor/tenants/${tenantId}/courses/${courseId}/readiness`)
      .set('Authorization', `Bearer ${token}`)
      .expect(HttpStatus.INTERNAL_SERVER_ERROR);

    expect(response.body).toMatchObject({ error: { code: 'COURSE_DATA_INTEGRITY_VIOLATION' } });
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
    await prisma.client.tenant.deleteMany({ where: { slug: { startsWith: 'readiness-test-' } } });
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
        name: `Readiness Tenant ${suffix}`,
        slug: `readiness-test-${suffix}`,
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

  async function createCourseDirect(tenantId: string, createdByUserId: string): Promise<string> {
    const id = uuid.create();
    await prisma.client.course.create({ data: { id, tenantId, createdByUserId, title: `Course ${id}` } });
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
        ...(processingStatus === AssetProcessingStatus.FAILED ? { failureReason: 'TEST_FAILURE_REASON' } : {}),
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
    overrides: { availableFrom?: Date; availableUntil?: Date } = {},
  ): Promise<string> {
    const id = uuid.create();
    await prisma.client.lesson.create({
      data: {
        id,
        tenantId,
        courseId,
        sectionId,
        title: `Lesson ${id}`,
        position,
        type: LessonType.VIDEO,
        status,
        availableFrom: overrides.availableFrom ?? null,
        availableUntil: overrides.availableUntil ?? null,
      },
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

function responseBody(response: request.Response): CourseReadinessBody {
  return response.body as CourseReadinessBody;
}
