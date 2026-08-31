import { HttpStatus, INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import * as cookieParser from 'cookie-parser';
import * as request from 'supertest';
import type { App } from 'supertest/types';
import {
  AccountStatus,
  CourseStatus,
  CourseVisibility,
  CredentialType,
  DevicePlatform,
  EnrollmentStatus,
  PlatformRole,
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
import { PasswordService } from '../auth/services/password.service';
import { RefreshSessionService } from '../auth/services/refresh-session.service';
import { TokenCryptoService } from '../auth/services/token-crypto.service';
import { UuidV7Service } from '../auth/services/uuid-v7.service';
import { testAuthConfig } from '../auth/test-helpers';
import { INSTALLATION_ID_HEADER } from '../devices/types/device.types';
import { TenancyModule } from './tenancy.module';

const testDatabaseUrl = process.env.TEST_DATABASE_URL;
const maybeDescribe = testDatabaseUrl ? describe : describe.skip;
const trustedOrigin = 'http://localhost:3000';

maybeDescribe('tenancy and enrollment HTTP PostgreSQL integration', () => {
  let app: INestApplication;
  let server: App;
  let prisma: PrismaService;
  let accessTokens: AccessTokenService;
  let refreshSessions: RefreshSessionService;
  let passwordService: PasswordService;
  let tokenCrypto: TokenCryptoService;
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
      imports: [AuthModule, TenancyModule],
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
    passwordService = moduleRef.get(PasswordService);
    tokenCrypto = moduleRef.get(TokenCryptoService);
    uuid = moduleRef.get(UuidV7Service);

    await clearTenancyData();
  });

  afterEach(async () => {
    await app?.close();
  });

  it('allows Platform Admin to create, list, and read instructors with one-time activation token material', async () => {
    const adminId = await createUser('tenancy-admin', PlatformRole.PLATFORM_ADMIN);
    const adminToken = await issueAccessToken(adminId, PlatformRole.PLATFORM_ADMIN);

    const created = await request(server)
      .post('/admin/instructors')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        email: '  New.Instructor@Example.TEST  ',
        displayName: 'New Instructor',
        tenantName: 'New Academy',
        tenantSlug: 'new-academy',
      })
      .expect(HttpStatus.CREATED);
    const createdBody = responseBody<{
      email: string;
      tenantId: string;
      activation: { rawToken: string; purpose: string };
    }>(created);

    expect(created.headers['cache-control']).toBe('no-store');
    expect(createdBody.email).toBe('New.Instructor@Example.TEST');
    expect(createdBody.activation.rawToken).toEqual(expect.any(String));
    expect(createdBody.activation.purpose).toBe('INSTRUCTOR_ACTIVATION');

    const user = await prisma.client.user.findUniqueOrThrow({
      where: { normalizedEmail: 'new.instructor@example.test' },
      include: {
        instructorProfile: true,
        tenantMemberships: true,
        accountActivationTokens: true,
      },
    });
    expect(user.platformRole).toBe(PlatformRole.INSTRUCTOR);
    expect(user.instructorProfile).toBeTruthy();
    expect(user.tenantMemberships).toHaveLength(1);
    expect(user.tenantMemberships[0].role).toBe(TenantMembershipRole.OWNER);
    expect(user.accountActivationTokens[0].tokenHash).not.toBe(createdBody.activation.rawToken);
    expect(user.accountActivationTokens[0].tenantId).toBe(createdBody.tenantId);

    await request(server)
      .get('/admin/instructors?limit=10&offset=0')
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(HttpStatus.OK)
      .expect(({ body }) => {
        const typed = body as { items: Array<{ userId: string }> };
        expect(typed.items.some((item) => item.userId === user.id)).toBe(true);
      });

    await request(server)
      .get(`/admin/instructors/${user.id}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(HttpStatus.OK)
      .expect(({ body }) => {
        const typed = body as { userId: string; tenantSlug: string };
        expect(typed.userId).toBe(user.id);
        expect(typed.tenantSlug).toBe('new-academy');
      });
  });

  it('rejects cross-role instructor reuse and handles concurrent same-email instructor creation', async () => {
    const adminId = await createUser('tenancy-admin-conflict', PlatformRole.PLATFORM_ADMIN);
    const adminToken = await issueAccessToken(adminId, PlatformRole.PLATFORM_ADMIN);
    await createUser('role-conflict', PlatformRole.STUDENT);

    await request(server)
      .post('/admin/instructors')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        email: 'role-conflict@example.test',
        tenantName: 'Conflict Academy',
        tenantSlug: 'conflict-academy',
      })
      .expect(HttpStatus.CONFLICT);

    const payload = {
      email: 'race-instructor@example.test',
      tenantName: 'Race Academy',
      tenantSlug: 'race-academy',
    };
    const [first, second] = await Promise.all([
      request(server).post('/admin/instructors').set('Authorization', `Bearer ${adminToken}`).send(payload),
      request(server).post('/admin/instructors').set('Authorization', `Bearer ${adminToken}`).send(payload),
    ]);

    const statuses = [first.status, second.status].sort();
    expect(statuses).toEqual([HttpStatus.CREATED, HttpStatus.CONFLICT].sort());
    await expect(
      prisma.client.user.count({ where: { normalizedEmail: 'race-instructor@example.test' } }),
    ).resolves.toBe(1);
    await expect(prisma.client.tenant.count({ where: { slug: 'race-academy' } })).resolves.toBe(1);
  });

  it('adds students through authorized tenants and preserves global identity across tenants under races', async () => {
    const { token: instructorToken, tenantId } = await createInstructorTenant('tenant-a');
    const { token: otherInstructorToken, tenantId: otherTenantId } = await createInstructorTenant('tenant-b');

    const [sameFirst, sameSecond] = await Promise.all([
      addStudent(instructorToken, tenantId, 'same-new-student@example.test'),
      addStudent(instructorToken, tenantId, 'same-new-student@example.test'),
    ]);
    expect([sameFirst.status, sameSecond.status].filter((status) => status === 201)).toHaveLength(2);
    await expect(
      prisma.client.user.count({ where: { normalizedEmail: 'same-new-student@example.test' } }),
    ).resolves.toBe(1);
    await expect(
      prisma.client.tenantStudent.count({
        where: {
          tenantId,
          student: { normalizedEmail: 'same-new-student@example.test' },
        },
      }),
    ).resolves.toBe(1);

    const [tenantA, tenantB] = await Promise.all([
      addStudent(instructorToken, tenantId, 'global-student@example.test'),
      addStudent(otherInstructorToken, otherTenantId, 'global-student@example.test'),
    ]);
    expect(tenantA.status).toBe(HttpStatus.CREATED);
    expect(tenantB.status).toBe(HttpStatus.CREATED);
    const globalStudent = await prisma.client.user.findUniqueOrThrow({
      where: { normalizedEmail: 'global-student@example.test' },
      include: { studentProfile: true, tenantStudentAssociations: true },
    });
    expect(globalStudent.studentProfile).toBeTruthy();
    expect(globalStudent.tenantStudentAssociations).toHaveLength(2);

    await request(server)
      .get(`/instructor/tenants/${otherTenantId}/students`)
      .set('Authorization', `Bearer ${instructorToken}`)
      .expect(HttpStatus.FORBIDDEN);
  });

  it('associates an existing activated student without issuing a new activation token or changing auth/device/session state', async () => {
    const { token: instructorToken, tenantId, instructorId } = await createInstructorTenant('existing-student');
    const existingStudentId = await createUser('existing-activated-student', PlatformRole.STUDENT);
    await prisma.client.studentProfile.create({
      data: { id: uuid.create(), userId: existingStudentId },
    });
    await createCredential(existingStudentId, 'existing student password');
    await createActiveDevice(existingStudentId, installation(71));
    await refreshSessions.createSession({ userId: existingStudentId, channel: 'MOBILE' });

    const before = await authState(existingStudentId);

    const response = await request(server)
      .post(`/instructor/tenants/${tenantId}/students`)
      .set('Authorization', `Bearer ${instructorToken}`)
      .send({ email: 'existing-activated-student@example.test', displayName: 'Ignored Name' })
      .expect(HttpStatus.CREATED);

    const body = responseBody<{ userId: string; activation: null }>(response);
    expect(body.userId).toBe(existingStudentId);
    expect(body.activation).toBeNull();
    await expect(
      prisma.client.tenantStudent.count({
        where: { tenantId, studentUserId: existingStudentId, createdByUserId: instructorId },
      }),
    ).resolves.toBe(1);
    await expect(authState(existingStudentId)).resolves.toEqual(before);
  });

  it('scopes student detail and enrollment mutations to authorized tenant instructors', async () => {
    const { token: instructorToken, tenantId, instructorId } = await createInstructorTenant('scope-a');
    const { token: otherInstructorToken, tenantId: otherTenantId, instructorId: otherInstructorId } =
      await createInstructorTenant('scope-b');
    const studentId = await createStudentWithTenant('scope-student', tenantId, instructorId);
    const otherStudentId = await createStudentWithTenant('scope-other-student', otherTenantId, otherInstructorId);
    const courseId = await createCourse(tenantId, instructorId, 'Tenant A course');
    const otherCourseId = await createCourse(otherTenantId, otherInstructorId, 'Tenant B course');

    await request(server)
      .get(`/instructor/tenants/${tenantId}/students/${studentId}`)
      .set('Authorization', `Bearer ${instructorToken}`)
      .expect(HttpStatus.OK);

    await request(server)
      .get(`/instructor/tenants/${otherTenantId}/students/${otherStudentId}`)
      .set('Authorization', `Bearer ${instructorToken}`)
      .expect(HttpStatus.FORBIDDEN);

    await request(server)
      .post(`/instructor/tenants/${tenantId}/enrollments`)
      .set('Authorization', `Bearer ${instructorToken}`)
      .send({ studentUserId: otherStudentId, courseId })
      .expect(HttpStatus.NOT_FOUND);

    await request(server)
      .post(`/instructor/tenants/${tenantId}/enrollments`)
      .set('Authorization', `Bearer ${instructorToken}`)
      .send({ studentUserId: studentId, courseId: otherCourseId })
      .expect(HttpStatus.NOT_FOUND);

    const enrollment = await request(server)
      .post(`/instructor/tenants/${tenantId}/enrollments`)
      .set('Authorization', `Bearer ${instructorToken}`)
      .send({ studentUserId: studentId, courseId })
      .expect(HttpStatus.CREATED);
    const enrollmentBody = responseBody<{ enrollmentId: string }>(enrollment);

    await request(server)
      .post(`/instructor/tenants/${otherTenantId}/enrollments/${enrollmentBody.enrollmentId}/revoke`)
      .set('Authorization', `Bearer ${otherInstructorToken}`)
      .expect(HttpStatus.NOT_FOUND);
  });

  it('expires stale active enrollments transactionally and prevents duplicate active enrollment races', async () => {
    const { token: instructorToken, tenantId, instructorId } = await createInstructorTenant('enrollment-race');
    const studentId = await createStudentWithTenant('enrollment-student', tenantId, instructorId);
    const courseId = await createCourse(tenantId, instructorId, 'Enrollment course');

    const staleId = uuid.create();
    await prisma.client.enrollment.create({
      data: {
        id: staleId,
        tenantId,
        studentUserId: studentId,
        courseId,
        grantedByUserId: instructorId,
        status: EnrollmentStatus.ACTIVE,
        endsAt: new Date(Date.now() - 60_000),
      },
    });

    const replacement = await request(server)
      .post(`/instructor/tenants/${tenantId}/enrollments`)
      .set('Authorization', `Bearer ${instructorToken}`)
      .send({ studentUserId: studentId, courseId })
      .expect(HttpStatus.CREATED);
    const replacementBody = responseBody<{ enrollmentId: string }>(replacement);
    expect(replacementBody.enrollmentId).not.toBe(staleId);
    await expect(
      prisma.client.enrollment.findUniqueOrThrow({ where: { id: staleId } }),
    ).resolves.toMatchObject({ status: EnrollmentStatus.EXPIRED });

    const raceCourseId = await createCourse(tenantId, instructorId, 'Enrollment race course');
    const [first, second] = await Promise.all([
      request(server)
        .post(`/instructor/tenants/${tenantId}/enrollments`)
        .set('Authorization', `Bearer ${instructorToken}`)
        .send({ studentUserId: studentId, courseId: raceCourseId }),
      request(server)
        .post(`/instructor/tenants/${tenantId}/enrollments`)
        .set('Authorization', `Bearer ${instructorToken}`)
        .send({ studentUserId: studentId, courseId: raceCourseId }),
    ]);
    expect([first.status, second.status].sort()).toEqual(
      [HttpStatus.CREATED, HttpStatus.CONFLICT].sort(),
    );
    await expect(
      prisma.client.enrollment.count({
        where: { studentUserId: studentId, courseId: raceCourseId, status: EnrollmentStatus.ACTIVE },
      }),
    ).resolves.toBe(1);

    const revoked = await request(server)
      .post(`/instructor/tenants/${tenantId}/enrollments/${replacementBody.enrollmentId}/revoke`)
      .set('Authorization', `Bearer ${instructorToken}`)
      .expect(HttpStatus.OK);
    expect(responseBody<{ status: string }>(revoked).status).toBe(EnrollmentStatus.REVOKED);
  });

  it('requires approved device for student enrollment reads and returns only the authenticated student enrollments', async () => {
    const { tenantId, instructorId } = await createInstructorTenant('student-read');
    const studentId = await createStudentWithTenant('reader-student', tenantId, instructorId);
    const otherStudentId = await createStudentWithTenant('other-reader-student', tenantId, instructorId);
    const courseId = await createCourse(tenantId, instructorId, 'Student read course');
    const otherCourseId = await createCourse(tenantId, instructorId, 'Other read course');
    await createEnrollment(tenantId, studentId, courseId, instructorId);
    await createEnrollment(tenantId, otherStudentId, otherCourseId, instructorId);
    const studentToken = await issueAccessToken(studentId, PlatformRole.STUDENT);
    const installationId = installation(90);

    await request(server)
      .get('/student/enrollments')
      .set('Authorization', `Bearer ${studentToken}`)
      .set(INSTALLATION_ID_HEADER, installationId)
      .expect(HttpStatus.FORBIDDEN);

    await createActiveDevice(studentId, installationId);

    await request(server)
      .get('/student/enrollments?limit=10&offset=0')
      .set('Authorization', `Bearer ${studentToken}`)
      .set(INSTALLATION_ID_HEADER, installationId)
      .expect(HttpStatus.OK)
      .expect(({ body }) => {
        const typed = body as { items: Array<Record<string, unknown>> };
        expect(typed.items).toHaveLength(1);
        expect(typed.items[0]).toMatchObject({
          tenantId,
          courseId,
          courseTitle: 'Student read course',
          status: EnrollmentStatus.ACTIVE,
        });
        expect(typed.items[0].studentUserId).toBeUndefined();
      });
  });

  // --- Enrollment Visibility Slice: instructor course-roster / student-enrollment reads ---

  it('lists a course roster scoped to the exact tenant/course, with student contact info, currentlyEffective, deterministic ordering, and pagination', async () => {
    const { token, tenantId, instructorId } = await createInstructorTenant('roster');
    const courseX = await createCourse(tenantId, instructorId, 'Roster course X');
    const courseY = await createCourse(tenantId, instructorId, 'Roster course Y');
    const student1 = await createStudentWithTenant('roster-student-1', tenantId, instructorId);
    const student2 = await createStudentWithTenant('roster-student-2', tenantId, instructorId);
    const student3 = await createStudentWithTenant('roster-student-3', tenantId, instructorId);

    const enrollment1 = await createEnrollmentDirect({
      tenantId,
      studentUserId: student1,
      courseId: courseX,
      grantedByUserId: instructorId,
      status: EnrollmentStatus.ACTIVE,
      createdAt: new Date('2026-01-01T00:00:00.000Z'),
    });
    const enrollment2 = await createEnrollmentDirect({
      tenantId,
      studentUserId: student2,
      courseId: courseX,
      grantedByUserId: instructorId,
      status: EnrollmentStatus.ACTIVE,
      startsAt: new Date('2999-01-01T00:00:00.000Z'), // scheduled far in the future
      createdAt: new Date('2026-01-02T00:00:00.000Z'),
    });
    const enrollment3 = await createEnrollmentDirect({
      tenantId,
      studentUserId: student3,
      courseId: courseX,
      grantedByUserId: instructorId,
      status: EnrollmentStatus.REVOKED,
      revokedAt: new Date('2026-01-03T00:00:00.000Z'),
      createdAt: new Date('2026-01-03T00:00:00.000Z'),
    });
    // A different course for student1 — must never appear in courseX's roster.
    await createEnrollmentDirect({
      tenantId,
      studentUserId: student1,
      courseId: courseY,
      grantedByUserId: instructorId,
      createdAt: new Date('2026-01-04T00:00:00.000Z'),
    });

    const firstPage = await request(server)
      .get(`/instructor/tenants/${tenantId}/enrollments`)
      .query({ courseId: courseX, limit: 2, offset: 0 })
      .set('Authorization', `Bearer ${token}`)
      .expect(HttpStatus.OK);
    type RosterItem = {
      enrollmentId: string;
      courseId: string;
      courseTitle: string;
      status: string;
      currentlyEffective: boolean;
      student: { studentUserId: string; email: string; displayName: string | null; accountStatus: string };
    };
    const firstBody = responseBody<{ items: RosterItem[]; limit: number; offset: number }>(firstPage);
    expect(firstBody.items.map((item) => item.enrollmentId)).toEqual([enrollment3, enrollment2]);
    expect(firstBody.items.every((item) => item.courseId === courseX)).toBe(true);

    const secondPage = await request(server)
      .get(`/instructor/tenants/${tenantId}/enrollments`)
      .query({ courseId: courseX, limit: 2, offset: 2 })
      .set('Authorization', `Bearer ${token}`)
      .expect(HttpStatus.OK);
    const secondBody = responseBody<{ items: RosterItem[] }>(secondPage);
    expect(secondBody.items.map((item) => item.enrollmentId)).toEqual([enrollment1]);

    const active = firstBody.items.find((item) => item.enrollmentId === enrollment2) as RosterItem;
    expect(active.currentlyEffective).toBe(false); // ACTIVE but not yet started
    expect(active.student).toMatchObject({ studentUserId: student2, email: `roster-student-2@example.test` });

    const revoked = firstBody.items.find((item) => item.enrollmentId === enrollment3) as RosterItem;
    expect(revoked.currentlyEffective).toBe(false);
    expect(revoked.status).toBe(EnrollmentStatus.REVOKED);

    const eligible = secondBody.items[0];
    expect(eligible.currentlyEffective).toBe(true);
  });

  it('denies a course roster for a foreign/random course and a foreign instructor without leaking existence', async () => {
    const { token, tenantId, instructorId } = await createInstructorTenant('roster-deny');
    const { token: otherToken, tenantId: otherTenantId, instructorId: otherInstructorId } =
      await createInstructorTenant('roster-deny-other');
    const courseId = await createCourse(tenantId, instructorId, 'Deny roster course');
    const otherCourseId = await createCourse(otherTenantId, otherInstructorId, 'Other tenant course');

    const randomCourse = await request(server)
      .get(`/instructor/tenants/${tenantId}/enrollments`)
      .query({ courseId: uuid.create() })
      .set('Authorization', `Bearer ${token}`)
      .expect(HttpStatus.NOT_FOUND);
    expect(randomCourse.body).toMatchObject({ error: { code: 'COURSE_NOT_FOUND' } });

    // A real course, but belonging to a different tenant — queried under this instructor's own
    // (authorized) tenant path. Must not leak that the course exists elsewhere.
    const foreignCourse = await request(server)
      .get(`/instructor/tenants/${tenantId}/enrollments`)
      .query({ courseId: otherCourseId })
      .set('Authorization', `Bearer ${token}`)
      .expect(HttpStatus.NOT_FOUND);
    expect(foreignCourse.body).toMatchObject({ error: { code: 'COURSE_NOT_FOUND' } });

    // An instructor with no membership in the target tenant at all.
    await request(server)
      .get(`/instructor/tenants/${tenantId}/enrollments`)
      .query({ courseId })
      .set('Authorization', `Bearer ${otherToken}`)
      .expect(HttpStatus.FORBIDDEN);
  });

  it('shows multiple historical Enrollment rows for the same student/course after re-enrollment, never collapsed', async () => {
    const { token, tenantId, instructorId } = await createInstructorTenant('history-rows');
    const courseId = await createCourse(tenantId, instructorId, 'History course');
    const studentId = await createStudentWithTenant('history-student', tenantId, instructorId);

    const revokedRow = await createEnrollmentDirect({
      tenantId,
      studentUserId: studentId,
      courseId,
      grantedByUserId: instructorId,
      status: EnrollmentStatus.REVOKED,
      revokedAt: new Date('2026-02-01T00:00:00.000Z'),
      createdAt: new Date('2026-01-01T00:00:00.000Z'),
    });
    // Legitimate re-enrollment after revocation: a second durable row for the identical
    // (student, course) pair. Only one ACTIVE row may exist at a time (the partial unique index),
    // but historical rows are never merged or hidden.
    const activeRow = await createEnrollmentDirect({
      tenantId,
      studentUserId: studentId,
      courseId,
      grantedByUserId: instructorId,
      status: EnrollmentStatus.ACTIVE,
      createdAt: new Date('2026-02-02T00:00:00.000Z'),
    });

    const response = await request(server)
      .get(`/instructor/tenants/${tenantId}/enrollments`)
      .query({ courseId })
      .set('Authorization', `Bearer ${token}`)
      .expect(HttpStatus.OK);
    const body = responseBody<{ items: Array<{ enrollmentId: string; status: string }> }>(response);
    expect(body.items.map((item) => item.enrollmentId)).toEqual([activeRow, revokedRow]);
    expect(new Set(body.items.map((item) => item.enrollmentId)).size).toBe(2);

    const onlyRevoked = await request(server)
      .get(`/instructor/tenants/${tenantId}/enrollments`)
      .query({ courseId, status: EnrollmentStatus.REVOKED })
      .set('Authorization', `Bearer ${token}`)
      .expect(HttpStatus.OK);
    expect(
      responseBody<{ items: Array<{ enrollmentId: string }> }>(onlyRevoked).items.map((item) => item.enrollmentId),
    ).toEqual([revokedRow]);
  });

  it("lists a tenant student's enrollment history across courses, scoped to the exact tenant/student, with pagination and revoked history", async () => {
    const { token, tenantId, instructorId } = await createInstructorTenant('student-list');
    const studentId = await createStudentWithTenant('student-list-target', tenantId, instructorId);
    const otherStudentId = await createStudentWithTenant('student-list-other', tenantId, instructorId);
    const course1 = await createCourse(tenantId, instructorId, 'Student list course 1');
    const course2 = await createCourse(tenantId, instructorId, 'Student list course 2');
    const course3 = await createCourse(tenantId, instructorId, 'Student list course 3');

    const e1 = await createEnrollmentDirect({
      tenantId,
      studentUserId: studentId,
      courseId: course1,
      grantedByUserId: instructorId,
      status: EnrollmentStatus.REVOKED,
      revokedAt: new Date('2026-01-05T00:00:00.000Z'),
      createdAt: new Date('2026-01-01T00:00:00.000Z'),
    });
    const e2 = await createEnrollmentDirect({
      tenantId,
      studentUserId: studentId,
      courseId: course2,
      grantedByUserId: instructorId,
      status: EnrollmentStatus.ACTIVE,
      createdAt: new Date('2026-01-02T00:00:00.000Z'),
    });
    const e3 = await createEnrollmentDirect({
      tenantId,
      studentUserId: studentId,
      courseId: course3,
      grantedByUserId: instructorId,
      status: EnrollmentStatus.ACTIVE,
      createdAt: new Date('2026-01-03T00:00:00.000Z'),
    });
    // A different student's enrollment — must never appear in this student's list.
    await createEnrollmentDirect({
      tenantId,
      studentUserId: otherStudentId,
      courseId: course1,
      grantedByUserId: instructorId,
      createdAt: new Date('2026-01-04T00:00:00.000Z'),
    });

    const firstPage = await request(server)
      .get(`/instructor/tenants/${tenantId}/enrollments`)
      .query({ studentUserId: studentId, limit: 2, offset: 0 })
      .set('Authorization', `Bearer ${token}`)
      .expect(HttpStatus.OK);
    const firstBody = responseBody<{ items: Array<{ enrollmentId: string; courseTitle: string }> }>(firstPage);
    expect(firstBody.items.map((item) => item.enrollmentId)).toEqual([e3, e2]);
    expect(firstBody.items.map((item) => item.courseTitle)).toEqual([
      'Student list course 3',
      'Student list course 2',
    ]);

    const secondPage = await request(server)
      .get(`/instructor/tenants/${tenantId}/enrollments`)
      .query({ studentUserId: studentId, limit: 2, offset: 2 })
      .set('Authorization', `Bearer ${token}`)
      .expect(HttpStatus.OK);
    expect(
      responseBody<{ items: Array<{ enrollmentId: string }> }>(secondPage).items.map((item) => item.enrollmentId),
    ).toEqual([e1]);
  });

  it('denies a student enrollment list for a random/foreign student without leaking existence, and enforces tenant isolation', async () => {
    const { token, tenantId, instructorId } = await createInstructorTenant('student-list-deny');
    const { token: otherToken, tenantId: otherTenantId, instructorId: otherInstructorId } =
      await createInstructorTenant('student-list-deny-other');
    const foreignStudentId = await createStudentWithTenant(
      'student-list-deny-foreign',
      otherTenantId,
      otherInstructorId,
    );
    const ownStudentId = await createStudentWithTenant('student-list-deny-own', tenantId, instructorId);

    const randomStudent = await request(server)
      .get(`/instructor/tenants/${tenantId}/enrollments`)
      .query({ studentUserId: uuid.create() })
      .set('Authorization', `Bearer ${token}`)
      .expect(HttpStatus.NOT_FOUND);
    expect(randomStudent.body).toMatchObject({ error: { code: 'TENANT_STUDENT_NOT_FOUND' } });

    // A real student, but only associated with a different tenant — queried under this
    // instructor's own authorized tenant. Must not leak the student's existence elsewhere.
    const foreignStudent = await request(server)
      .get(`/instructor/tenants/${tenantId}/enrollments`)
      .query({ studentUserId: foreignStudentId })
      .set('Authorization', `Bearer ${token}`)
      .expect(HttpStatus.NOT_FOUND);
    expect(foreignStudent.body).toMatchObject({ error: { code: 'TENANT_STUDENT_NOT_FOUND' } });

    // An instructor with no membership in the target tenant at all.
    await request(server)
      .get(`/instructor/tenants/${tenantId}/enrollments`)
      .query({ studentUserId: ownStudentId })
      .set('Authorization', `Bearer ${otherToken}`)
      .expect(HttpStatus.FORBIDDEN);
  });

  it('requires at least one of courseId/studentUserId and supports combining both as an AND filter', async () => {
    const { token, tenantId, instructorId } = await createInstructorTenant('combined-filter');
    const courseA = await createCourse(tenantId, instructorId, 'Combined course A');
    const courseB = await createCourse(tenantId, instructorId, 'Combined course B');
    const studentId = await createStudentWithTenant('combined-student', tenantId, instructorId);
    const otherStudentId = await createStudentWithTenant('combined-other-student', tenantId, instructorId);

    const unfiltered = await request(server)
      .get(`/instructor/tenants/${tenantId}/enrollments`)
      .set('Authorization', `Bearer ${token}`)
      .expect(HttpStatus.BAD_REQUEST);
    expect(unfiltered.body).toMatchObject({ error: { code: 'ENROLLMENT_QUERY_FILTER_REQUIRED' } });

    const target = await createEnrollmentDirect({
      tenantId,
      studentUserId: studentId,
      courseId: courseA,
      grantedByUserId: instructorId,
      createdAt: new Date('2026-03-01T00:00:00.000Z'),
    });
    // Same student, different course — must be excluded by the combined filter.
    await createEnrollmentDirect({
      tenantId,
      studentUserId: studentId,
      courseId: courseB,
      grantedByUserId: instructorId,
      createdAt: new Date('2026-03-02T00:00:00.000Z'),
    });
    // Same course, different student — must also be excluded by the combined filter.
    await createEnrollmentDirect({
      tenantId,
      studentUserId: otherStudentId,
      courseId: courseA,
      grantedByUserId: instructorId,
      createdAt: new Date('2026-03-03T00:00:00.000Z'),
    });

    const combined = await request(server)
      .get(`/instructor/tenants/${tenantId}/enrollments`)
      .query({ courseId: courseA, studentUserId: studentId })
      .set('Authorization', `Bearer ${token}`)
      .expect(HttpStatus.OK);
    expect(
      responseBody<{ items: Array<{ enrollmentId: string }> }>(combined).items.map((item) => item.enrollmentId),
    ).toEqual([target]);
  });

  // --- API Readiness Slice: pagination `hasMore` ---

  it('reports hasMore correctly for the admin instructor list: fewer than limit, exactly limit, and a real next/final page split', async () => {
    const adminId = await createUser('tenancy-admin-haspage', PlatformRole.PLATFORM_ADMIN);
    const adminToken = await issueAccessToken(adminId, PlatformRole.PLATFORM_ADMIN);

    // The admin instructor list is platform-wide, not tenant-scoped, so this measures against the
    // live baseline rather than an assumed-empty table — robust to any instructor rows left by
    // other suites/tests in the same database.
    const baseline = await prisma.client.instructorProfile.count();

    await createInstructorTenant('haspage-fewer');
    const fewerThanLimit = await request(server)
      .get('/admin/instructors')
      .query({ limit: baseline + 5, offset: 0 })
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(HttpStatus.OK);
    const fewerBody = responseBody<{ items: unknown[]; hasMore: boolean }>(fewerThanLimit);
    expect(fewerBody.items).toHaveLength(baseline + 1);
    expect(fewerBody.hasMore).toBe(false);

    await createInstructorTenant('haspage-b');
    await createInstructorTenant('haspage-c');
    // Now exactly `baseline + 3` instructors exist. A limit equal to that exact total must report
    // hasMore: false (not an off-by-one true) — the case a naive `items.length === limit` check
    // gets wrong.
    const exactlyLimit = await request(server)
      .get('/admin/instructors')
      .query({ limit: baseline + 3, offset: 0 })
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(HttpStatus.OK);
    const exactBody = responseBody<{ items: unknown[]; hasMore: boolean }>(exactlyLimit);
    expect(exactBody.items).toHaveLength(baseline + 3);
    expect(exactBody.hasMore).toBe(false);

    // One fewer than the total: a genuine next page exists.
    const firstPage = await request(server)
      .get('/admin/instructors')
      .query({ limit: baseline + 2, offset: 0 })
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(HttpStatus.OK);
    const firstBody = responseBody<{ items: unknown[]; hasMore: boolean }>(firstPage);
    expect(firstBody.items).toHaveLength(baseline + 2);
    expect(firstBody.hasMore).toBe(true);

    const finalPage = await request(server)
      .get('/admin/instructors')
      .query({ limit: baseline + 2, offset: baseline + 2 })
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(HttpStatus.OK);
    const finalBody = responseBody<{ items: unknown[]; hasMore: boolean }>(finalPage);
    expect(finalBody.items).toHaveLength(1);
    expect(finalBody.hasMore).toBe(false);
  });

  it('never lets an InstructorProfile with no OWNER membership consume a page slot, an offset position, or influence hasMore', async () => {
    const adminId = await createUser('tenancy-admin-ghost', PlatformRole.PLATFORM_ADMIN);
    const adminToken = await issueAccessToken(adminId, PlatformRole.PLATFORM_ADMIN);
    const nonAdminId = await createUser('tenancy-nonadmin-ghost', PlatformRole.INSTRUCTOR);
    const nonAdminToken = await issueAccessToken(nonAdminId, PlatformRole.INSTRUCTOR);

    const baseline = await prisma.client.instructorProfile.count();

    // Three genuinely eligible instructors (real InstructorProfile + Tenant + OWNER
    // TenantMembership), deliberately spaced in `createdAt` so a "ghost" row can be interleaved
    // between the newest and the middle one — squarely inside the first page's raw fetch window.
    const { instructorId: instructorA } = await createInstructorTenantAt('ghost-a', new Date('2026-05-01T00:00:00.000Z'));
    const { instructorId: instructorB } = await createInstructorTenantAt('ghost-b', new Date('2026-05-02T00:00:00.000Z'));
    const { instructorId: instructorC } = await createInstructorTenantAt('ghost-c', new Date('2026-05-04T00:00:00.000Z'));

    // The ineligible row: an InstructorProfile with NO TenantMembership at all — a data anomaly
    // that cannot arise through `createInstructor` (which always creates the OWNER membership in
    // the same transaction) or any other reachable production code path, seeded directly here to
    // prove the query-level eligibility guarantee rather than assuming it. Its `createdAt` sits
    // strictly between instructor C (newest) and instructor B, so in raw (unfiltered,
    // `createdAt` desc) order it would occupy the (limit + 1)-th position for `limit=2, offset=0`
    // — exactly where an unfiltered `take: limit + 1` would fetch it as part of the page, not the
    // sentinel, if eligibility were only checked after the query.
    const ghostId = await createUser('ghost-instructor', PlatformRole.INSTRUCTOR);
    await prisma.client.instructorProfile.create({
      data: { id: uuid.create(), userId: ghostId, createdAt: new Date('2026-05-03T00:00:00.000Z') },
    });

    type Row = { userId: string };
    type Page = { items: Row[]; hasMore: boolean };

    // Raw (unfiltered) createdAt-desc order is: C, ghost, B, A. The eligible-only order must be:
    // C, B, A. With limit=2, offset=0, the first page must return exactly [C, B] — a full page of
    // 2 genuinely eligible instructors — never a short page caused by the ghost silently
    // consuming a slot and then being dropped.
    const firstPage = await request(server)
      .get('/admin/instructors')
      .query({ limit: 2, offset: baseline })
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(HttpStatus.OK);
    const firstBody = responseBody<Page>(firstPage);
    expect(firstBody.items.map((item) => item.userId)).toEqual([instructorC, instructorB]);
    expect(firstBody.items.some((item) => item.userId === ghostId)).toBe(false);
    // A genuine third eligible instructor (A) remains — hasMore must be true for the right reason
    // (a real next eligible row), not merely because the ghost row happened to exist.
    expect(firstBody.hasMore).toBe(true);

    // Second page: offset advances over the *eligible* set only. If the ghost row had consumed an
    // offset position (the old bug), this page would incorrectly skip or duplicate an instructor.
    const secondPage = await request(server)
      .get('/admin/instructors')
      .query({ limit: 2, offset: baseline + 2 })
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(HttpStatus.OK);
    const secondBody = responseBody<Page>(secondPage);
    expect(secondBody.items.map((item) => item.userId)).toEqual([instructorA]);
    expect(secondBody.hasMore).toBe(false);

    // The union of every page is exactly the three eligible instructors — no omission, no
    // duplicate, and the ghost never appears anywhere.
    const allReturned = [...firstBody.items, ...secondBody.items].map((item) => item.userId);
    expect(new Set(allReturned)).toEqual(new Set([instructorC, instructorB, instructorA]));
    expect(allReturned).toHaveLength(3);

    // Existing admin-only authorization is unchanged by this repair.
    await request(server).get('/admin/instructors').set('Authorization', `Bearer ${nonAdminToken}`).expect(HttpStatus.FORBIDDEN);
  });

  it('reports hasMore correctly for the tenant-scoped, filtered Enrollment Visibility list, unaffected by another tenant', async () => {
    const { token, tenantId, instructorId } = await createInstructorTenant('haspage-enroll');
    const { tenantId: otherTenantId, instructorId: otherInstructorId } = await createInstructorTenant('haspage-enroll-other');
    const courseId = await createCourse(tenantId, instructorId, 'HasMore course');
    const otherCourse = await createCourse(otherTenantId, otherInstructorId, 'Other tenant course');
    const otherStudent = await createStudentWithTenant('haspage-other-student', otherTenantId, otherInstructorId);

    // Three enrollments in the scoped tenant/course, plus two extra rows that must never
    // influence this course's hasMore: one ACTIVE enrollment for a different course in the SAME
    // tenant, and one enrollment entirely in a DIFFERENT tenant.
    for (let i = 0; i < 3; i += 1) {
      const studentId = await createStudentWithTenant(`haspage-enroll-student-${i}`, tenantId, instructorId);
      await createEnrollmentDirect({
        tenantId,
        studentUserId: studentId,
        courseId,
        grantedByUserId: instructorId,
        createdAt: new Date(2026, 0, i + 1),
      });
    }
    const sibling = await createStudentWithTenant('haspage-enroll-sibling', tenantId, instructorId);
    const otherCourseInSameTenant = await createCourse(tenantId, instructorId, 'Sibling course');
    await createEnrollmentDirect({ tenantId, studentUserId: sibling, courseId: otherCourseInSameTenant, grantedByUserId: instructorId });
    await createEnrollmentDirect({ tenantId: otherTenantId, studentUserId: otherStudent, courseId: otherCourse, grantedByUserId: otherInstructorId });

    type Row = { enrollmentId: string };
    const firstPage = await request(server)
      .get(`/instructor/tenants/${tenantId}/enrollments`)
      .query({ courseId, limit: 2, offset: 0 })
      .set('Authorization', `Bearer ${token}`)
      .expect(HttpStatus.OK);
    const firstBody = responseBody<{ items: Row[]; hasMore: boolean }>(firstPage);
    expect(firstBody.items).toHaveLength(2);
    expect(firstBody.hasMore).toBe(true);

    const secondPage = await request(server)
      .get(`/instructor/tenants/${tenantId}/enrollments`)
      .query({ courseId, limit: 2, offset: 2 })
      .set('Authorization', `Bearer ${token}`)
      .expect(HttpStatus.OK);
    const secondBody = responseBody<{ items: Row[]; hasMore: boolean }>(secondPage);
    expect(secondBody.items).toHaveLength(1);
    expect(secondBody.hasMore).toBe(false);

    // A `status` filter narrowing to zero matches within this scope must report hasMore: false,
    // not leak the unfiltered/foreign-tenant row count.
    const filtered = await request(server)
      .get(`/instructor/tenants/${tenantId}/enrollments`)
      .query({ courseId, status: EnrollmentStatus.REVOKED, limit: 25, offset: 0 })
      .set('Authorization', `Bearer ${token}`)
      .expect(HttpStatus.OK);
    const filteredBody = responseBody<{ items: Row[]; hasMore: boolean }>(filtered);
    expect(filteredBody.items).toHaveLength(0);
    expect(filteredBody.hasMore).toBe(false);
  });

  async function clearTenancyData(): Promise<void> {
    await prisma.client.notification.deleteMany();
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
      where: {
        slug: {
          startsWith: 'tenancy-test-',
        },
      },
    });
    await prisma.client.user.deleteMany({
      where: {
        normalizedEmail: {
          endsWith: '@example.test',
        },
      },
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
        name: `Tenant ${slugSuffix}`,
        slug: `tenancy-test-${slugSuffix}`,
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

  // Same as `createInstructorTenant`, but with explicit control over the `InstructorProfile`'s
  // `createdAt` — needed to deterministically interleave a genuine (eligible) instructor with an
  // ineligible "ghost" row at a specific position in the admin list's `createdAt`-descending
  // ordering.
  async function createInstructorTenantAt(
    slugSuffix: string,
    createdAt: Date,
  ): Promise<{ instructorId: string; tenantId: string; token: string }> {
    const instructorId = await createUser(`instructor-${slugSuffix}`, PlatformRole.INSTRUCTOR);
    await prisma.client.instructorProfile.create({
      data: { id: uuid.create(), userId: instructorId, createdAt },
    });
    const tenant = await prisma.client.tenant.create({
      data: {
        id: uuid.create(),
        name: `Tenant ${slugSuffix}`,
        slug: `tenancy-test-${slugSuffix}`,
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

  async function createStudentWithTenant(
    emailPrefix: string,
    tenantId: string,
    createdByUserId: string,
  ): Promise<string> {
    const studentId = await createUser(emailPrefix, PlatformRole.STUDENT);
    await prisma.client.studentProfile.create({
      data: { id: uuid.create(), userId: studentId },
    });
    const now = new Date();
    await prisma.client.tenantStudent.create({
      data: {
        id: uuid.create(),
        tenantId,
        studentUserId: studentId,
        status: TenantStudentStatus.ACTIVE,
        createdByUserId,
        activatedAt: now,
        createdAt: now,
      },
    });
    return studentId;
  }

  async function createCourse(
    tenantId: string,
    createdByUserId: string,
    title: string,
  ): Promise<string> {
    const id = uuid.create();
    await prisma.client.course.create({
      data: {
        id,
        tenantId,
        createdByUserId,
        title,
        status: CourseStatus.PUBLISHED,
        visibility: CourseVisibility.ENROLLED_ONLY,
      },
    });
    return id;
  }

  async function createCredential(userId: string, password: string): Promise<void> {
    await prisma.client.authCredential.create({
      data: {
        id: uuid.create(),
        userId,
        credentialType: CredentialType.PASSWORD,
        passwordHash: await passwordService.hashPassword(password),
      },
    });
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

  // Direct-write variant with full control over status/time-window/createdAt, for Enrollment
  // Visibility Slice tests that need deterministic ordering or specific history states (REVOKED/
  // EXPIRED/scheduled) that the HTTP create/revoke endpoints cannot themselves produce on demand.
  async function createEnrollmentDirect(input: {
    tenantId: string;
    studentUserId: string;
    courseId: string;
    grantedByUserId: string;
    status?: EnrollmentStatus;
    startsAt?: Date | null;
    endsAt?: Date | null;
    revokedAt?: Date | null;
    createdAt?: Date;
  }): Promise<string> {
    const id = uuid.create();
    await prisma.client.enrollment.create({
      data: {
        id,
        tenantId: input.tenantId,
        studentUserId: input.studentUserId,
        courseId: input.courseId,
        grantedByUserId: input.grantedByUserId,
        status: input.status ?? EnrollmentStatus.ACTIVE,
        startsAt: input.startsAt ?? null,
        endsAt: input.endsAt ?? null,
        revokedAt: input.revokedAt ?? null,
        createdAt: input.createdAt ?? new Date(),
      },
    });
    return id;
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

  async function authState(userId: string): Promise<{
    credentialCount: number;
    activationCount: number;
    sessionCount: number;
    deviceCount: number;
  }> {
    const [credentialCount, activationCount, sessionCount, deviceCount] = await Promise.all([
      prisma.client.authCredential.count({ where: { userId } }),
      prisma.client.accountActivationToken.count({ where: { userId } }),
      prisma.client.refreshSession.count({ where: { userId } }),
      prisma.client.studentDevice.count({ where: { studentUserId: userId } }),
    ]);

    return { credentialCount, activationCount, sessionCount, deviceCount };
  }

  async function issueAccessToken(userId: string, platformRole: PlatformRole): Promise<string> {
    const session = await refreshSessions.createSession({ userId, channel: 'MOBILE' });
    return accessTokens.sign({ userId, sessionId: session.sessionId, platformRole });
  }

  function addStudent(token: string, tenantId: string, email: string): Promise<request.Response> {
    return request(server)
      .post(`/instructor/tenants/${tenantId}/students`)
      .set('Authorization', `Bearer ${token}`)
      .send({ email });
  }
});

function installation(suffix: number): string {
  return `00000000-0000-7000-8000-${suffix.toString().padStart(12, '0')}`;
}

function responseBody<T>(response: request.Response): T {
  return response.body as T;
}
