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
import { MediaModule } from './media.module';

const testDatabaseUrl = process.env.TEST_DATABASE_URL;
const maybeDescribe = testDatabaseUrl ? describe : describe.skip;
const trustedOrigin = 'http://localhost:3000';

// Fixed "now" so every startsAt/endsAt/availableFrom/availableUntil boundary assertion is
// deterministic, matching the convention this codebase already established (see
// `student-document-http.postgres-test.ts`, `student-quiz-attempt-http.postgres-test.ts`).
const NOW = new Date('2026-06-15T12:00:00.000Z');
const ONE_DAY_MS = 24 * 60 * 60 * 1000;

maybeDescribe('student video access HTTP PostgreSQL integration', () => {
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
      imports: [AuthModule, TenancyModule, CoursesModule, MediaModule],
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
    studentId: string;
    installationId: string;
    token: string;
    courseId: string;
    sectionId: string;
    lessonId: string;
    videoAssetId: string;
    enrollmentId: string;
  };

  async function setUpAccessibleVideoLesson(
    slugSuffix: string,
    options: { processingStatus?: AssetProcessingStatus; durationSeconds?: number } = {},
  ): Promise<Setup> {
    const { tenantId, instructorId } = await createInstructorTenant(slugSuffix);
    const studentId = await createStudent(`${slugSuffix}-student`);
    const installationId = installation();
    await createTenantStudent(tenantId, studentId, TenantStudentStatus.ACTIVE);
    const courseId = await createCourseDirect(tenantId, instructorId, `${slugSuffix} course`, CourseStatus.PUBLISHED);
    const enrollmentId = await createEnrollmentDirect(tenantId, studentId, courseId, instructorId, EnrollmentStatus.ACTIVE);
    const sectionId = await createSectionDirect(tenantId, courseId, 'Section', 1, SectionStatus.PUBLISHED);
    const videoAssetId = await createVideoAssetDirect(
      tenantId,
      instructorId,
      options.processingStatus ?? AssetProcessingStatus.READY,
      options.durationSeconds,
    );
    const lessonId = await createLessonDirect(tenantId, courseId, sectionId, {
      title: 'Video lesson',
      position: 1,
      status: LessonStatus.PUBLISHED,
      videoAssetId,
    });
    await createActiveDevice(studentId, installationId);
    const token = await issueAccessToken(studentId, PlatformRole.STUDENT);

    return {
      tenantId,
      instructorId,
      studentId,
      installationId,
      token,
      courseId,
      sectionId,
      lessonId,
      videoAssetId,
      enrollmentId,
    };
  }

  function accessPath(courseId: string, lessonId: string): string {
    return `/student/courses/${courseId}/lessons/${lessonId}/video/access`;
  }

  function completePath(courseId: string, lessonId: string): string {
    return `/student/courses/${courseId}/lessons/${lessonId}/complete`;
  }

  function getAccess(setup: Setup, courseId = setup.courseId, lessonId = setup.lessonId): request.Test {
    return request(server)
      .get(accessPath(courseId, lessonId))
      .set('Authorization', `Bearer ${setup.token}`)
      .set(INSTALLATION_ID_HEADER, setup.installationId);
  }

  // ---------------------------------------------------------------------------------------------
  // Happy path
  // ---------------------------------------------------------------------------------------------

  it('authorizes an entitled student for a READY VIDEO lesson and returns only safe metadata', async () => {
    const setup = await setUpAccessibleVideoLesson('happy-path', { durationSeconds: 900 });

    const response = await getAccess(setup).expect(HttpStatus.OK);
    const body = responseBody<Record<string, unknown>>(response);

    expect(body).toMatchObject({ lessonId: setup.lessonId, ready: true, durationSeconds: 900 });
    expect(typeof body.authorizedAt).toBe('string');
    expect(Object.keys(body).sort()).toEqual(['authorizedAt', 'durationSeconds', 'lessonId', 'ready'].sort());

    // No internal/provider identifiers of any kind leak into the response, including the
    // videoAssetId itself and the tenant ID — neither is needed by the client and neither is
    // exposed by the existing student Course structure endpoint's raw JSON either.
    const raw = JSON.stringify(body);
    expect(raw).not.toMatch(/externalAssetRef|providerKey|videoAssetId|tenantId|processingStatus|url|token|secret|signed|playback|hls|dash|drm|license/i);
    expect(raw).not.toContain(setup.videoAssetId);
    expect(raw).not.toContain(setup.tenantId);
  });

  it('creates no LessonProgress, QuizAttempt, or other side-effect row on authorization, and does not mutate the Enrollment', async () => {
    const setup = await setUpAccessibleVideoLesson('no-side-effects');

    await getAccess(setup).expect(HttpStatus.OK);
    await getAccess(setup).expect(HttpStatus.OK);

    await expect(prisma.client.lessonProgress.count()).resolves.toBe(0);
    await expect(prisma.client.quizAttempt.count()).resolves.toBe(0);
    await expect(prisma.client.enrollment.count()).resolves.toBe(1);
    const enrollment = await prisma.client.enrollment.findUniqueOrThrow({ where: { id: setup.enrollmentId } });
    expect(enrollment.status).toBe(EnrollmentStatus.ACTIVE);
  });

  it('leaves the existing generic VIDEO manual-completion endpoint unaffected by playback authorization', async () => {
    const setup = await setUpAccessibleVideoLesson('manual-completion');

    // Calling the playback authorization endpoint alone never completes the Lesson.
    await getAccess(setup).expect(HttpStatus.OK);
    await expect(prisma.client.lessonProgress.count()).resolves.toBe(0);

    // The pre-existing generic manual completion endpoint (Course Slice D) still works exactly as
    // before, entirely independent of this slice's new playback-authorization endpoint.
    const completeResponse = await request(server)
      .post(completePath(setup.courseId, setup.lessonId))
      .set('Authorization', `Bearer ${setup.token}`)
      .set(INSTALLATION_ID_HEADER, setup.installationId)
      .expect(HttpStatus.OK);
    expect(responseBody<{ status: string }>(completeResponse).status).toBe('COMPLETED');

    const progress = await prisma.client.lessonProgress.findFirstOrThrow({ where: { lessonId: setup.lessonId } });
    expect(progress.status).toBe('COMPLETED');

    // Playback authorization remains available and still creates no further side effects after
    // completion.
    await getAccess(setup).expect(HttpStatus.OK);
    await expect(prisma.client.lessonProgress.count()).resolves.toBe(1);
  });

  // ---------------------------------------------------------------------------------------------
  // IDOR / random / foreign resource denial
  // ---------------------------------------------------------------------------------------------

  it('denies a random Lesson ID and a random Course ID with a non-leaking not-found response', async () => {
    const setup = await setUpAccessibleVideoLesson('random-ids');

    const randomLesson = await getAccess(setup, setup.courseId, uuid.create()).expect(HttpStatus.NOT_FOUND);
    expect(randomLesson.body).toMatchObject({ error: { code: 'LESSON_NOT_FOUND' } });

    const randomCourse = await getAccess(setup, uuid.create(), setup.lessonId).expect(HttpStatus.NOT_FOUND);
    expect(randomCourse.body).toMatchObject({ error: { code: 'COURSE_NOT_FOUND' } });
  });

  it('denies a foreign Course/Lesson pair (own Course, another Course-tenant Lesson ID)', async () => {
    const setup = await setUpAccessibleVideoLesson('foreign-pair-a');
    const other = await setUpAccessibleVideoLesson('foreign-pair-b');

    const response = await getAccess(setup, setup.courseId, other.lessonId).expect(HttpStatus.NOT_FOUND);
    expect(response.body).toMatchObject({ error: { code: 'LESSON_NOT_FOUND' } });
  });

  it('denies a VIDEO Lesson belonging to another Tenant even with a valid Enrollment/device for the caller tenant', async () => {
    const setup = await setUpAccessibleVideoLesson('cross-tenant-a');
    const other = await setUpAccessibleVideoLesson('cross-tenant-b');

    const response = await getAccess(setup, other.courseId, other.lessonId).expect(HttpStatus.NOT_FOUND);
    expect(response.body).toMatchObject({ error: { code: 'COURSE_NOT_FOUND' } });
  });

  it("denies substituting another student's valid Enrollment/Course/Lesson for the caller", async () => {
    const owner = await setUpAccessibleVideoLesson('substitution-owner');
    const attacker = await setUpAccessibleVideoLesson('substitution-attacker');

    const response = await request(server)
      .get(accessPath(owner.courseId, owner.lessonId))
      .set('Authorization', `Bearer ${attacker.token}`)
      .set(INSTALLATION_ID_HEADER, attacker.installationId)
      .expect(HttpStatus.NOT_FOUND);
    expect(response.body).toMatchObject({ error: { code: 'COURSE_NOT_FOUND' } });
  });

  it('cannot leak a cross-tenant VideoAsset relationship: the schema rejects attaching a foreign-tenant asset to a Lesson', async () => {
    const setup = await setUpAccessibleVideoLesson('cross-tenant-fk-a');
    const other = await setUpAccessibleVideoLesson('cross-tenant-fk-b');

    // Proves at the data-integrity level (not just the HTTP boundary) that a VideoLesson can
    // never reference a VideoAsset outside its own tenant: the composite foreign key
    // `VideoLesson(videoAssetId, tenantId) -> VideoAsset(id, tenantId)` makes this an unreachable
    // database state, which is exactly why `assertAccessibleVideoLesson` can trust a resolved
    // `videoAssetId` as already tenant-proven with no separate check.
    const foreignLessonId = uuid.create();
    await prisma.client.lesson.create({
      data: {
        id: foreignLessonId,
        tenantId: setup.tenantId,
        courseId: setup.courseId,
        sectionId: setup.sectionId,
        title: 'Attempted cross-tenant attach',
        type: LessonType.VIDEO,
        position: 99,
        status: LessonStatus.PUBLISHED,
      },
    });

    await expect(
      prisma.client.videoLesson.create({
        data: { lessonId: foreignLessonId, tenantId: setup.tenantId, videoAssetId: other.videoAssetId },
      }),
    ).rejects.toThrow();
  });

  // ---------------------------------------------------------------------------------------------
  // Device / TenantStudent / Enrollment boundary
  // ---------------------------------------------------------------------------------------------

  it('denies access with no approved device', async () => {
    const setup = await setUpAccessibleVideoLesson('no-device');

    await request(server)
      .get(accessPath(setup.courseId, setup.lessonId))
      .set('Authorization', `Bearer ${setup.token}`)
      .set(INSTALLATION_ID_HEADER, installation())
      .expect(HttpStatus.FORBIDDEN);
  });

  it('denies access when TenantStudent is not ACTIVE', async () => {
    const { tenantId, instructorId } = await createInstructorTenant('inactive-ts');
    const studentId = await createStudent('inactive-ts-student');
    const installationId = installation();
    await createTenantStudent(tenantId, studentId, TenantStudentStatus.INACTIVE);
    const courseId = await createCourseDirect(tenantId, instructorId, 'Course', CourseStatus.PUBLISHED);
    await createEnrollmentDirect(tenantId, studentId, courseId, instructorId, EnrollmentStatus.ACTIVE);
    const sectionId = await createSectionDirect(tenantId, courseId, 'Section', 1, SectionStatus.PUBLISHED);
    const videoAssetId = await createVideoAssetDirect(tenantId, instructorId, AssetProcessingStatus.READY);
    const lessonId = await createLessonDirect(tenantId, courseId, sectionId, {
      title: 'Video lesson',
      position: 1,
      status: LessonStatus.PUBLISHED,
      videoAssetId,
    });
    await createActiveDevice(studentId, installationId);
    const token = await issueAccessToken(studentId, PlatformRole.STUDENT);

    const response = await request(server)
      .get(accessPath(courseId, lessonId))
      .set('Authorization', `Bearer ${token}`)
      .set(INSTALLATION_ID_HEADER, installationId)
      .expect(HttpStatus.NOT_FOUND);
    expect(response.body).toMatchObject({ error: { code: 'COURSE_NOT_FOUND' } });
  });

  it('denies access with a missing or non-ACTIVE Enrollment', async () => {
    const { tenantId, instructorId } = await createInstructorTenant('no-enrollment');
    const studentId = await createStudent('no-enrollment-student');
    const installationId = installation();
    await createTenantStudent(tenantId, studentId, TenantStudentStatus.ACTIVE);
    const courseId = await createCourseDirect(tenantId, instructorId, 'Course', CourseStatus.PUBLISHED);
    const sectionId = await createSectionDirect(tenantId, courseId, 'Section', 1, SectionStatus.PUBLISHED);
    const videoAssetId = await createVideoAssetDirect(tenantId, instructorId, AssetProcessingStatus.READY);
    const lessonId = await createLessonDirect(tenantId, courseId, sectionId, {
      title: 'Video lesson',
      position: 1,
      status: LessonStatus.PUBLISHED,
      videoAssetId,
    });
    await createActiveDevice(studentId, installationId);
    const token = await issueAccessToken(studentId, PlatformRole.STUDENT);

    // No Enrollment row at all.
    await request(server)
      .get(accessPath(courseId, lessonId))
      .set('Authorization', `Bearer ${token}`)
      .set(INSTALLATION_ID_HEADER, installationId)
      .expect(HttpStatus.NOT_FOUND)
      .expect(({ body }) => expect(body).toMatchObject({ error: { code: 'COURSE_NOT_FOUND' } }));

    // A REVOKED Enrollment row.
    await createEnrollmentDirect(tenantId, studentId, courseId, instructorId, EnrollmentStatus.REVOKED);
    await request(server)
      .get(accessPath(courseId, lessonId))
      .set('Authorization', `Bearer ${token}`)
      .set(INSTALLATION_ID_HEADER, installationId)
      .expect(HttpStatus.NOT_FOUND)
      .expect(({ body }) => expect(body).toMatchObject({ error: { code: 'COURSE_NOT_FOUND' } }));
  });

  it('denies access before a future Enrollment startsAt and allows exactly at startsAt == now', async () => {
    const { tenantId, instructorId } = await createInstructorTenant('starts-at');
    const studentId = await createStudent('starts-at-student');
    const installationId = installation();
    await createTenantStudent(tenantId, studentId, TenantStudentStatus.ACTIVE);
    await createActiveDevice(studentId, installationId);
    const token = await issueAccessToken(studentId, PlatformRole.STUDENT);
    const videoAssetId = await createVideoAssetDirect(tenantId, instructorId, AssetProcessingStatus.READY);

    const futureCourse = await createCourseDirect(tenantId, instructorId, 'Future course', CourseStatus.PUBLISHED);
    await createEnrollmentDirect(tenantId, studentId, futureCourse, instructorId, EnrollmentStatus.ACTIVE, {
      startsAt: new Date(NOW.getTime() + ONE_DAY_MS),
    });
    const futureSection = await createSectionDirect(tenantId, futureCourse, 'Section', 1, SectionStatus.PUBLISHED);
    const futureLesson = await createLessonDirect(tenantId, futureCourse, futureSection, {
      title: 'Video lesson',
      position: 1,
      status: LessonStatus.PUBLISHED,
      videoAssetId,
    });
    await request(server)
      .get(accessPath(futureCourse, futureLesson))
      .set('Authorization', `Bearer ${token}`)
      .set(INSTALLATION_ID_HEADER, installationId)
      .expect(HttpStatus.NOT_FOUND);

    const nowCourse = await createCourseDirect(tenantId, instructorId, 'Now course', CourseStatus.PUBLISHED);
    await createEnrollmentDirect(tenantId, studentId, nowCourse, instructorId, EnrollmentStatus.ACTIVE, {
      startsAt: NOW,
    });
    const nowSection = await createSectionDirect(tenantId, nowCourse, 'Section', 1, SectionStatus.PUBLISHED);
    const nowLesson = await createLessonDirect(tenantId, nowCourse, nowSection, {
      title: 'Video lesson',
      position: 1,
      status: LessonStatus.PUBLISHED,
      videoAssetId,
    });
    await request(server)
      .get(accessPath(nowCourse, nowLesson))
      .set('Authorization', `Bearer ${token}`)
      .set(INSTALLATION_ID_HEADER, installationId)
      .expect(HttpStatus.OK);
  });

  it('denies access after an expired Enrollment endsAt, including endsAt == now', async () => {
    const { tenantId, instructorId } = await createInstructorTenant('ends-at');
    const studentId = await createStudent('ends-at-student');
    const installationId = installation();
    await createTenantStudent(tenantId, studentId, TenantStudentStatus.ACTIVE);
    await createActiveDevice(studentId, installationId);
    const token = await issueAccessToken(studentId, PlatformRole.STUDENT);
    const videoAssetId = await createVideoAssetDirect(tenantId, instructorId, AssetProcessingStatus.READY);

    for (const [label, endsAt] of [
      ['expired', new Date(NOW.getTime() - ONE_DAY_MS)],
      ['ends-at-equal-now', NOW],
    ] as const) {
      const courseId = await createCourseDirect(tenantId, instructorId, `${label} course`, CourseStatus.PUBLISHED);
      await createEnrollmentDirect(tenantId, studentId, courseId, instructorId, EnrollmentStatus.ACTIVE, { endsAt });
      const sectionId = await createSectionDirect(tenantId, courseId, 'Section', 1, SectionStatus.PUBLISHED);
      const lessonId = await createLessonDirect(tenantId, courseId, sectionId, {
        title: 'Video lesson',
        position: 1,
        status: LessonStatus.PUBLISHED,
        videoAssetId,
      });
      await request(server)
        .get(accessPath(courseId, lessonId))
        .set('Authorization', `Bearer ${token}`)
        .set(INSTALLATION_ID_HEADER, installationId)
        .expect(HttpStatus.NOT_FOUND);
    }
  });

  // ---------------------------------------------------------------------------------------------
  // Course / Section / Lesson lifecycle and availability window
  // ---------------------------------------------------------------------------------------------

  it('denies access to a DRAFT or ARCHIVED Course', async () => {
    for (const status of [CourseStatus.DRAFT, CourseStatus.ARCHIVED]) {
      const { tenantId, instructorId } = await createInstructorTenant(`course-status-${status}`);
      const studentId = await createStudent(`course-status-${status}-student`);
      const installationId = installation();
      await createTenantStudent(tenantId, studentId, TenantStudentStatus.ACTIVE);
      const courseId = await createCourseDirect(tenantId, instructorId, 'Course', status);
      await createEnrollmentDirect(tenantId, studentId, courseId, instructorId, EnrollmentStatus.ACTIVE);
      const sectionId = await createSectionDirect(tenantId, courseId, 'Section', 1, SectionStatus.PUBLISHED);
      const videoAssetId = await createVideoAssetDirect(tenantId, instructorId, AssetProcessingStatus.READY);
      const lessonId = await createLessonDirect(tenantId, courseId, sectionId, {
        title: 'Video lesson',
        position: 1,
        status: LessonStatus.PUBLISHED,
        videoAssetId,
      });
      await createActiveDevice(studentId, installationId);
      const token = await issueAccessToken(studentId, PlatformRole.STUDENT);

      await request(server)
        .get(accessPath(courseId, lessonId))
        .set('Authorization', `Bearer ${token}`)
        .set(INSTALLATION_ID_HEADER, installationId)
        .expect(HttpStatus.NOT_FOUND);
    }
  });

  it('denies access to a Lesson under an unpublished Section', async () => {
    for (const status of [SectionStatus.DRAFT, SectionStatus.ARCHIVED]) {
      const setup = await setUpAccessibleVideoLesson(`section-status-${status}`);
      await prisma.client.courseSection.update({ where: { id: setup.sectionId }, data: { status } });

      await getAccess(setup).expect(HttpStatus.NOT_FOUND);
    }
  });

  it('denies access to an unpublished Lesson', async () => {
    for (const status of [LessonStatus.DRAFT, LessonStatus.ARCHIVED]) {
      const setup = await setUpAccessibleVideoLesson(`lesson-status-${status}`);
      await prisma.client.lesson.update({ where: { id: setup.lessonId }, data: { status } });

      await getAccess(setup).expect(HttpStatus.NOT_FOUND);
    }
  });

  it('denies access before availableFrom', async () => {
    const setup = await setUpAccessibleVideoLesson('available-from');
    await prisma.client.lesson.update({
      where: { id: setup.lessonId },
      data: { availableFrom: new Date(NOW.getTime() + ONE_DAY_MS) },
    });

    await getAccess(setup).expect(HttpStatus.NOT_FOUND);
  });

  it('denies access at and after availableUntil', async () => {
    const setup = await setUpAccessibleVideoLesson('available-until');
    await prisma.client.lesson.update({
      where: { id: setup.lessonId },
      data: { availableUntil: NOW },
    });

    await getAccess(setup).expect(HttpStatus.NOT_FOUND);
  });

  // ---------------------------------------------------------------------------------------------
  // Lesson type boundary
  // ---------------------------------------------------------------------------------------------

  it('denies access to a DOCUMENT Lesson via the video access route', async () => {
    const setup = await setUpAccessibleVideoLesson('document-lesson');
    const documentAssetId = await createDocumentAssetDirect(setup.tenantId, setup.instructorId);
    const documentLessonId = await createLessonDirect(setup.tenantId, setup.courseId, setup.sectionId, {
      title: 'Document lesson',
      position: 2,
      status: LessonStatus.PUBLISHED,
      documentAssetId,
    });

    const response = await getAccess(setup, setup.courseId, documentLessonId).expect(HttpStatus.NOT_FOUND);
    expect(response.body).toMatchObject({ error: { code: 'LESSON_NOT_FOUND' } });
  });

  it('denies access to a QUIZ Lesson via the video access route', async () => {
    const setup = await setUpAccessibleVideoLesson('quiz-lesson');
    const quizId = uuid.create();
    await prisma.client.quiz.create({ data: { id: quizId, tenantId: setup.tenantId, title: 'Quiz' } });
    const quizLessonId = await createLessonDirect(setup.tenantId, setup.courseId, setup.sectionId, {
      title: 'Quiz lesson',
      position: 3,
      status: LessonStatus.PUBLISHED,
      quizId,
    });

    const response = await getAccess(setup, setup.courseId, quizLessonId).expect(HttpStatus.NOT_FOUND);
    expect(response.body).toMatchObject({ error: { code: 'LESSON_NOT_FOUND' } });
  });

  // ---------------------------------------------------------------------------------------------
  // Video readiness
  // ---------------------------------------------------------------------------------------------

  it('denies access to a non-READY VideoAsset (UPLOADING, PROCESSING, FAILED, ARCHIVED)', async () => {
    for (const processingStatus of [
      AssetProcessingStatus.UPLOADING,
      AssetProcessingStatus.PROCESSING,
      AssetProcessingStatus.FAILED,
      AssetProcessingStatus.ARCHIVED,
    ]) {
      const setup = await setUpAccessibleVideoLesson(`not-ready-${processingStatus}`, { processingStatus });

      const response = await getAccess(setup).expect(HttpStatus.NOT_FOUND);
      expect(response.body).toMatchObject({ error: { code: 'LESSON_NOT_FOUND' } });
    }
  });

  it('authorizes access once the VideoAsset transitions to READY', async () => {
    const setup = await setUpAccessibleVideoLesson('becomes-ready', {
      processingStatus: AssetProcessingStatus.PROCESSING,
    });
    await getAccess(setup).expect(HttpStatus.NOT_FOUND);

    await prisma.client.videoAsset.update({
      where: { id: setup.videoAssetId },
      data: { processingStatus: AssetProcessingStatus.READY },
    });

    await getAccess(setup).expect(HttpStatus.OK);
  });

  // ---------------------------------------------------------------------------------------------

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
      where: { slug: { startsWith: 'student-video-test-' } },
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
        name: `Student Video Tenant ${slugSuffix}`,
        slug: `student-video-test-${slugSuffix}`,
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

  async function createVideoAssetDirect(
    tenantId: string,
    uploadedByUserId: string,
    processingStatus: AssetProcessingStatus,
    durationSeconds?: number,
  ): Promise<string> {
    const id = uuid.create();
    await prisma.client.videoAsset.create({
      data: {
        id,
        tenantId,
        uploadedByUserId,
        externalAssetRef: `test-provider/video/${id}`,
        processingStatus,
        durationSeconds: durationSeconds ?? null,
      },
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
        processingStatus: AssetProcessingStatus.READY,
      },
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
