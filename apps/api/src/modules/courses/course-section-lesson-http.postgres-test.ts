import { HttpStatus, INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import * as cookieParser from 'cookie-parser';
import * as request from 'supertest';
import type { App } from 'supertest/types';
import {
  AccountStatus,
  LessonStatus,
  LessonType,
  PlatformRole,
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
import { RefreshSessionService } from '../auth/services/refresh-session.service';
import { UuidV7Service } from '../auth/services/uuid-v7.service';
import { testAuthConfig } from '../auth/test-helpers';
import { TenancyModule } from '../tenancy/tenancy.module';
import { CoursesModule } from './courses.module';

const testDatabaseUrl = process.env.TEST_DATABASE_URL;
const maybeDescribe = testDatabaseUrl ? describe : describe.skip;
const trustedOrigin = 'http://localhost:3000';

maybeDescribe('instructor section/lesson HTTP PostgreSQL integration', () => {
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

    await clearCourseStructureData();
  });

  afterEach(async () => {
    // This module introduces the first Course children with an `onDelete: Restrict` foreign
    // key back to Course (CourseSection, and Lesson beneath it). Every other *.postgres-test.ts
    // file's cleanup does an unconditional `course.deleteMany()` with no knowledge of sections,
    // so any row left behind by this file after its last test would break unrelated suites
    // (auth, devices, tenancy, Course Slice A) when the whole postgres-test run shares one
    // disposable database. Clearing after every test, not just before the next one, guarantees
    // this file never leaves that kind of cross-suite landmine behind.
    await clearCourseStructureData();
    await app?.close();
  });

  it('creates sections and lessons in deterministic position order scoped to the authorized course and tenant', async () => {
    const { token, tenantId, instructorId } = await createInstructorTenant('order-a');
    const courseId = await createCourseDirect(tenantId, instructorId, 'Ordering Course');

    const sectionIds: string[] = [];
    for (const title of ['Intro', 'Core', 'Wrap-up']) {
      const response = await request(server)
        .post(`/instructor/tenants/${tenantId}/courses/${courseId}/sections`)
        .set('Authorization', `Bearer ${token}`)
        .send({ title })
        .expect(HttpStatus.CREATED);

      const body = responseBody<{ sectionId: string; tenantId: string; courseId: string; position: number }>(
        response,
      );
      expect(body.tenantId).toBe(tenantId);
      expect(body.courseId).toBe(courseId);
      sectionIds.push(body.sectionId);
    }

    const sectionList = await request(server)
      .get(`/instructor/tenants/${tenantId}/courses/${courseId}/sections`)
      .set('Authorization', `Bearer ${token}`)
      .expect(HttpStatus.OK);
    const sectionItems = responseBody<{ items: Array<{ sectionId: string; position: number }> }>(
      sectionList,
    ).items;
    expect(sectionItems.map((item) => item.sectionId)).toEqual(sectionIds);
    expect(sectionItems.map((item) => item.position)).toEqual([1, 2, 3]);

    const firstSectionId = sectionIds[0];
    const videoAssetId = await createVideoAssetDirect(tenantId, instructorId);
    const documentAssetId = await createDocumentAssetDirect(tenantId, instructorId);
    const quizId = await createQuizDirect(tenantId, 'Comprehension check');

    const lessonSpecs: Array<Record<string, unknown>> = [
      { title: 'Welcome video', type: 'VIDEO', videoAssetId },
      { title: 'Reading material', type: 'DOCUMENT', documentAssetId },
      { title: 'Check understanding', type: 'QUIZ', quizId },
    ];

    const lessonIds: string[] = [];
    for (const spec of lessonSpecs) {
      const response = await request(server)
        .post(`/instructor/tenants/${tenantId}/courses/${courseId}/sections/${firstSectionId}/lessons`)
        .set('Authorization', `Bearer ${token}`)
        .send(spec)
        .expect(HttpStatus.CREATED);

      const body = responseBody<{ lessonId: string; sectionId: string; type: string }>(response);
      expect(body.sectionId).toBe(firstSectionId);
      expect(body.type).toBe(spec.type);
      lessonIds.push(body.lessonId);
    }

    const lessonList = await request(server)
      .get(`/instructor/tenants/${tenantId}/courses/${courseId}/sections/${firstSectionId}/lessons`)
      .set('Authorization', `Bearer ${token}`)
      .expect(HttpStatus.OK);
    const lessonItems = responseBody<{ items: Array<{ lessonId: string; position: number }> }>(
      lessonList,
    ).items;
    expect(lessonItems.map((item) => item.lessonId)).toEqual(lessonIds);
    expect(lessonItems.map((item) => item.position)).toEqual([1, 2, 3]);
  });

  it('preserves the generic-Lesson/type-detail invariant atomically and rejects mismatched or missing references', async () => {
    const { token, tenantId, instructorId } = await createInstructorTenant('lesson-invariant');
    const courseId = await createCourseDirect(tenantId, instructorId, 'Invariant Course');
    const sectionId = await createSectionDirect(tenantId, courseId, 'Section', 1);
    const videoAssetId = await createVideoAssetDirect(tenantId, instructorId);
    const documentAssetId = await createDocumentAssetDirect(tenantId, instructorId);

    const mismatched = await request(server)
      .post(`/instructor/tenants/${tenantId}/courses/${courseId}/sections/${sectionId}/lessons`)
      .set('Authorization', `Bearer ${token}`)
      .send({ title: 'Bad', type: 'VIDEO', documentAssetId })
      .expect(HttpStatus.BAD_REQUEST);
    expect(mismatched.body).toMatchObject({ error: { code: 'INVALID_LESSON_TYPE_REFERENCE' } });

    const missingReference = await request(server)
      .post(`/instructor/tenants/${tenantId}/courses/${courseId}/sections/${sectionId}/lessons`)
      .set('Authorization', `Bearer ${token}`)
      .send({ title: 'Bad', type: 'VIDEO', videoAssetId: uuid.create() })
      .expect(HttpStatus.NOT_FOUND);
    expect(missingReference.body).toMatchObject({ error: { code: 'LESSON_REFERENCE_NOT_FOUND' } });

    await expect(prisma.client.lesson.count({ where: { sectionId } })).resolves.toBe(0);

    const created = await request(server)
      .post(`/instructor/tenants/${tenantId}/courses/${courseId}/sections/${sectionId}/lessons`)
      .set('Authorization', `Bearer ${token}`)
      .send({ title: 'Intro video', type: 'VIDEO', videoAssetId })
      .expect(HttpStatus.CREATED);
    const lessonId = responseBody<{ lessonId: string }>(created).lessonId;

    const lessonRow = await prisma.client.lesson.findUniqueOrThrow({
      where: { id: lessonId },
      include: { videoLesson: true, documentLesson: true, quizLesson: true },
    });
    expect(lessonRow.videoLesson?.videoAssetId).toBe(videoAssetId);
    expect(lessonRow.documentLesson).toBeNull();
    expect(lessonRow.quizLesson).toBeNull();
  });

  it('rejects Course A + Section B substitution and cross-tenant mutation without changing data', async () => {
    const { token, tenantId, instructorId } = await createInstructorTenant('substitution-a');
    const {
      token: otherToken,
      tenantId: otherTenantId,
      instructorId: otherInstructorId,
    } = await createInstructorTenant('substitution-b');

    const courseA = await createCourseDirect(tenantId, instructorId, 'Course A');
    const courseC = await createCourseDirect(tenantId, instructorId, 'Course C');
    const sectionUnderC = await createSectionDirect(tenantId, courseC, 'Section under C', 1);

    const otherCourse = await createCourseDirect(otherTenantId, otherInstructorId, 'Other tenant course');
    const otherSection = await createSectionDirect(otherTenantId, otherCourse, 'Other tenant section', 1);

    const substitution = await request(server)
      .patch(`/instructor/tenants/${tenantId}/courses/${courseA}/sections/${sectionUnderC}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ title: 'Hijacked' })
      .expect(HttpStatus.NOT_FOUND);
    expect(substitution.body).toMatchObject({ error: { code: 'SECTION_NOT_FOUND' } });

    await expect(
      prisma.client.courseSection.findUniqueOrThrow({ where: { id: sectionUnderC } }),
    ).resolves.toMatchObject({ title: 'Section under C', courseId: courseC });

    await request(server)
      .patch(`/instructor/tenants/${otherTenantId}/courses/${otherCourse}/sections/${otherSection}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ title: 'Hijacked cross-tenant' })
      .expect(HttpStatus.FORBIDDEN);

    await request(server)
      .post(`/instructor/tenants/${otherTenantId}/courses/${otherCourse}/sections/${otherSection}/archive`)
      .set('Authorization', `Bearer ${token}`)
      .expect(HttpStatus.FORBIDDEN);

    await expect(
      prisma.client.courseSection.findUniqueOrThrow({ where: { id: otherSection } }),
    ).resolves.toMatchObject({ title: 'Other tenant section', status: SectionStatus.DRAFT });

    // The other tenant's own authorized instructor may still mutate its own section, and a
    // cross-tenant reorder attempt using tenant A's token against tenant B's course must fail
    // the same way, without touching tenant B's data.
    await request(server)
      .patch(`/instructor/tenants/${otherTenantId}/courses/${otherCourse}/sections/${otherSection}`)
      .set('Authorization', `Bearer ${otherToken}`)
      .send({ title: 'Legit update' })
      .expect(HttpStatus.OK);

    await request(server)
      .post(`/instructor/tenants/${otherTenantId}/courses/${otherCourse}/sections/reorder`)
      .set('Authorization', `Bearer ${token}`)
      .send({ sectionIds: [otherSection] })
      .expect(HttpStatus.FORBIDDEN);
  });

  it('rejects Section A + Lesson B substitution without mutation', async () => {
    const { token, tenantId, instructorId } = await createInstructorTenant('lesson-substitution');
    const courseId = await createCourseDirect(tenantId, instructorId, 'Course');
    const sectionA = await createSectionDirect(tenantId, courseId, 'Section A', 1);
    const sectionB = await createSectionDirect(tenantId, courseId, 'Section B', 2);
    const quizId = await createQuizDirect(tenantId, 'Quiz');
    const lessonBId = await createLessonDirect(tenantId, courseId, sectionB, 'Lesson under B', 1, LessonType.QUIZ, {
      quizId,
    });

    const substitution = await request(server)
      .patch(`/instructor/tenants/${tenantId}/courses/${courseId}/sections/${sectionA}/lessons/${lessonBId}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ title: 'Hijacked lesson' })
      .expect(HttpStatus.NOT_FOUND);
    expect(substitution.body).toMatchObject({ error: { code: 'LESSON_NOT_FOUND' } });

    await request(server)
      .post(`/instructor/tenants/${tenantId}/courses/${courseId}/sections/${sectionA}/lessons/${lessonBId}/archive`)
      .set('Authorization', `Bearer ${token}`)
      .expect(HttpStatus.NOT_FOUND);

    await expect(prisma.client.lesson.findUniqueOrThrow({ where: { id: lessonBId } })).resolves.toMatchObject({
      title: 'Lesson under B',
      sectionId: sectionB,
      status: LessonStatus.DRAFT,
    });
  });

  it('reorders sections into exactly the requested order and rejects invalid reorder payloads without mutation', async () => {
    const { token, tenantId, instructorId } = await createInstructorTenant('reorder-sections');
    const courseId = await createCourseDirect(tenantId, instructorId, 'Reorder Course');
    const s1 = await createSectionDirect(tenantId, courseId, 'S1', 1);
    const s2 = await createSectionDirect(tenantId, courseId, 'S2', 2);
    const s3 = await createSectionDirect(tenantId, courseId, 'S3', 3);
    const s4 = await createSectionDirect(tenantId, courseId, 'S4', 4);

    const foreignCourseId = await createCourseDirect(tenantId, instructorId, 'Foreign course');
    const foreignSectionId = await createSectionDirect(tenantId, foreignCourseId, 'Foreign section', 1);

    const before = await prisma.client.courseSection.findMany({
      where: { courseId },
      orderBy: { position: 'asc' },
    });

    const missingId = await request(server)
      .post(`/instructor/tenants/${tenantId}/courses/${courseId}/sections/reorder`)
      .set('Authorization', `Bearer ${token}`)
      .send({ sectionIds: [s1, s2, s3] })
      .expect(HttpStatus.BAD_REQUEST);
    expect(missingId.body).toMatchObject({ error: { code: 'INVALID_SECTION_REORDER' } });

    const duplicateId = await request(server)
      .post(`/instructor/tenants/${tenantId}/courses/${courseId}/sections/reorder`)
      .set('Authorization', `Bearer ${token}`)
      .send({ sectionIds: [s1, s1, s2, s3] })
      .expect(HttpStatus.BAD_REQUEST);
    expect(duplicateId.body).toMatchObject({ error: { code: 'VALIDATION_FAILED' } });

    const foreignId = await request(server)
      .post(`/instructor/tenants/${tenantId}/courses/${courseId}/sections/reorder`)
      .set('Authorization', `Bearer ${token}`)
      .send({ sectionIds: [s1, s2, s3, foreignSectionId] })
      .expect(HttpStatus.BAD_REQUEST);
    expect(foreignId.body).toMatchObject({ error: { code: 'INVALID_SECTION_REORDER' } });

    const after = await prisma.client.courseSection.findMany({
      where: { courseId },
      orderBy: { position: 'asc' },
    });
    expect(after).toEqual(before);
    await expect(
      prisma.client.courseSection.findUniqueOrThrow({ where: { id: foreignSectionId } }),
    ).resolves.toMatchObject({ courseId: foreignCourseId });

    const reordered = await request(server)
      .post(`/instructor/tenants/${tenantId}/courses/${courseId}/sections/reorder`)
      .set('Authorization', `Bearer ${token}`)
      .send({ sectionIds: [s4, s2, s1, s3] })
      .expect(HttpStatus.OK);
    expect(responseBody<{ items: Array<{ sectionId: string }> }>(reordered).items.map((i) => i.sectionId)).toEqual([
      s4,
      s2,
      s1,
      s3,
    ]);

    const finalRows = await prisma.client.courseSection.findMany({
      where: { courseId },
      orderBy: { position: 'asc' },
    });
    expect(finalRows.map((row) => row.id)).toEqual([s4, s2, s1, s3]);
    expect(new Set(finalRows.map((row) => row.position)).size).toBe(finalRows.length);
  });

  it('reorders lessons within a section into exactly the requested order and rejects invalid payloads', async () => {
    const { token, tenantId, instructorId } = await createInstructorTenant('reorder-lessons');
    const courseId = await createCourseDirect(tenantId, instructorId, 'Reorder Lessons Course');
    const sectionId = await createSectionDirect(tenantId, courseId, 'Section', 1);
    const quizId = await createQuizDirect(tenantId, 'Quiz');
    const l1 = await createLessonDirect(tenantId, courseId, sectionId, 'L1', 1, LessonType.QUIZ, { quizId });
    const l2 = await createLessonDirect(tenantId, courseId, sectionId, 'L2', 2, LessonType.QUIZ, { quizId });
    const l3 = await createLessonDirect(tenantId, courseId, sectionId, 'L3', 3, LessonType.QUIZ, { quizId });

    const otherSectionId = await createSectionDirect(tenantId, courseId, 'Other section', 2);
    const foreignLessonId = await createLessonDirect(tenantId, courseId, otherSectionId, 'Foreign lesson', 1, LessonType.QUIZ, {
      quizId,
    });

    const foreignId = await request(server)
      .post(`/instructor/tenants/${tenantId}/courses/${courseId}/sections/${sectionId}/lessons/reorder`)
      .set('Authorization', `Bearer ${token}`)
      .send({ lessonIds: [l1, l2, l3, foreignLessonId] })
      .expect(HttpStatus.BAD_REQUEST);
    expect(foreignId.body).toMatchObject({ error: { code: 'INVALID_LESSON_REORDER' } });

    await expect(prisma.client.lesson.findUniqueOrThrow({ where: { id: foreignLessonId } })).resolves.toMatchObject({
      sectionId: otherSectionId,
    });

    const reordered = await request(server)
      .post(`/instructor/tenants/${tenantId}/courses/${courseId}/sections/${sectionId}/lessons/reorder`)
      .set('Authorization', `Bearer ${token}`)
      .send({ lessonIds: [l3, l1, l2] })
      .expect(HttpStatus.OK);
    expect(responseBody<{ items: Array<{ lessonId: string }> }>(reordered).items.map((i) => i.lessonId)).toEqual([
      l3,
      l1,
      l2,
    ]);

    const finalRows = await prisma.client.lesson.findMany({
      where: { sectionId },
      orderBy: { position: 'asc' },
    });
    expect(finalRows.map((row) => row.id)).toEqual([l3, l1, l2]);
    expect(new Set(finalRows.map((row) => row.position)).size).toBe(finalRows.length);
  });

  it('archives a section: excluded from reorder while preserving its position and history', async () => {
    const { token, tenantId, instructorId } = await createInstructorTenant('archive-history');
    const courseId = await createCourseDirect(tenantId, instructorId, 'Archive Course');
    const s1 = await createSectionDirect(tenantId, courseId, 'S1', 1);
    const s2 = await createSectionDirect(tenantId, courseId, 'S2', 2);
    const s3 = await createSectionDirect(tenantId, courseId, 'S3', 3);

    const archiveResponse = await request(server)
      .post(`/instructor/tenants/${tenantId}/courses/${courseId}/sections/${s2}/archive`)
      .set('Authorization', `Bearer ${token}`)
      .expect(HttpStatus.OK);
    expect(archiveResponse.body).toMatchObject({ sectionId: s2, status: SectionStatus.ARCHIVED, position: 2 });

    const list = await request(server)
      .get(`/instructor/tenants/${tenantId}/courses/${courseId}/sections`)
      .set('Authorization', `Bearer ${token}`)
      .expect(HttpStatus.OK);
    const items = responseBody<{ items: Array<{ sectionId: string; status: string }> }>(list).items;
    expect(items.map((item) => item.sectionId)).toEqual([s1, s2, s3]);
    expect(items.find((item) => item.sectionId === s2)?.status).toBe(SectionStatus.ARCHIVED);

    // Reordering the remaining active siblings must not require (or be blocked by) the
    // archived section, and must not collide with its retained position value.
    const reordered = await request(server)
      .post(`/instructor/tenants/${tenantId}/courses/${courseId}/sections/reorder`)
      .set('Authorization', `Bearer ${token}`)
      .send({ sectionIds: [s3, s1] })
      .expect(HttpStatus.OK);
    expect(responseBody<{ items: Array<{ sectionId: string }> }>(reordered).items.map((i) => i.sectionId)).toEqual([
      s3,
      s1,
    ]);

    await expect(prisma.client.courseSection.findUniqueOrThrow({ where: { id: s2 } })).resolves.toMatchObject({
      status: SectionStatus.ARCHIVED,
      position: 2,
    });

    const allPositions = await prisma.client.courseSection.findMany({
      where: { courseId },
      select: { position: true },
    });
    expect(new Set(allPositions.map((row) => row.position)).size).toBe(3);

    // Archiving is idempotent.
    await request(server)
      .post(`/instructor/tenants/${tenantId}/courses/${courseId}/sections/${s2}/archive`)
      .set('Authorization', `Bearer ${token}`)
      .expect(HttpStatus.OK);
  });

  it('does not create duplicate positions under concurrent Section creation', async () => {
    const { token, tenantId, instructorId } = await createInstructorTenant('concurrency-section');
    const courseId = await createCourseDirect(tenantId, instructorId, 'Concurrency Course');

    const responses = await Promise.all([
      request(server)
        .post(`/instructor/tenants/${tenantId}/courses/${courseId}/sections`)
        .set('Authorization', `Bearer ${token}`)
        .send({ title: 'Concurrent A' }),
      request(server)
        .post(`/instructor/tenants/${tenantId}/courses/${courseId}/sections`)
        .set('Authorization', `Bearer ${token}`)
        .send({ title: 'Concurrent B' }),
      request(server)
        .post(`/instructor/tenants/${tenantId}/courses/${courseId}/sections`)
        .set('Authorization', `Bearer ${token}`)
        .send({ title: 'Concurrent C' }),
    ]);

    const statuses: number[] = responses.map((response) => response.status);
    const createdStatus: number = HttpStatus.CREATED;
    const conflictStatus: number = HttpStatus.CONFLICT;
    expect(statuses.every((status) => status === createdStatus || status === conflictStatus)).toBe(true);
    const createdCount = statuses.filter((status) => status === createdStatus).length;
    expect(createdCount).toBeGreaterThanOrEqual(1);

    const sectionsInDb = await prisma.client.courseSection.findMany({ where: { courseId } });
    expect(sectionsInDb).toHaveLength(createdCount);
    expect(new Set(sectionsInDb.map((row) => row.position)).size).toBe(sectionsInDb.length);
  });

  it('does not create duplicate positions under concurrent Lesson creation', async () => {
    const { token, tenantId, instructorId } = await createInstructorTenant('concurrency-lesson');
    const courseId = await createCourseDirect(tenantId, instructorId, 'Concurrency Lesson Course');
    const sectionId = await createSectionDirect(tenantId, courseId, 'Section', 1);
    const quizId = await createQuizDirect(tenantId, 'Concurrent quiz');

    const responses = await Promise.all([
      request(server)
        .post(`/instructor/tenants/${tenantId}/courses/${courseId}/sections/${sectionId}/lessons`)
        .set('Authorization', `Bearer ${token}`)
        .send({ title: 'Concurrent lesson A', type: 'QUIZ', quizId }),
      request(server)
        .post(`/instructor/tenants/${tenantId}/courses/${courseId}/sections/${sectionId}/lessons`)
        .set('Authorization', `Bearer ${token}`)
        .send({ title: 'Concurrent lesson B', type: 'QUIZ', quizId }),
      request(server)
        .post(`/instructor/tenants/${tenantId}/courses/${courseId}/sections/${sectionId}/lessons`)
        .set('Authorization', `Bearer ${token}`)
        .send({ title: 'Concurrent lesson C', type: 'QUIZ', quizId }),
    ]);

    const statuses: number[] = responses.map((response) => response.status);
    const createdStatus: number = HttpStatus.CREATED;
    const conflictStatus: number = HttpStatus.CONFLICT;
    expect(statuses.every((status) => status === createdStatus || status === conflictStatus)).toBe(true);
    const createdCount = statuses.filter((status) => status === createdStatus).length;
    expect(createdCount).toBeGreaterThanOrEqual(1);

    const lessonsInDb = await prisma.client.lesson.findMany({ where: { sectionId } });
    expect(lessonsInDb).toHaveLength(createdCount);
    expect(new Set(lessonsInDb.map((row) => row.position)).size).toBe(lessonsInDb.length);
  });

  it('denies student and platform admin use of instructor section/lesson mutation routes', async () => {
    const { tenantId, instructorId } = await createInstructorTenant('role-guard');
    const studentId = await createUser('section-student', PlatformRole.STUDENT);
    const adminId = await createUser('section-admin', PlatformRole.PLATFORM_ADMIN);
    const studentToken = await issueAccessToken(studentId, PlatformRole.STUDENT);
    const adminToken = await issueAccessToken(adminId, PlatformRole.PLATFORM_ADMIN);
    const courseId = await createCourseDirect(tenantId, instructorId, 'Role guarded course');
    const sectionId = await createSectionDirect(tenantId, courseId, 'Section', 1);

    await request(server)
      .post(`/instructor/tenants/${tenantId}/courses/${courseId}/sections`)
      .set('Authorization', `Bearer ${studentToken}`)
      .send({ title: 'Student section' })
      .expect(HttpStatus.FORBIDDEN);

    await request(server)
      .post(`/instructor/tenants/${tenantId}/courses/${courseId}/sections`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ title: 'Admin section' })
      .expect(HttpStatus.FORBIDDEN);

    await request(server)
      .patch(`/instructor/tenants/${tenantId}/courses/${courseId}/sections/${sectionId}`)
      .set('Authorization', `Bearer ${studentToken}`)
      .send({ title: 'Student update' })
      .expect(HttpStatus.FORBIDDEN);

    await request(server)
      .post(`/instructor/tenants/${tenantId}/courses/${courseId}/sections/${sectionId}/archive`)
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(HttpStatus.FORBIDDEN);
  });

  async function clearCourseStructureData(): Promise<void> {
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
    await prisma.client.refreshSession.deleteMany();
    await prisma.client.accountActivationToken.deleteMany();
    await prisma.client.passwordResetToken.deleteMany();
    await prisma.client.authCredential.deleteMany();
    await prisma.client.tenantStudent.deleteMany();
    await prisma.client.tenantMembership.deleteMany();
    await prisma.client.studentDevice.deleteMany();
    await prisma.client.studentProfile.deleteMany();
    await prisma.client.instructorProfile.deleteMany();
    await prisma.client.tenant.deleteMany({
      where: { slug: { startsWith: 'section-lesson-test-' } },
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

  async function createInstructorTenant(slugSuffix: string): Promise<{
    instructorId: string;
    tenantId: string;
    token: string;
  }> {
    const instructorId = await createUser(`instructor-${slugSuffix}`, PlatformRole.INSTRUCTOR);
    await prisma.client.instructorProfile.create({
      data: { id: uuid.create(), userId: instructorId },
    });
    const tenant = await prisma.client.tenant.create({
      data: {
        id: uuid.create(),
        name: `Section Lesson Tenant ${slugSuffix}`,
        slug: `section-lesson-test-${slugSuffix}`,
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
    return {
      instructorId,
      tenantId: tenant.id,
      token: await issueAccessToken(instructorId, PlatformRole.INSTRUCTOR),
    };
  }

  async function createCourseDirect(tenantId: string, createdByUserId: string, title: string): Promise<string> {
    const id = uuid.create();
    await prisma.client.course.create({
      data: { id, tenantId, createdByUserId, title },
    });
    return id;
  }

  async function createSectionDirect(
    tenantId: string,
    courseId: string,
    title: string,
    position: number,
  ): Promise<string> {
    const id = uuid.create();
    await prisma.client.courseSection.create({
      data: { id, tenantId, courseId, title, position },
    });
    return id;
  }

  async function createLessonDirect(
    tenantId: string,
    courseId: string,
    sectionId: string,
    title: string,
    position: number,
    type: LessonType,
    reference: { videoAssetId?: string; documentAssetId?: string; quizId?: string },
  ): Promise<string> {
    const id = uuid.create();
    await prisma.client.lesson.create({
      data: { id, tenantId, courseId, sectionId, title, type, position },
    });

    if (type === LessonType.VIDEO) {
      await prisma.client.videoLesson.create({
        data: { lessonId: id, tenantId, videoAssetId: reference.videoAssetId as string },
      });
    } else if (type === LessonType.DOCUMENT) {
      await prisma.client.documentLesson.create({
        data: { lessonId: id, tenantId, documentAssetId: reference.documentAssetId as string },
      });
    } else {
      await prisma.client.quizLesson.create({
        data: { lessonId: id, tenantId, quizId: reference.quizId as string },
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

  async function issueAccessToken(userId: string, platformRole: PlatformRole): Promise<string> {
    const session = await refreshSessions.createSession({ userId, channel: 'MOBILE' });
    return accessTokens.sign({ userId, sessionId: session.sessionId, platformRole });
  }
});

function responseBody<T>(response: request.Response): T {
  return response.body as T;
}
