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

  async function clearTenancyData(): Promise<void> {
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
