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
import { CoursesModule } from './courses.module';

const testDatabaseUrl = process.env.TEST_DATABASE_URL;
const maybeDescribe = testDatabaseUrl ? describe : describe.skip;
const trustedOrigin = 'http://localhost:3000';

// Fixed "now" so every startsAt/endsAt boundary assertion is deterministic. `currentNow` is
// mutable (reset to NOW in beforeEach) so individual tests can advance the clock between calls
// to prove a completion timestamp is stamped once and never silently re-stamped later.
const NOW = new Date('2026-06-15T12:00:00.000Z');
const ONE_DAY_MS = 24 * 60 * 60 * 1000;
let currentNow = NOW;

maybeDescribe('student course HTTP PostgreSQL integration', () => {
  let app: INestApplication;
  let server: App;
  let prisma: PrismaService;
  let accessTokens: AccessTokenService;
  let refreshSessions: RefreshSessionService;
  let tokenCrypto: TokenCryptoService;
  let uuid: UuidV7Service;

  beforeEach(async () => {
    currentNow = NOW;
    const databaseConfig: DatabaseRuntimeConfig = {
      databaseUrl: testDatabaseUrl as string,
      pool: {
        maxConnections: 6,
        connectionTimeoutMillis: 5_000,
        idleTimeoutMillis: 10_000,
      },
    };

    const moduleRef = await Test.createTestingModule({
      imports: [AuthModule, TenancyModule, CoursesModule],
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
      .useValue({ now: () => currentNow })
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

    await clearStudentCourseData();
  });

  afterEach(async () => {
    // Same cross-suite cleanliness discipline as course-section-lesson-http.postgres-test.ts:
    // this file creates CourseSection/Lesson (and Enrollment/asset/quiz) rows with
    // `onDelete: Restrict` foreign keys, so leftover rows would break other *.postgres-test.ts
    // files' unconditional `course.deleteMany()`/`enrollment.deleteMany()` calls.
    await clearStudentCourseData();
    await app?.close();
  });

  it('grants access to an entitled PUBLISHED course and returns only safe, ordered, published, currently-available content', async () => {
    const { tenantId, instructorId } = await createInstructorTenant('grant');
    const studentId = await createStudent('grant-student');
    const installationId = installation(1);
    await createTenantStudent(tenantId, studentId, TenantStudentStatus.ACTIVE);
    const courseId = await createCourseDirect(tenantId, instructorId, 'Grant Course', CourseStatus.PUBLISHED);
    await createEnrollmentDirect(tenantId, studentId, courseId, instructorId, EnrollmentStatus.ACTIVE);

    const publishedSection = await createSectionDirect(tenantId, courseId, 'Published section', 1, SectionStatus.PUBLISHED);
    await createSectionDirect(tenantId, courseId, 'Draft section', 2, SectionStatus.DRAFT);
    await createSectionDirect(tenantId, courseId, 'Archived section', 3, SectionStatus.ARCHIVED);

    const videoAssetId = await createVideoAssetDirect(tenantId, instructorId);
    const documentAssetId = await createDocumentAssetDirect(tenantId, instructorId);
    const quizId = await createQuizDirect(tenantId, 'Structure quiz');

    const publishedVideoLesson = await createLessonDirect(tenantId, courseId, publishedSection, {
      title: 'Published video',
      position: 1,
      type: LessonType.VIDEO,
      status: LessonStatus.PUBLISHED,
      reference: { videoAssetId },
    });
    await createLessonDirect(tenantId, courseId, publishedSection, {
      title: 'Draft lesson',
      position: 2,
      type: LessonType.QUIZ,
      status: LessonStatus.DRAFT,
      reference: { quizId },
    });
    await createLessonDirect(tenantId, courseId, publishedSection, {
      title: 'Archived lesson',
      position: 3,
      type: LessonType.QUIZ,
      status: LessonStatus.ARCHIVED,
      reference: { quizId },
    });
    const notYetAvailable = await createLessonDirect(tenantId, courseId, publishedSection, {
      title: 'Not yet available',
      position: 4,
      type: LessonType.DOCUMENT,
      status: LessonStatus.PUBLISHED,
      reference: { documentAssetId },
      availableFrom: new Date(NOW.getTime() + ONE_DAY_MS),
    });
    const noLongerAvailable = await createLessonDirect(tenantId, courseId, publishedSection, {
      title: 'No longer available',
      position: 5,
      type: LessonType.DOCUMENT,
      status: LessonStatus.PUBLISHED,
      reference: { documentAssetId },
      availableUntil: NOW,
    });
    const publishedDocumentLesson = await createLessonDirect(tenantId, courseId, publishedSection, {
      title: 'Published document',
      position: 6,
      type: LessonType.DOCUMENT,
      status: LessonStatus.PUBLISHED,
      reference: { documentAssetId },
    });
    const publishedQuizLesson = await createLessonDirect(tenantId, courseId, publishedSection, {
      title: 'Published quiz',
      position: 7,
      type: LessonType.QUIZ,
      status: LessonStatus.PUBLISHED,
      reference: { quizId },
    });

    await createActiveDevice(studentId, installationId);
    const token = await issueAccessToken(studentId, PlatformRole.STUDENT);

    const listResponse = await request(server)
      .get('/student/courses')
      .set('Authorization', `Bearer ${token}`)
      .set(INSTALLATION_ID_HEADER, installationId)
      .expect(HttpStatus.OK);
    const listBody = responseBody<{ items: Array<Record<string, unknown>> }>(listResponse);
    expect(listBody.items).toHaveLength(1);
    expect(listBody.items[0]).toMatchObject({ courseId, tenantId, title: 'Grant Course' });
    expect(Object.keys(listBody.items[0]).sort()).toEqual(
      ['courseId', 'description', 'tenantId', 'thumbnailAssetRef', 'title'].sort(),
    );

    const detailResponse = await request(server)
      .get(`/student/courses/${courseId}`)
      .set('Authorization', `Bearer ${token}`)
      .set(INSTALLATION_ID_HEADER, installationId)
      .expect(HttpStatus.OK);
    const detail = responseBody<{
      courseId: string;
      sections: Array<{
        sectionId: string;
        lessons: Array<Record<string, unknown>>;
      }>;
    }>(detailResponse);

    expect(detail.courseId).toBe(courseId);
    expect(detail.sections).toHaveLength(1);
    expect(detail.sections[0].sectionId).toBe(publishedSection);

    const lessonIds = detail.sections[0].lessons.map((lesson) => lesson.lessonId);
    expect(lessonIds).toEqual([publishedVideoLesson, publishedDocumentLesson, publishedQuizLesson]);
    expect(lessonIds).not.toContain(notYetAvailable);
    expect(lessonIds).not.toContain(noLongerAvailable);

    const videoLesson = detail.sections[0].lessons.find((lesson) => lesson.lessonId === publishedVideoLesson) as Record<
      string,
      unknown
    >;
    expect(videoLesson.progress).toEqual({ status: 'NOT_STARTED', completedAt: null });
    expect(videoLesson.video).toMatchObject({ processingStatus: 'UPLOADING', durationSeconds: null });
    expect(Object.keys(videoLesson.video as object).sort()).toEqual(['durationSeconds', 'processingStatus'].sort());
    expect(videoLesson.document).toBeNull();
    expect(videoLesson.quiz).toBeNull();
    expect(JSON.stringify(videoLesson)).not.toMatch(/providerKey|externalAssetRef|videoAssetId|playbackPolicy|watermark|url/i);

    const documentLesson = detail.sections[0].lessons.find(
      (lesson) => lesson.lessonId === publishedDocumentLesson,
    ) as Record<string, unknown>;
    expect(documentLesson.document).toMatchObject({
      fileName: 'lecture-notes.pdf',
      mimeType: 'application/pdf',
      fileSizeBytes: '1024',
    });
    expect(Object.keys(documentLesson.document as object).sort()).toEqual(
      ['fileName', 'fileSizeBytes', 'mimeType'].sort(),
    );
    expect(JSON.stringify(documentLesson)).not.toMatch(/externalAssetRef|documentAssetId|processingStatus|url/i);

    const quizLesson = detail.sections[0].lessons.find((lesson) => lesson.lessonId === publishedQuizLesson) as Record<
      string,
      unknown
    >;
    expect(quizLesson.quiz).toMatchObject({ title: 'Structure quiz', status: 'DRAFT' });
    expect(Object.keys(quizLesson.quiz as object).sort()).toEqual(['status', 'title'].sort());
    expect(JSON.stringify(quizLesson)).not.toMatch(/question|option|correctAnswer|attempt/i);
  });

  it('denies access before an approved device exists, regardless of otherwise-valid entitlement', async () => {
    const { tenantId, instructorId } = await createInstructorTenant('no-device');
    const studentId = await createStudent('no-device-student');
    await createTenantStudent(tenantId, studentId, TenantStudentStatus.ACTIVE);
    const courseId = await createCourseDirect(tenantId, instructorId, 'No device course', CourseStatus.PUBLISHED);
    await createEnrollmentDirect(tenantId, studentId, courseId, instructorId, EnrollmentStatus.ACTIVE);
    const token = await issueAccessToken(studentId, PlatformRole.STUDENT);

    await request(server)
      .get('/student/courses')
      .set('Authorization', `Bearer ${token}`)
      .set(INSTALLATION_ID_HEADER, installation(2))
      .expect(HttpStatus.FORBIDDEN);

    await request(server)
      .get(`/student/courses/${courseId}`)
      .set('Authorization', `Bearer ${token}`)
      .set(INSTALLATION_ID_HEADER, installation(2))
      .expect(HttpStatus.FORBIDDEN);
  });

  it('denies access without an ACTIVE TenantStudent association', async () => {
    const { tenantId, instructorId } = await createInstructorTenant('no-tenant-student');
    const studentId = await createStudent('no-ts-student');
    const installationId = installation(3);
    const courseId = await createCourseDirect(tenantId, instructorId, 'No TS course', CourseStatus.PUBLISHED);
    // No TenantStudent row is created here. The composite FK `Enrollment(tenantId,
    // studentUserId) -> TenantStudent(tenantId, studentUserId)` (RESTRICT) makes "an Enrollment
    // exists with zero TenantStudent row" an unreachable database state — enrollment creation
    // would fail with a foreign-key violation, so there is nothing further to create here. The
    // "TenantStudent exists but is not ACTIVE" case (association later deactivated while the
    // enrollment row remains) is covered separately below.
    await createActiveDevice(studentId, installationId);
    const token = await issueAccessToken(studentId, PlatformRole.STUDENT);

    const response = await request(server)
      .get(`/student/courses/${courseId}`)
      .set('Authorization', `Bearer ${token}`)
      .set(INSTALLATION_ID_HEADER, installationId)
      .expect(HttpStatus.NOT_FOUND);
    expect(response.body).toMatchObject({ error: { code: 'COURSE_NOT_FOUND' } });

    const list = await request(server)
      .get('/student/courses')
      .set('Authorization', `Bearer ${token}`)
      .set(INSTALLATION_ID_HEADER, installationId)
      .expect(HttpStatus.OK);
    expect(responseBody<{ items: unknown[] }>(list).items).toHaveLength(0);
  });

  it('denies access when TenantStudent is not ACTIVE', async () => {
    for (const status of [TenantStudentStatus.INACTIVE, TenantStudentStatus.REMOVED]) {
      const { tenantId, instructorId } = await createInstructorTenant(`ts-${status.toLowerCase()}`);
      const studentId = await createStudent(`ts-${status.toLowerCase()}-student`);
      const installationId = installation(4);
      await createTenantStudent(tenantId, studentId, status);
      const courseId = await createCourseDirect(tenantId, instructorId, 'TS status course', CourseStatus.PUBLISHED);
      await createEnrollmentDirect(tenantId, studentId, courseId, instructorId, EnrollmentStatus.ACTIVE);
      await createActiveDevice(studentId, installationId);
      const token = await issueAccessToken(studentId, PlatformRole.STUDENT);

      await request(server)
        .get(`/student/courses/${courseId}`)
        .set('Authorization', `Bearer ${token}`)
        .set(INSTALLATION_ID_HEADER, installationId)
        .expect(HttpStatus.NOT_FOUND);
    }
  });

  it('denies access without any Enrollment', async () => {
    const { tenantId, instructorId } = await createInstructorTenant('no-enrollment');
    const studentId = await createStudent('no-enrollment-student');
    const installationId = installation(5);
    await createTenantStudent(tenantId, studentId, TenantStudentStatus.ACTIVE);
    const courseId = await createCourseDirect(tenantId, instructorId, 'No enrollment course', CourseStatus.PUBLISHED);
    await createActiveDevice(studentId, installationId);
    const token = await issueAccessToken(studentId, PlatformRole.STUDENT);

    await request(server)
      .get(`/student/courses/${courseId}`)
      .set('Authorization', `Bearer ${token}`)
      .set(INSTALLATION_ID_HEADER, installationId)
      .expect(HttpStatus.NOT_FOUND);
  });

  it('denies access when Enrollment status is not ACTIVE', async () => {
    for (const status of [EnrollmentStatus.INACTIVE, EnrollmentStatus.REVOKED, EnrollmentStatus.EXPIRED]) {
      const { tenantId, instructorId } = await createInstructorTenant(`enr-${status.toLowerCase()}`);
      const studentId = await createStudent(`enr-${status.toLowerCase()}-student`);
      const installationId = installation(6);
      await createTenantStudent(tenantId, studentId, TenantStudentStatus.ACTIVE);
      const courseId = await createCourseDirect(tenantId, instructorId, 'Enrollment status course', CourseStatus.PUBLISHED);
      await createEnrollmentDirect(tenantId, studentId, courseId, instructorId, status);
      await createActiveDevice(studentId, installationId);
      const token = await issueAccessToken(studentId, PlatformRole.STUDENT);

      await request(server)
        .get(`/student/courses/${courseId}`)
        .set('Authorization', `Bearer ${token}`)
        .set(INSTALLATION_ID_HEADER, installationId)
        .expect(HttpStatus.NOT_FOUND);
    }
  });

  it('enforces the Enrollment time window at exact boundaries using ClockService', async () => {
    const { tenantId, instructorId } = await createInstructorTenant('time-window');
    const studentId = await createStudent('time-window-student');
    const installationId = installation(7);
    await createTenantStudent(tenantId, studentId, TenantStudentStatus.ACTIVE);
    await createActiveDevice(studentId, installationId);
    const token = await issueAccessToken(studentId, PlatformRole.STUDENT);

    const futureStartsCourse = await createCourseDirect(tenantId, instructorId, 'Future starts', CourseStatus.PUBLISHED);
    await createEnrollmentDirect(tenantId, studentId, futureStartsCourse, instructorId, EnrollmentStatus.ACTIVE, {
      startsAt: new Date(NOW.getTime() + ONE_DAY_MS),
    });

    const pastEndsCourse = await createCourseDirect(tenantId, instructorId, 'Past ends', CourseStatus.PUBLISHED);
    await createEnrollmentDirect(tenantId, studentId, pastEndsCourse, instructorId, EnrollmentStatus.ACTIVE, {
      endsAt: new Date(NOW.getTime() - ONE_DAY_MS),
    });

    const endsExactlyNowCourse = await createCourseDirect(tenantId, instructorId, 'Ends exactly now', CourseStatus.PUBLISHED);
    await createEnrollmentDirect(tenantId, studentId, endsExactlyNowCourse, instructorId, EnrollmentStatus.ACTIVE, {
      endsAt: NOW,
    });

    const startsExactlyNowCourse = await createCourseDirect(
      tenantId,
      instructorId,
      'Starts exactly now',
      CourseStatus.PUBLISHED,
    );
    await createEnrollmentDirect(tenantId, studentId, startsExactlyNowCourse, instructorId, EnrollmentStatus.ACTIVE, {
      startsAt: NOW,
    });

    await request(server)
      .get(`/student/courses/${futureStartsCourse}`)
      .set('Authorization', `Bearer ${token}`)
      .set(INSTALLATION_ID_HEADER, installationId)
      .expect(HttpStatus.NOT_FOUND);

    await request(server)
      .get(`/student/courses/${pastEndsCourse}`)
      .set('Authorization', `Bearer ${token}`)
      .set(INSTALLATION_ID_HEADER, installationId)
      .expect(HttpStatus.NOT_FOUND);

    await request(server)
      .get(`/student/courses/${endsExactlyNowCourse}`)
      .set('Authorization', `Bearer ${token}`)
      .set(INSTALLATION_ID_HEADER, installationId)
      .expect(HttpStatus.NOT_FOUND);

    await request(server)
      .get(`/student/courses/${startsExactlyNowCourse}`)
      .set('Authorization', `Bearer ${token}`)
      .set(INSTALLATION_ID_HEADER, installationId)
      .expect(HttpStatus.OK);
  });

  it('denies access to DRAFT and ARCHIVED courses even with a valid Enrollment', async () => {
    const { tenantId, instructorId } = await createInstructorTenant('lifecycle');
    const studentId = await createStudent('lifecycle-student');
    const installationId = installation(8);
    await createTenantStudent(tenantId, studentId, TenantStudentStatus.ACTIVE);
    await createActiveDevice(studentId, installationId);
    const token = await issueAccessToken(studentId, PlatformRole.STUDENT);

    for (const status of [CourseStatus.DRAFT, CourseStatus.ARCHIVED]) {
      const courseId = await createCourseDirect(tenantId, instructorId, `${status} course`, status);
      await createEnrollmentDirect(tenantId, studentId, courseId, instructorId, EnrollmentStatus.ACTIVE);

      const response = await request(server)
        .get(`/student/courses/${courseId}`)
        .set('Authorization', `Bearer ${token}`)
        .set(INSTALLATION_ID_HEADER, installationId)
        .expect(HttpStatus.NOT_FOUND);
      expect(response.body).toMatchObject({ error: { code: 'COURSE_NOT_FOUND' } });
    }
  });

  it("lists only the authenticated student's own currently entitled courses", async () => {
    const { tenantId, instructorId } = await createInstructorTenant('own-list');
    const studentId = await createStudent('own-list-student');
    const otherStudentId = await createStudent('own-list-other-student');
    const installationId = installation(9);
    await createTenantStudent(tenantId, studentId, TenantStudentStatus.ACTIVE);
    await createTenantStudent(tenantId, otherStudentId, TenantStudentStatus.ACTIVE);

    const ownCourse = await createCourseDirect(tenantId, instructorId, 'Own course', CourseStatus.PUBLISHED);
    await createEnrollmentDirect(tenantId, studentId, ownCourse, instructorId, EnrollmentStatus.ACTIVE);

    const otherStudentsCourse = await createCourseDirect(tenantId, instructorId, "Other student's course", CourseStatus.PUBLISHED);
    await createEnrollmentDirect(tenantId, otherStudentId, otherStudentsCourse, instructorId, EnrollmentStatus.ACTIVE);

    const notEntitledCourse = await createCourseDirect(tenantId, instructorId, 'Not entitled course', CourseStatus.PUBLISHED);
    // No enrollment for `studentId` on this course.
    void notEntitledCourse;

    await createActiveDevice(studentId, installationId);
    const token = await issueAccessToken(studentId, PlatformRole.STUDENT);

    const response = await request(server)
      .get('/student/courses')
      .set('Authorization', `Bearer ${token}`)
      .set(INSTALLATION_ID_HEADER, installationId)
      .expect(HttpStatus.OK);
    const items = responseBody<{ items: Array<{ courseId: string }> }>(response).items;
    expect(items.map((item) => item.courseId)).toEqual([ownCourse]);
  });

  it('does not leak existence for a cross-tenant Course UUID or a random UUID', async () => {
    const { tenantId, instructorId } = await createInstructorTenant('cross-tenant-a');
    const { tenantId: otherTenantId, instructorId: otherInstructorId } = await createInstructorTenant('cross-tenant-b');
    const studentId = await createStudent('cross-tenant-student');
    const installationId = installation(10);
    await createTenantStudent(tenantId, studentId, TenantStudentStatus.ACTIVE);
    const ownCourse = await createCourseDirect(tenantId, instructorId, 'Own tenant course', CourseStatus.PUBLISHED);
    await createEnrollmentDirect(tenantId, studentId, ownCourse, instructorId, EnrollmentStatus.ACTIVE);

    // A real, PUBLISHED course in a completely different tenant the student has no association with.
    const foreignTenantCourse = await createCourseDirect(
      otherTenantId,
      otherInstructorId,
      'Foreign tenant course',
      CourseStatus.PUBLISHED,
    );

    await createActiveDevice(studentId, installationId);
    const token = await issueAccessToken(studentId, PlatformRole.STUDENT);

    const crossTenantResponse = await request(server)
      .get(`/student/courses/${foreignTenantCourse}`)
      .set('Authorization', `Bearer ${token}`)
      .set(INSTALLATION_ID_HEADER, installationId)
      .expect(HttpStatus.NOT_FOUND);

    const randomUuidResponse = await request(server)
      .get(`/student/courses/${uuid.create()}`)
      .set('Authorization', `Bearer ${token}`)
      .set(INSTALLATION_ID_HEADER, installationId)
      .expect(HttpStatus.NOT_FOUND);

    // Identical error shape for "belongs to another tenant" and "does not exist at all" —
    // no existence leakage between the two cases.
    expect(crossTenantResponse.body).toEqual(randomUuidResponse.body);
  });

  it("prevents a foreign Section/Lesson from escaping the authorized Course's structure response", async () => {
    const { tenantId, instructorId } = await createInstructorTenant('foreign-nested');
    const studentId = await createStudent('foreign-nested-student');
    const installationId = installation(11);
    await createTenantStudent(tenantId, studentId, TenantStudentStatus.ACTIVE);

    const authorizedCourse = await createCourseDirect(tenantId, instructorId, 'Authorized course', CourseStatus.PUBLISHED);
    await createEnrollmentDirect(tenantId, studentId, authorizedCourse, instructorId, EnrollmentStatus.ACTIVE);
    const authorizedSection = await createSectionDirect(tenantId, authorizedCourse, 'Authorized section', 1, SectionStatus.PUBLISHED);
    const quizId = await createQuizDirect(tenantId, 'Authorized quiz');
    const authorizedLesson = await createLessonDirect(tenantId, authorizedCourse, authorizedSection, {
      title: 'Authorized lesson',
      position: 1,
      type: LessonType.QUIZ,
      status: LessonStatus.PUBLISHED,
      reference: { quizId },
    });

    // A different, also-PUBLISHED course in the SAME tenant, with its own section/lesson.
    const foreignCourse = await createCourseDirect(tenantId, instructorId, 'Foreign course', CourseStatus.PUBLISHED);
    const foreignSection = await createSectionDirect(tenantId, foreignCourse, 'Foreign section', 1, SectionStatus.PUBLISHED);
    await createLessonDirect(tenantId, foreignCourse, foreignSection, {
      title: 'Foreign lesson',
      position: 1,
      type: LessonType.QUIZ,
      status: LessonStatus.PUBLISHED,
      reference: { quizId },
    });

    await createActiveDevice(studentId, installationId);
    const token = await issueAccessToken(studentId, PlatformRole.STUDENT);

    const response = await request(server)
      .get(`/student/courses/${authorizedCourse}`)
      .set('Authorization', `Bearer ${token}`)
      .set(INSTALLATION_ID_HEADER, installationId)
      .expect(HttpStatus.OK);
    const detail = responseBody<{ sections: Array<{ sectionId: string; lessons: Array<{ lessonId: string }> }> }>(
      response,
    );

    expect(detail.sections.map((section) => section.sectionId)).toEqual([authorizedSection]);
    expect(detail.sections[0].lessons.map((lesson) => lesson.lessonId)).toEqual([authorizedLesson]);
    expect(JSON.stringify(detail)).not.toContain(foreignSection);
  });

  it('denies student and platform admin course routes without a student role', async () => {
    const adminId = await createUser('student-route-admin', PlatformRole.PLATFORM_ADMIN);
    const adminToken = await issueAccessToken(adminId, PlatformRole.PLATFORM_ADMIN);

    await request(server)
      .get('/student/courses')
      .set('Authorization', `Bearer ${adminToken}`)
      .set(INSTALLATION_ID_HEADER, installation(12))
      .expect(HttpStatus.FORBIDDEN);
  });

  it('reads missing progress as NOT_STARTED without inserting a LessonProgress row', async () => {
    const { tenantId, instructorId } = await createInstructorTenant('progress-default');
    const studentId = await createStudent('progress-default-student');
    const installationId = installation(13);
    await createTenantStudent(tenantId, studentId, TenantStudentStatus.ACTIVE);
    const courseId = await createCourseDirect(tenantId, instructorId, 'Progress default course', CourseStatus.PUBLISHED);
    await createEnrollmentDirect(tenantId, studentId, courseId, instructorId, EnrollmentStatus.ACTIVE);
    const sectionId = await createSectionDirect(tenantId, courseId, 'Section', 1, SectionStatus.PUBLISHED);
    const quizId = await createQuizDirect(tenantId, 'Quiz');
    const lessonId = await createLessonDirect(tenantId, courseId, sectionId, {
      title: 'Lesson',
      position: 1,
      type: LessonType.QUIZ,
      status: LessonStatus.PUBLISHED,
      reference: { quizId },
    });
    await createActiveDevice(studentId, installationId);
    const token = await issueAccessToken(studentId, PlatformRole.STUDENT);

    const response = await request(server)
      .get(`/student/courses/${courseId}`)
      .set('Authorization', `Bearer ${token}`)
      .set(INSTALLATION_ID_HEADER, installationId)
      .expect(HttpStatus.OK);
    const detail = responseBody<{
      sections: Array<{ lessons: Array<{ lessonId: string; progress: { status: string; completedAt: null } }> }>;
    }>(response);
    expect(detail.sections[0].lessons[0]).toMatchObject({
      lessonId,
      progress: { status: 'NOT_STARTED', completedAt: null },
    });

    await expect(prisma.client.lessonProgress.count({ where: { lessonId } })).resolves.toBe(0);
  });

  it('completes an accessible VIDEO lesson and an accessible DOCUMENT lesson, creating exactly one row each', async () => {
    const { tenantId, instructorId } = await createInstructorTenant('complete-basic');
    const studentId = await createStudent('complete-basic-student');
    const installationId = installation(14);
    await createTenantStudent(tenantId, studentId, TenantStudentStatus.ACTIVE);
    const courseId = await createCourseDirect(tenantId, instructorId, 'Complete basic course', CourseStatus.PUBLISHED);
    const enrollmentId = await createEnrollmentDirect(tenantId, studentId, courseId, instructorId, EnrollmentStatus.ACTIVE);
    const sectionId = await createSectionDirect(tenantId, courseId, 'Section', 1, SectionStatus.PUBLISHED);
    const videoAssetId = await createVideoAssetDirect(tenantId, instructorId);
    const documentAssetId = await createDocumentAssetDirect(tenantId, instructorId);
    const videoLessonId = await createLessonDirect(tenantId, courseId, sectionId, {
      title: 'Video lesson',
      position: 1,
      type: LessonType.VIDEO,
      status: LessonStatus.PUBLISHED,
      reference: { videoAssetId },
    });
    const documentLessonId = await createLessonDirect(tenantId, courseId, sectionId, {
      title: 'Document lesson',
      position: 2,
      type: LessonType.DOCUMENT,
      status: LessonStatus.PUBLISHED,
      reference: { documentAssetId },
    });
    await createActiveDevice(studentId, installationId);
    const token = await issueAccessToken(studentId, PlatformRole.STUDENT);

    const videoResponse = await request(server)
      .post(`/student/courses/${courseId}/lessons/${videoLessonId}/complete`)
      .set('Authorization', `Bearer ${token}`)
      .set(INSTALLATION_ID_HEADER, installationId)
      .expect(HttpStatus.OK);
    expect(videoResponse.body).toMatchObject({ lessonId: videoLessonId, status: 'COMPLETED' });

    const documentResponse = await request(server)
      .post(`/student/courses/${courseId}/lessons/${documentLessonId}/complete`)
      .set('Authorization', `Bearer ${token}`)
      .set(INSTALLATION_ID_HEADER, installationId)
      .expect(HttpStatus.OK);
    expect(documentResponse.body).toMatchObject({ lessonId: documentLessonId, status: 'COMPLETED' });

    for (const lessonId of [videoLessonId, documentLessonId]) {
      const rows = await prisma.client.lessonProgress.findMany({ where: { lessonId } });
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({
        tenantId,
        courseId,
        studentUserId: studentId,
        enrollmentId,
        status: 'COMPLETED',
      });
      expect(rows[0].completedAt?.toISOString()).toBe(currentNow.toISOString());
    }
  });

  it('is idempotent on repeated completion and does not re-stamp an already-COMPLETED lesson', async () => {
    const { tenantId, instructorId } = await createInstructorTenant('idempotent');
    const studentId = await createStudent('idempotent-student');
    const installationId = installation(15);
    await createTenantStudent(tenantId, studentId, TenantStudentStatus.ACTIVE);
    const courseId = await createCourseDirect(tenantId, instructorId, 'Idempotent course', CourseStatus.PUBLISHED);
    await createEnrollmentDirect(tenantId, studentId, courseId, instructorId, EnrollmentStatus.ACTIVE);
    const sectionId = await createSectionDirect(tenantId, courseId, 'Section', 1, SectionStatus.PUBLISHED);
    const videoAssetId = await createVideoAssetDirect(tenantId, instructorId);
    const lessonId = await createLessonDirect(tenantId, courseId, sectionId, {
      title: 'Lesson',
      position: 1,
      type: LessonType.VIDEO,
      status: LessonStatus.PUBLISHED,
      reference: { videoAssetId },
    });
    await createActiveDevice(studentId, installationId);
    const token = await issueAccessToken(studentId, PlatformRole.STUDENT);

    const first = await request(server)
      .post(`/student/courses/${courseId}/lessons/${lessonId}/complete`)
      .set('Authorization', `Bearer ${token}`)
      .set(INSTALLATION_ID_HEADER, installationId)
      .expect(HttpStatus.OK);
    const firstCompletedAt = (first.body as { completedAt: string }).completedAt;
    expect(firstCompletedAt).toBe(currentNow.toISOString());

    // Advance the clock, then complete again: a stable, already-COMPLETED lesson must not be
    // re-stamped with the new time.
    currentNow = new Date(NOW.getTime() + ONE_DAY_MS);

    const second = await request(server)
      .post(`/student/courses/${courseId}/lessons/${lessonId}/complete`)
      .set('Authorization', `Bearer ${token}`)
      .set(INSTALLATION_ID_HEADER, installationId)
      .expect(HttpStatus.OK);
    expect(second.body).toMatchObject({ lessonId, status: 'COMPLETED', completedAt: firstCompletedAt });

    await expect(prisma.client.lessonProgress.count({ where: { lessonId } })).resolves.toBe(1);
  });

  it('transitions existing STARTED progress to COMPLETED', async () => {
    const { tenantId, instructorId } = await createInstructorTenant('started-transition');
    const studentId = await createStudent('started-transition-student');
    const installationId = installation(16);
    await createTenantStudent(tenantId, studentId, TenantStudentStatus.ACTIVE);
    const courseId = await createCourseDirect(tenantId, instructorId, 'Started course', CourseStatus.PUBLISHED);
    const enrollmentId = await createEnrollmentDirect(tenantId, studentId, courseId, instructorId, EnrollmentStatus.ACTIVE);
    const sectionId = await createSectionDirect(tenantId, courseId, 'Section', 1, SectionStatus.PUBLISHED);
    const videoAssetId = await createVideoAssetDirect(tenantId, instructorId);
    const lessonId = await createLessonDirect(tenantId, courseId, sectionId, {
      title: 'Lesson',
      position: 1,
      type: LessonType.VIDEO,
      status: LessonStatus.PUBLISHED,
      reference: { videoAssetId },
    });
    await prisma.client.lessonProgress.create({
      data: {
        id: uuid.create(),
        tenantId,
        courseId,
        lessonId,
        studentUserId: studentId,
        enrollmentId,
        status: 'STARTED',
        startedAt: new Date(NOW.getTime() - ONE_DAY_MS),
      },
    });
    await createActiveDevice(studentId, installationId);
    const token = await issueAccessToken(studentId, PlatformRole.STUDENT);

    const response = await request(server)
      .post(`/student/courses/${courseId}/lessons/${lessonId}/complete`)
      .set('Authorization', `Bearer ${token}`)
      .set(INSTALLATION_ID_HEADER, installationId)
      .expect(HttpStatus.OK);
    expect(response.body).toMatchObject({ lessonId, status: 'COMPLETED', completedAt: currentNow.toISOString() });

    const rows = await prisma.client.lessonProgress.findMany({ where: { lessonId } });
    expect(rows).toHaveLength(1);
    expect(rows[0].status).toBe('COMPLETED');
  });

  it('cannot manually complete a QUIZ lesson', async () => {
    const { tenantId, instructorId } = await createInstructorTenant('quiz-complete');
    const studentId = await createStudent('quiz-complete-student');
    const installationId = installation(17);
    await createTenantStudent(tenantId, studentId, TenantStudentStatus.ACTIVE);
    const courseId = await createCourseDirect(tenantId, instructorId, 'Quiz course', CourseStatus.PUBLISHED);
    await createEnrollmentDirect(tenantId, studentId, courseId, instructorId, EnrollmentStatus.ACTIVE);
    const sectionId = await createSectionDirect(tenantId, courseId, 'Section', 1, SectionStatus.PUBLISHED);
    const quizId = await createQuizDirect(tenantId, 'Quiz');
    const lessonId = await createLessonDirect(tenantId, courseId, sectionId, {
      title: 'Quiz lesson',
      position: 1,
      type: LessonType.QUIZ,
      status: LessonStatus.PUBLISHED,
      reference: { quizId },
    });
    await createActiveDevice(studentId, installationId);
    const token = await issueAccessToken(studentId, PlatformRole.STUDENT);

    const response = await request(server)
      .post(`/student/courses/${courseId}/lessons/${lessonId}/complete`)
      .set('Authorization', `Bearer ${token}`)
      .set(INSTALLATION_ID_HEADER, installationId)
      .expect(HttpStatus.BAD_REQUEST);
    expect(response.body).toMatchObject({ error: { code: 'QUIZ_LESSON_COMPLETION_NOT_ALLOWED' } });

    await expect(prisma.client.lessonProgress.count({ where: { lessonId } })).resolves.toBe(0);
  });

  it('cannot complete an unavailable lesson (DRAFT, ARCHIVED, before availableFrom, or at/after availableUntil)', async () => {
    const { tenantId, instructorId } = await createInstructorTenant('unavailable-complete');
    const studentId = await createStudent('unavailable-complete-student');
    const installationId = installation(18);
    await createTenantStudent(tenantId, studentId, TenantStudentStatus.ACTIVE);
    const courseId = await createCourseDirect(tenantId, instructorId, 'Unavailable course', CourseStatus.PUBLISHED);
    await createEnrollmentDirect(tenantId, studentId, courseId, instructorId, EnrollmentStatus.ACTIVE);
    const sectionId = await createSectionDirect(tenantId, courseId, 'Section', 1, SectionStatus.PUBLISHED);
    const draftSectionId = await createSectionDirect(tenantId, courseId, 'Draft section', 2, SectionStatus.DRAFT);
    const videoAssetId = await createVideoAssetDirect(tenantId, instructorId);

    const draftLesson = await createLessonDirect(tenantId, courseId, sectionId, {
      title: 'Draft lesson',
      position: 1,
      type: LessonType.VIDEO,
      status: LessonStatus.DRAFT,
      reference: { videoAssetId },
    });
    const archivedLesson = await createLessonDirect(tenantId, courseId, sectionId, {
      title: 'Archived lesson',
      position: 2,
      type: LessonType.VIDEO,
      status: LessonStatus.ARCHIVED,
      reference: { videoAssetId },
    });
    const notYetAvailable = await createLessonDirect(tenantId, courseId, sectionId, {
      title: 'Not yet available',
      position: 3,
      type: LessonType.VIDEO,
      status: LessonStatus.PUBLISHED,
      reference: { videoAssetId },
      availableFrom: new Date(NOW.getTime() + ONE_DAY_MS),
    });
    const noLongerAvailable = await createLessonDirect(tenantId, courseId, sectionId, {
      title: 'No longer available',
      position: 4,
      type: LessonType.VIDEO,
      status: LessonStatus.PUBLISHED,
      reference: { videoAssetId },
      availableUntil: NOW,
    });
    const lessonUnderDraftSection = await createLessonDirect(tenantId, courseId, draftSectionId, {
      title: 'Lesson under draft section',
      position: 1,
      type: LessonType.VIDEO,
      status: LessonStatus.PUBLISHED,
      reference: { videoAssetId },
    });

    await createActiveDevice(studentId, installationId);
    const token = await issueAccessToken(studentId, PlatformRole.STUDENT);

    for (const lessonId of [draftLesson, archivedLesson, notYetAvailable, noLongerAvailable, lessonUnderDraftSection]) {
      const response = await request(server)
        .post(`/student/courses/${courseId}/lessons/${lessonId}/complete`)
        .set('Authorization', `Bearer ${token}`)
        .set(INSTALLATION_ID_HEADER, installationId)
        .expect(HttpStatus.NOT_FOUND);
      expect(response.body).toMatchObject({ error: { code: 'LESSON_NOT_FOUND' } });
    }

    await expect(prisma.client.lessonProgress.count()).resolves.toBe(0);
  });

  it('cannot complete a lesson belonging to another Course', async () => {
    const { tenantId, instructorId } = await createInstructorTenant('foreign-course-complete');
    const studentId = await createStudent('foreign-course-complete-student');
    const installationId = installation(19);
    await createTenantStudent(tenantId, studentId, TenantStudentStatus.ACTIVE);
    const authorizedCourse = await createCourseDirect(tenantId, instructorId, 'Authorized course', CourseStatus.PUBLISHED);
    await createEnrollmentDirect(tenantId, studentId, authorizedCourse, instructorId, EnrollmentStatus.ACTIVE);

    const foreignCourse = await createCourseDirect(tenantId, instructorId, 'Foreign course', CourseStatus.PUBLISHED);
    const foreignSection = await createSectionDirect(tenantId, foreignCourse, 'Foreign section', 1, SectionStatus.PUBLISHED);
    const videoAssetId = await createVideoAssetDirect(tenantId, instructorId);
    const foreignLesson = await createLessonDirect(tenantId, foreignCourse, foreignSection, {
      title: 'Foreign lesson',
      position: 1,
      type: LessonType.VIDEO,
      status: LessonStatus.PUBLISHED,
      reference: { videoAssetId },
    });

    await createActiveDevice(studentId, installationId);
    const token = await issueAccessToken(studentId, PlatformRole.STUDENT);

    const response = await request(server)
      .post(`/student/courses/${authorizedCourse}/lessons/${foreignLesson}/complete`)
      .set('Authorization', `Bearer ${token}`)
      .set(INSTALLATION_ID_HEADER, installationId)
      .expect(HttpStatus.NOT_FOUND);
    expect(response.body).toMatchObject({ error: { code: 'LESSON_NOT_FOUND' } });

    await expect(prisma.client.lessonProgress.count({ where: { lessonId: foreignLesson } })).resolves.toBe(0);
  });

  it("isolates progress per student: one student's completion never appears in another student's read, and Course detail returns only the authenticated student's own progress", async () => {
    const { tenantId, instructorId } = await createInstructorTenant('progress-isolation');
    const studentA = await createStudent('progress-isolation-a');
    const studentB = await createStudent('progress-isolation-b');
    const installationA = installation(21);
    const installationB = installation(22);
    await createTenantStudent(tenantId, studentA, TenantStudentStatus.ACTIVE);
    await createTenantStudent(tenantId, studentB, TenantStudentStatus.ACTIVE);
    const courseId = await createCourseDirect(tenantId, instructorId, 'Shared course', CourseStatus.PUBLISHED);
    await createEnrollmentDirect(tenantId, studentA, courseId, instructorId, EnrollmentStatus.ACTIVE);
    await createEnrollmentDirect(tenantId, studentB, courseId, instructorId, EnrollmentStatus.ACTIVE);
    const sectionId = await createSectionDirect(tenantId, courseId, 'Section', 1, SectionStatus.PUBLISHED);
    const videoAssetId = await createVideoAssetDirect(tenantId, instructorId);
    const lessonId = await createLessonDirect(tenantId, courseId, sectionId, {
      title: 'Shared lesson',
      position: 1,
      type: LessonType.VIDEO,
      status: LessonStatus.PUBLISHED,
      reference: { videoAssetId },
    });

    await createActiveDevice(studentA, installationA);
    await createActiveDevice(studentB, installationB);
    const tokenA = await issueAccessToken(studentA, PlatformRole.STUDENT);
    const tokenB = await issueAccessToken(studentB, PlatformRole.STUDENT);

    // Student B completes the lesson; student A never called complete.
    await request(server)
      .post(`/student/courses/${courseId}/lessons/${lessonId}/complete`)
      .set('Authorization', `Bearer ${tokenB}`)
      .set(INSTALLATION_ID_HEADER, installationB)
      .expect(HttpStatus.OK);

    const detailForA = await request(server)
      .get(`/student/courses/${courseId}`)
      .set('Authorization', `Bearer ${tokenA}`)
      .set(INSTALLATION_ID_HEADER, installationA)
      .expect(HttpStatus.OK);
    const lessonsForA = responseBody<{
      sections: Array<{ lessons: Array<{ lessonId: string; progress: { status: string } }> }>;
    }>(detailForA).sections[0].lessons;
    expect(lessonsForA.find((lesson) => lesson.lessonId === lessonId)?.progress.status).toBe('NOT_STARTED');

    const detailForB = await request(server)
      .get(`/student/courses/${courseId}`)
      .set('Authorization', `Bearer ${tokenB}`)
      .set(INSTALLATION_ID_HEADER, installationB)
      .expect(HttpStatus.OK);
    const lessonsForB = responseBody<{
      sections: Array<{ lessons: Array<{ lessonId: string; progress: { status: string } }> }>;
    }>(detailForB).sections[0].lessons;
    expect(lessonsForB.find((lesson) => lesson.lessonId === lessonId)?.progress.status).toBe('COMPLETED');

    const rows = await prisma.client.lessonProgress.findMany({ where: { lessonId } });
    expect(rows).toHaveLength(1);
    expect(rows[0].studentUserId).toBe(studentB);
  });

  it('does not create duplicate LessonProgress rows under concurrent duplicate completion', async () => {
    const { tenantId, instructorId } = await createInstructorTenant('concurrent-complete');
    const studentId = await createStudent('concurrent-complete-student');
    const installationId = installation(23);
    await createTenantStudent(tenantId, studentId, TenantStudentStatus.ACTIVE);
    const courseId = await createCourseDirect(tenantId, instructorId, 'Concurrent complete course', CourseStatus.PUBLISHED);
    await createEnrollmentDirect(tenantId, studentId, courseId, instructorId, EnrollmentStatus.ACTIVE);
    const sectionId = await createSectionDirect(tenantId, courseId, 'Section', 1, SectionStatus.PUBLISHED);
    const videoAssetId = await createVideoAssetDirect(tenantId, instructorId);
    const lessonId = await createLessonDirect(tenantId, courseId, sectionId, {
      title: 'Lesson',
      position: 1,
      type: LessonType.VIDEO,
      status: LessonStatus.PUBLISHED,
      reference: { videoAssetId },
    });
    await createActiveDevice(studentId, installationId);
    const token = await issueAccessToken(studentId, PlatformRole.STUDENT);

    const responses = await Promise.all([
      request(server)
        .post(`/student/courses/${courseId}/lessons/${lessonId}/complete`)
        .set('Authorization', `Bearer ${token}`)
        .set(INSTALLATION_ID_HEADER, installationId),
      request(server)
        .post(`/student/courses/${courseId}/lessons/${lessonId}/complete`)
        .set('Authorization', `Bearer ${token}`)
        .set(INSTALLATION_ID_HEADER, installationId),
      request(server)
        .post(`/student/courses/${courseId}/lessons/${lessonId}/complete`)
        .set('Authorization', `Bearer ${token}`)
        .set(INSTALLATION_ID_HEADER, installationId),
    ]);

    for (const response of responses) {
      expect(response.status).toBe(HttpStatus.OK);
      expect(response.body).toMatchObject({ lessonId, status: 'COMPLETED' });
    }

    await expect(prisma.client.lessonProgress.count({ where: { lessonId } })).resolves.toBe(1);
  });

  async function clearStudentCourseData(): Promise<void> {
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
      where: { slug: { startsWith: 'student-course-test-' } },
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
        name: `Student Course Tenant ${slugSuffix}`,
        slug: `student-course-test-${slugSuffix}`,
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

  async function createTenantStudent(
    tenantId: string,
    studentUserId: string,
    status: TenantStudentStatus,
  ): Promise<void> {
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

  async function createCourseDirect(
    tenantId: string,
    createdByUserId: string,
    title: string,
    status: CourseStatus,
  ): Promise<string> {
    const id = uuid.create();
    await prisma.client.course.create({
      data: { id, tenantId, createdByUserId, title, status },
    });
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
    await prisma.client.courseSection.create({
      data: { id, tenantId, courseId, title, position, status },
    });
    return id;
  }

  async function createLessonDirect(
    tenantId: string,
    courseId: string,
    sectionId: string,
    spec: {
      title: string;
      position: number;
      type: LessonType;
      status: LessonStatus;
      reference: { videoAssetId?: string; documentAssetId?: string; quizId?: string };
      availableFrom?: Date;
      availableUntil?: Date;
    },
  ): Promise<string> {
    const id = uuid.create();
    await prisma.client.lesson.create({
      data: {
        id,
        tenantId,
        courseId,
        sectionId,
        title: spec.title,
        position: spec.position,
        type: spec.type,
        status: spec.status,
        availableFrom: spec.availableFrom ?? null,
        availableUntil: spec.availableUntil ?? null,
      },
    });

    if (spec.type === LessonType.VIDEO) {
      await prisma.client.videoLesson.create({
        data: { lessonId: id, tenantId, videoAssetId: spec.reference.videoAssetId as string },
      });
    } else if (spec.type === LessonType.DOCUMENT) {
      await prisma.client.documentLesson.create({
        data: { lessonId: id, tenantId, documentAssetId: spec.reference.documentAssetId as string },
      });
    } else {
      await prisma.client.quizLesson.create({
        data: { lessonId: id, tenantId, quizId: spec.reference.quizId as string },
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
        fileName: 'lecture-notes.pdf',
        mimeType: 'application/pdf',
        fileSizeBytes: BigInt(1024),
      },
    });
    return id;
  }

  async function createQuizDirect(tenantId: string, title: string): Promise<string> {
    const id = uuid.create();
    await prisma.client.quiz.create({ data: { id, tenantId, title } });
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

function installation(suffix: number): string {
  return `00000000-0000-7000-8000-${suffix.toString().padStart(12, '0')}`;
}

function responseBody<T>(response: request.Response): T {
  return response.body as T;
}
