import { HttpStatus, INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import * as cookieParser from 'cookie-parser';
import * as request from 'supertest';
import type { App } from 'supertest/types';
import {
  AccountStatus,
  CourseStatus,
  EnrollmentStatus,
  LessonProgressStatus,
  LessonStatus,
  LessonType,
  PlatformRole,
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
import { ClockService } from '../auth/services/clock.service';
import { RefreshSessionService } from '../auth/services/refresh-session.service';
import { UuidV7Service } from '../auth/services/uuid-v7.service';
import { testAuthConfig } from '../auth/test-helpers';
import { TenancyModule } from '../tenancy/tenancy.module';
import { CoursesModule } from './courses.module';

const testDatabaseUrl = process.env.TEST_DATABASE_URL;
const maybeDescribe = testDatabaseUrl ? describe : describe.skip;
const trustedOrigin = 'http://localhost:3000';
const NOW = new Date('2026-06-15T12:00:00.000Z');

maybeDescribe('instructor course progress HTTP PostgreSQL integration', () => {
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
      .useValue({ now: () => NOW })
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

  it('computes completedLessons/totalLessons/progressPercent from the exact currently-visible Lesson set, and derives lastActivityAt from both completions and quiz activity', async () => {
    const { instructorId, tenantId, token } = await createInstructorTenant('denominator');
    const courseId = await createCourseDirect(tenantId, instructorId, 'Denominator course', CourseStatus.PUBLISHED);
    const publishedSection = await createSectionDirect(tenantId, courseId, 'Published section', 1, SectionStatus.PUBLISHED);
    const archivedSection = await createSectionDirect(tenantId, courseId, 'Archived section', 2, SectionStatus.ARCHIVED);

    // Currently visible (counts toward totalLessons):
    const l1 = await createLessonDirect(tenantId, courseId, publishedSection, {
      title: 'L1', position: 1, status: LessonStatus.PUBLISHED,
    });
    const l2 = await createLessonDirect(tenantId, courseId, publishedSection, {
      title: 'L2', position: 2, status: LessonStatus.PUBLISHED,
    });
    // Not visible — DRAFT.
    await createLessonDirect(tenantId, courseId, publishedSection, {
      title: 'Draft lesson', position: 3, status: LessonStatus.DRAFT,
    });
    // Not visible — ARCHIVED.
    await createLessonDirect(tenantId, courseId, publishedSection, {
      title: 'Archived lesson', position: 4, status: LessonStatus.ARCHIVED,
    });
    // Not visible — PUBLISHED but under an unpublished (ARCHIVED) Section.
    await createLessonDirect(tenantId, courseId, archivedSection, {
      title: 'Orphaned lesson', position: 1, status: LessonStatus.PUBLISHED,
    });
    // Not visible — PUBLISHED but not yet available.
    await createLessonDirect(tenantId, courseId, publishedSection, {
      title: 'Future lesson', position: 5, status: LessonStatus.PUBLISHED,
      availableFrom: new Date('2999-01-01T00:00:00.000Z'),
    });
    // Not visible — PUBLISHED but no longer available.
    await createLessonDirect(tenantId, courseId, publishedSection, {
      title: 'Expired lesson', position: 6, status: LessonStatus.PUBLISHED,
      availableUntil: new Date('2020-01-01T00:00:00.000Z'),
    });

    const studentId = await createStudentWithTenant('denominator-student', tenantId, instructorId);
    const enrollmentId = await createEnrollmentDirect(tenantId, studentId, courseId, instructorId, EnrollmentStatus.ACTIVE);
    await completeLessonDirect(tenantId, courseId, l1, studentId, enrollmentId, new Date('2026-06-10T00:00:00.000Z'));

    const response = await request(server)
      .get(`/instructor/tenants/${tenantId}/courses/${courseId}/progress`)
      .set('Authorization', `Bearer ${token}`)
      .expect(HttpStatus.OK);
    type Row = {
      enrollmentId: string;
      completedLessons: number;
      totalLessons: number;
      progressPercent: number;
      lastActivityAt: string | null;
    };
    const body = responseBody<{ items: Row[] }>(response);
    expect(body.items).toHaveLength(1);
    const row = body.items[0];
    expect(row.enrollmentId).toBe(enrollmentId);
    expect(row.totalLessons).toBe(2); // only l1, l2
    expect(row.completedLessons).toBe(1);
    expect(row.progressPercent).toBe(50);
    expect(row.lastActivityAt).toBe('2026-06-10T00:00:00.000Z');
    void l2;

    // A later QuizAttempt touch is more recent than the Lesson completion — lastActivityAt must
    // reflect it.
    const quizId = await createQuizDirect(tenantId, 'Denominator quiz', QuizStatus.PUBLISHED);
    const quizLesson = await createLessonDirect(tenantId, courseId, publishedSection, {
      title: 'Quiz lesson', position: 7, status: LessonStatus.PUBLISHED, quizId,
    });
    await prisma.client.quizAttempt.create({
      data: {
        id: uuid.create(),
        tenantId,
        quizId,
        lessonId: quizLesson,
        studentUserId: studentId,
        enrollmentId,
        status: QuizAttemptStatus.IN_PROGRESS,
        attemptNumber: 1,
        startedAt: new Date('2026-06-12T00:00:00.000Z'),
        updatedAt: new Date('2026-06-12T00:00:00.000Z'),
      },
    });

    const afterAttempt = await request(server)
      .get(`/instructor/tenants/${tenantId}/courses/${courseId}/progress`)
      .set('Authorization', `Bearer ${token}`)
      .expect(HttpStatus.OK);
    const afterAttemptRow = responseBody<{ items: Row[] }>(afterAttempt).items[0];
    expect(afterAttemptRow.lastActivityAt).toBe('2026-06-12T00:00:00.000Z');
    // The new Quiz Lesson widened the currently-visible set to 3; still only 1 completed.
    expect(afterAttemptRow.totalLessons).toBe(3);
    expect(afterAttemptRow.completedLessons).toBe(1);
  });

  it('returns completedLessons = 0 and progressPercent = 0 for every enrollment when the Course currently has zero visible Lessons, while still surfacing prior activity as lastActivityAt', async () => {
    const { instructorId, tenantId, token } = await createInstructorTenant('zero-denominator');
    const courseId = await createCourseDirect(tenantId, instructorId, 'Zero denominator course', CourseStatus.PUBLISHED);
    const sectionId = await createSectionDirect(tenantId, courseId, 'Section', 1, SectionStatus.PUBLISHED);
    // The only Lesson is DRAFT — totalLessons must be 0.
    const draftLesson = await createLessonDirect(tenantId, courseId, sectionId, {
      title: 'Now-draft lesson', position: 1, status: LessonStatus.DRAFT,
    });

    const studentId = await createStudentWithTenant('zero-denominator-student', tenantId, instructorId);
    const enrollmentId = await createEnrollmentDirect(tenantId, studentId, courseId, instructorId, EnrollmentStatus.ACTIVE);
    // Simulates a completion recorded while the Lesson was still PUBLISHED, before it was
    // reverted to DRAFT — a documented, accepted V1 edge case: `lastActivityAt`'s
    // LessonProgress-derived component is NOT scoped to the current Lesson set, so this still
    // surfaces, but `completedLessons`/`totalLessons` ARE scoped, so they read 0/0 regardless.
    await completeLessonDirect(tenantId, courseId, draftLesson, studentId, enrollmentId, new Date('2026-06-01T00:00:00.000Z'));

    const response = await request(server)
      .get(`/instructor/tenants/${tenantId}/courses/${courseId}/progress`)
      .set('Authorization', `Bearer ${token}`)
      .expect(HttpStatus.OK);
    type Row = { completedLessons: number; totalLessons: number; progressPercent: number; lastActivityAt: string | null };
    const row = responseBody<{ items: Row[] }>(response).items[0];
    expect(row.totalLessons).toBe(0);
    expect(row.completedLessons).toBe(0);
    expect(row.progressPercent).toBe(0);
    expect(row.lastActivityAt).toBe('2026-06-01T00:00:00.000Z');
  });

  it('never contaminates a row with another student, another Enrollment, another Course, or another tenant', async () => {
    const { instructorId, tenantId, token } = await createInstructorTenant('isolation');
    const { instructorId: otherInstructorId, tenantId: otherTenantId, token: otherToken } =
      await createInstructorTenant('isolation-other');

    const courseA = await createCourseDirect(tenantId, instructorId, 'Isolation course A', CourseStatus.PUBLISHED);
    const courseB = await createCourseDirect(tenantId, instructorId, 'Isolation course B', CourseStatus.PUBLISHED);
    const sectionA = await createSectionDirect(tenantId, courseA, 'Section A', 1, SectionStatus.PUBLISHED);
    const sectionB = await createSectionDirect(tenantId, courseB, 'Section B', 1, SectionStatus.PUBLISHED);
    const lessonA = await createLessonDirect(tenantId, courseA, sectionA, { title: 'LA', position: 1, status: LessonStatus.PUBLISHED });
    const lessonB = await createLessonDirect(tenantId, courseB, sectionB, { title: 'LB', position: 1, status: LessonStatus.PUBLISHED });

    const studentX = await createStudentWithTenant('isolation-student-x', tenantId, instructorId);
    const studentY = await createStudentWithTenant('isolation-student-y', tenantId, instructorId);

    // Student X is enrolled in both courses; only completes the Lesson in Course A.
    const enrollXA = await createEnrollmentDirect(tenantId, studentX, courseA, instructorId, EnrollmentStatus.ACTIVE);
    const enrollXB = await createEnrollmentDirect(tenantId, studentX, courseB, instructorId, EnrollmentStatus.ACTIVE);
    await completeLessonDirect(tenantId, courseA, lessonA, studentX, enrollXA, new Date('2026-06-05T00:00:00.000Z'));

    // Student Y is enrolled only in Course A and completes nothing.
    const enrollYA = await createEnrollmentDirect(tenantId, studentY, courseA, instructorId, EnrollmentStatus.ACTIVE);

    // A different tenant's course/student/enrollment entirely.
    const otherCourse = await createCourseDirect(otherTenantId, otherInstructorId, 'Other tenant course', CourseStatus.PUBLISHED);
    const otherStudent = await createStudentWithTenant('isolation-other-student', otherTenantId, otherInstructorId);
    await createEnrollmentDirect(otherTenantId, otherStudent, otherCourse, otherInstructorId, EnrollmentStatus.ACTIVE);

    const courseAReport = await request(server)
      .get(`/instructor/tenants/${tenantId}/courses/${courseA}/progress`)
      .set('Authorization', `Bearer ${token}`)
      .expect(HttpStatus.OK);
    type Row = { enrollmentId: string; completedLessons: number; totalLessons: number };
    const rows = responseBody<{ items: Row[] }>(courseAReport).items;
    expect(rows.map((row) => row.enrollmentId).sort()).toEqual([enrollXA, enrollYA].sort());
    expect(rows.every((row) => row.totalLessons === 1)).toBe(true);
    const rowXA = rows.find((row) => row.enrollmentId === enrollXA) as Row;
    const rowYA = rows.find((row) => row.enrollmentId === enrollYA) as Row;
    expect(rowXA.completedLessons).toBe(1); // Student X completed the Lesson in Course A
    expect(rowYA.completedLessons).toBe(0); // Student Y never touched it
    void enrollXB;
    void lessonB;

    // The other tenant's instructor cannot even reach this Course.
    await request(server)
      .get(`/instructor/tenants/${tenantId}/courses/${courseA}/progress`)
      .set('Authorization', `Bearer ${otherToken}`)
      .expect(HttpStatus.FORBIDDEN);
  });

  it('includes REVOKED/EXPIRED Enrollment history by default and narrows correctly with a status filter', async () => {
    const { instructorId, tenantId, token } = await createInstructorTenant('history');
    const courseId = await createCourseDirect(tenantId, instructorId, 'History course', CourseStatus.PUBLISHED);
    await createSectionDirect(tenantId, courseId, 'Section', 1, SectionStatus.PUBLISHED);

    const activeStudent = await createStudentWithTenant('history-active', tenantId, instructorId);
    const revokedStudent = await createStudentWithTenant('history-revoked', tenantId, instructorId);
    const expiredStudent = await createStudentWithTenant('history-expired', tenantId, instructorId);

    const activeEnrollment = await createEnrollmentDirect(tenantId, activeStudent, courseId, instructorId, EnrollmentStatus.ACTIVE);
    const revokedEnrollment = await createEnrollmentDirect(tenantId, revokedStudent, courseId, instructorId, EnrollmentStatus.REVOKED);
    const expiredEnrollment = await createEnrollmentDirect(tenantId, expiredStudent, courseId, instructorId, EnrollmentStatus.EXPIRED);

    const unfiltered = await request(server)
      .get(`/instructor/tenants/${tenantId}/courses/${courseId}/progress`)
      .set('Authorization', `Bearer ${token}`)
      .expect(HttpStatus.OK);
    type Row = { enrollmentId: string };
    expect(
      responseBody<{ items: Row[] }>(unfiltered).items.map((row) => row.enrollmentId).sort(),
    ).toEqual([activeEnrollment, revokedEnrollment, expiredEnrollment].sort());

    const filtered = await request(server)
      .get(`/instructor/tenants/${tenantId}/courses/${courseId}/progress`)
      .query({ status: EnrollmentStatus.REVOKED })
      .set('Authorization', `Bearer ${token}`)
      .expect(HttpStatus.OK);
    expect(responseBody<{ items: Row[] }>(filtered).items.map((row) => row.enrollmentId)).toEqual([revokedEnrollment]);
  });

  it('orders deterministically (newest Enrollment first, stable id tie-break) and paginates', async () => {
    const { instructorId, tenantId, token } = await createInstructorTenant('ordering');
    const courseId = await createCourseDirect(tenantId, instructorId, 'Ordering course', CourseStatus.PUBLISHED);
    await createSectionDirect(tenantId, courseId, 'Section', 1, SectionStatus.PUBLISHED);

    const enrollmentIds: string[] = [];
    for (let i = 0; i < 3; i += 1) {
      const studentId = await createStudentWithTenant(`ordering-student-${i}`, tenantId, instructorId);
      const enrollmentId = uuid.create();
      await prisma.client.enrollment.create({
        data: {
          id: enrollmentId,
          tenantId,
          studentUserId: studentId,
          courseId,
          grantedByUserId: instructorId,
          status: EnrollmentStatus.ACTIVE,
          createdAt: new Date(2026, 0, i + 1),
        },
      });
      enrollmentIds.push(enrollmentId);
    }

    const firstPage = await request(server)
      .get(`/instructor/tenants/${tenantId}/courses/${courseId}/progress`)
      .query({ limit: 2, offset: 0 })
      .set('Authorization', `Bearer ${token}`)
      .expect(HttpStatus.OK);
    type Row = { enrollmentId: string };
    expect(responseBody<{ items: Row[] }>(firstPage).items.map((row) => row.enrollmentId)).toEqual([
      enrollmentIds[2],
      enrollmentIds[1],
    ]);

    const secondPage = await request(server)
      .get(`/instructor/tenants/${tenantId}/courses/${courseId}/progress`)
      .query({ limit: 2, offset: 2 })
      .set('Authorization', `Bearer ${token}`)
      .expect(HttpStatus.OK);
    expect(responseBody<{ items: Row[] }>(secondPage).items.map((row) => row.enrollmentId)).toEqual([enrollmentIds[0]]);
  });

  it('denies a foreign/random Course and a foreign instructor without leaking existence', async () => {
    const { instructorId, tenantId, token } = await createInstructorTenant('deny');
    const { instructorId: otherInstructorId, tenantId: otherTenantId, token: otherToken } =
      await createInstructorTenant('deny-other');
    const courseId = await createCourseDirect(tenantId, instructorId, 'Deny course', CourseStatus.PUBLISHED);
    const otherCourseId = await createCourseDirect(otherTenantId, otherInstructorId, 'Other tenant course', CourseStatus.PUBLISHED);

    const randomCourse = await request(server)
      .get(`/instructor/tenants/${tenantId}/courses/${uuid.create()}/progress`)
      .set('Authorization', `Bearer ${token}`)
      .expect(HttpStatus.NOT_FOUND);
    expect(randomCourse.body).toMatchObject({ error: { code: 'COURSE_NOT_FOUND' } });

    const foreignCourse = await request(server)
      .get(`/instructor/tenants/${tenantId}/courses/${otherCourseId}/progress`)
      .set('Authorization', `Bearer ${token}`)
      .expect(HttpStatus.NOT_FOUND);
    expect(foreignCourse.body).toMatchObject({ error: { code: 'COURSE_NOT_FOUND' } });

    await request(server)
      .get(`/instructor/tenants/${tenantId}/courses/${courseId}/progress`)
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
    await prisma.client.videoLesson.deleteMany();
    await prisma.client.documentLesson.deleteMany();
    await prisma.client.videoAsset.deleteMany();
    await prisma.client.documentAsset.deleteMany();
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
    await prisma.client.tenant.deleteMany({ where: { slug: { startsWith: 'course-progress-test-' } } });
    await prisma.client.user.deleteMany({ where: { normalizedEmail: { endsWith: '@example.test' } } });
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

  async function createInstructorTenant(slugSuffix: string): Promise<{ instructorId: string; tenantId: string; token: string }> {
    const instructorId = await createUser(`instructor-${slugSuffix}`, PlatformRole.INSTRUCTOR);
    await prisma.client.instructorProfile.create({ data: { id: uuid.create(), userId: instructorId } });
    const tenant = await prisma.client.tenant.create({
      data: {
        id: uuid.create(),
        name: `Course Progress Tenant ${slugSuffix}`,
        slug: `course-progress-test-${slugSuffix}`,
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

  async function createCourseDirect(tenantId: string, createdByUserId: string, title: string, status: CourseStatus): Promise<string> {
    const id = uuid.create();
    await prisma.client.course.create({ data: { id, tenantId, createdByUserId, title, status } });
    return id;
  }

  async function createSectionDirect(tenantId: string, courseId: string, title: string, position: number, status: SectionStatus): Promise<string> {
    const id = uuid.create();
    await prisma.client.courseSection.create({ data: { id, tenantId, courseId, title, position, status } });
    return id;
  }

  // `CourseProgressService` never joins `VideoLesson`/`DocumentLesson`/`QuizLesson` — only
  // `Lesson.status`/`type`/`availableFrom`/`availableUntil` and its Section's `status` feed the
  // denominator — so this fixture deliberately does not create a type-specific detail row. The
  // schema has no DB-level constraint requiring one (the "exactly one matching detail row"
  // invariant is enforced by the authoring API, not a CHECK/FK), so this is a safe, minimal
  // fixture for this file's purposes.
  async function createLessonDirect(
    tenantId: string,
    courseId: string,
    sectionId: string,
    spec: { title: string; position: number; status: LessonStatus; quizId?: string; availableFrom?: Date; availableUntil?: Date },
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

    return id;
  }

  async function createQuizDirect(tenantId: string, title: string, status: QuizStatus): Promise<string> {
    const id = uuid.create();
    await prisma.client.quiz.create({ data: { id, tenantId, title, status } });
    return id;
  }

  async function createEnrollmentDirect(
    tenantId: string,
    studentUserId: string,
    courseId: string,
    grantedByUserId: string,
    status: EnrollmentStatus,
  ): Promise<string> {
    const id = uuid.create();
    await prisma.client.enrollment.create({
      data: { id, tenantId, studentUserId, courseId, grantedByUserId, status },
    });
    return id;
  }

  async function completeLessonDirect(
    tenantId: string,
    courseId: string,
    lessonId: string,
    studentUserId: string,
    enrollmentId: string,
    completedAt: Date,
  ): Promise<void> {
    await prisma.client.lessonProgress.create({
      data: {
        id: uuid.create(),
        tenantId,
        courseId,
        lessonId,
        studentUserId,
        enrollmentId,
        status: LessonProgressStatus.COMPLETED,
        completedAt,
        createdAt: completedAt,
        updatedAt: completedAt,
      },
    });
  }

  async function issueAccessToken(userId: string, platformRole: PlatformRole): Promise<string> {
    const session = await refreshSessions.createSession({ userId, channel: 'MOBILE' });
    return accessTokens.sign({ userId, sessionId: session.sessionId, platformRole });
  }
});

function responseBody<T>(response: request.Response): T {
  return response.body as T;
}
