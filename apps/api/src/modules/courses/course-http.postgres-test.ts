import { HttpStatus, INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import * as cookieParser from 'cookie-parser';
import * as request from 'supertest';
import type { App } from 'supertest/types';
import {
  AccountStatus,
  CourseStatus,
  CourseVisibility,
  PlatformRole,
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

maybeDescribe('instructor course HTTP PostgreSQL integration', () => {
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

    await clearCourseData();
  });

  afterEach(async () => {
    await app?.close();
  });

  it('creates a draft course scoped to the instructor tenant with server-derived ownership', async () => {
    const { token, tenantId, instructorId } = await createInstructorTenant('course-create');

    const response = await request(server)
      .post(`/instructor/tenants/${tenantId}/courses`)
      .set('Authorization', `Bearer ${token}`)
      .send({
        title: '  Algebra Foundations  ',
        description: '  Introductory algebra  ',
        thumbnailAssetRef: '  asset://thumb/algebra  ',
        visibility: CourseVisibility.PRIVATE,
        tenantId: uuid.create(),
        createdByUserId: uuid.create(),
        status: CourseStatus.PUBLISHED,
      })
      .expect(HttpStatus.BAD_REQUEST);

    expect(response.body).toMatchObject({ error: { code: 'VALIDATION_FAILED' } });

    const created = await request(server)
      .post(`/instructor/tenants/${tenantId}/courses`)
      .set('Authorization', `Bearer ${token}`)
      .send({
        title: '  Algebra Foundations  ',
        description: '  Introductory algebra  ',
        thumbnailAssetRef: '  asset://thumb/algebra  ',
        visibility: CourseVisibility.PRIVATE,
      })
      .expect(HttpStatus.CREATED);

    const body = responseBody<{ courseId: string; tenantId: string; createdByUserId: string }>(created);
    expect(body.tenantId).toBe(tenantId);
    expect(body.createdByUserId).toBe(instructorId);
    expect(created.body).toMatchObject({
      title: 'Algebra Foundations',
      description: 'Introductory algebra',
      thumbnailAssetRef: 'asset://thumb/algebra',
      status: CourseStatus.DRAFT,
      visibility: CourseVisibility.PRIVATE,
    });

    await expect(
      prisma.client.course.findUniqueOrThrow({ where: { id: body.courseId } }),
    ).resolves.toMatchObject({
      tenantId,
      createdByUserId: instructorId,
      status: CourseStatus.DRAFT,
      visibility: CourseVisibility.PRIVATE,
    });
  });

  it('lists and reads only the authorized tenant courses with bounded deterministic pagination', async () => {
    const { token, tenantId, instructorId } = await createInstructorTenant('course-list-a');
    const { tenantId: otherTenantId, instructorId: otherInstructorId } =
      await createInstructorTenant('course-list-b');

    const oldest = await createCourseDirect(tenantId, instructorId, 'Oldest', new Date('2026-01-01T00:00:00Z'));
    const middle = await createCourseDirect(tenantId, instructorId, 'Middle', new Date('2026-01-02T00:00:00Z'));
    const newest = await createCourseDirect(tenantId, instructorId, 'Newest', new Date('2026-01-03T00:00:00Z'));
    await createCourseDirect(otherTenantId, otherInstructorId, 'Other tenant', new Date('2026-01-04T00:00:00Z'));

    await request(server)
      .get(`/instructor/tenants/${tenantId}/courses?limit=101`)
      .set('Authorization', `Bearer ${token}`)
      .expect(HttpStatus.BAD_REQUEST);

    await request(server)
      .get(`/instructor/tenants/${tenantId}/courses?limit=2&offset=1`)
      .set('Authorization', `Bearer ${token}`)
      .expect(HttpStatus.OK)
      .expect(({ body }) => {
        const typed = body as { items: Array<{ courseId: string; title: string }>; limit: number; offset: number };
        expect(typed.limit).toBe(2);
        expect(typed.offset).toBe(1);
        expect(typed.items.map((item) => item.courseId)).toEqual([middle, oldest]);
        expect(typed.items.map((item) => item.title)).not.toContain('Other tenant');
      });

    await request(server)
      .get(`/instructor/tenants/${tenantId}/courses/${newest}`)
      .set('Authorization', `Bearer ${token}`)
      .expect(HttpStatus.OK)
      .expect(({ body }) => {
        const typed = body as Record<string, unknown>;
        expect(typed).toMatchObject({ courseId: newest, tenantId, title: 'Newest' });
        expect(typed.sections).toBeUndefined();
        expect(typed.enrollments).toBeUndefined();
      });
  });

  it('rejects cross-tenant course reads and updates while allowing safe metadata updates', async () => {
    const { token, tenantId, instructorId } = await createInstructorTenant('course-scope-a');
    const { token: otherToken, tenantId: otherTenantId, instructorId: otherInstructorId } =
      await createInstructorTenant('course-scope-b');
    const courseId = await createCourseDirect(tenantId, instructorId, 'Tenant A course');
    const otherCourseId = await createCourseDirect(otherTenantId, otherInstructorId, 'Tenant B course');

    await request(server)
      .get(`/instructor/tenants/${tenantId}/courses/${courseId}`)
      .set('Authorization', `Bearer ${token}`)
      .expect(HttpStatus.OK);

    await request(server)
      .get(`/instructor/tenants/${tenantId}/courses/${courseId}`)
      .set('Authorization', `Bearer ${otherToken}`)
      .expect(HttpStatus.FORBIDDEN);

    await request(server)
      .patch(`/instructor/tenants/${tenantId}/courses/${courseId}`)
      .set('Authorization', `Bearer ${otherToken}`)
      .send({ title: 'Cross-tenant write' })
      .expect(HttpStatus.FORBIDDEN);

    await request(server)
      .get(`/instructor/tenants/${tenantId}/courses/${otherCourseId}`)
      .set('Authorization', `Bearer ${token}`)
      .expect(HttpStatus.NOT_FOUND);

    await request(server)
      .patch(`/instructor/tenants/${tenantId}/courses/${courseId}`)
      .set('Authorization', `Bearer ${token}`)
      .send({
        title: 'Updated course',
        description: '',
        thumbnailAssetRef: ' asset://thumb/updated ',
        visibility: CourseVisibility.ENROLLED_ONLY,
      })
      .expect(HttpStatus.OK)
      .expect(({ body }) => {
        expect(body).toMatchObject({
          courseId,
          tenantId,
          createdByUserId: instructorId,
          title: 'Updated course',
          description: null,
          thumbnailAssetRef: 'asset://thumb/updated',
          status: CourseStatus.DRAFT,
          visibility: CourseVisibility.ENROLLED_ONLY,
        });
      });

    const protectedFieldUpdate = await request(server)
      .patch(`/instructor/tenants/${tenantId}/courses/${courseId}`)
      .set('Authorization', `Bearer ${token}`)
      .send({
        status: CourseStatus.PUBLISHED,
        tenantId: otherTenantId,
        createdByUserId: otherInstructorId,
      })
      .expect(HttpStatus.BAD_REQUEST);
    expect(protectedFieldUpdate.body).toMatchObject({ error: { code: 'VALIDATION_FAILED' } });

    await expect(
      prisma.client.course.findUniqueOrThrow({ where: { id: courseId } }),
    ).resolves.toMatchObject({
      tenantId,
      createdByUserId: instructorId,
      status: CourseStatus.DRAFT,
    });
  });

  it('denies student and platform admin use of instructor course mutation routes', async () => {
    const { tenantId, instructorId } = await createInstructorTenant('course-role');
    const studentId = await createUser('course-student', PlatformRole.STUDENT);
    const adminId = await createUser('course-admin', PlatformRole.PLATFORM_ADMIN);
    const studentToken = await issueAccessToken(studentId, PlatformRole.STUDENT);
    const adminToken = await issueAccessToken(adminId, PlatformRole.PLATFORM_ADMIN);
    const courseId = await createCourseDirect(tenantId, instructorId, 'Role guarded course');

    await request(server)
      .post(`/instructor/tenants/${tenantId}/courses`)
      .set('Authorization', `Bearer ${studentToken}`)
      .send({ title: 'Student course' })
      .expect(HttpStatus.FORBIDDEN);

    await request(server)
      .post(`/instructor/tenants/${tenantId}/courses`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ title: 'Admin course' })
      .expect(HttpStatus.FORBIDDEN);

    await request(server)
      .patch(`/instructor/tenants/${tenantId}/courses/${courseId}`)
      .set('Authorization', `Bearer ${studentToken}`)
      .send({ title: 'Student update' })
      .expect(HttpStatus.FORBIDDEN);

    await request(server)
      .patch(`/instructor/tenants/${tenantId}/courses/${courseId}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ title: 'Admin update' })
      .expect(HttpStatus.FORBIDDEN);
  });

  async function clearCourseData(): Promise<void> {
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
          startsWith: 'course-test-',
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
        name: `Course Tenant ${slugSuffix}`,
        slug: `course-test-${slugSuffix}`,
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

  async function createCourseDirect(
    tenantId: string,
    createdByUserId: string,
    title: string,
    createdAt?: Date,
  ): Promise<string> {
    const id = uuid.create();
    await prisma.client.course.create({
      data: {
        id,
        tenantId,
        createdByUserId,
        title,
        status: CourseStatus.DRAFT,
        visibility: CourseVisibility.ENROLLED_ONLY,
        ...(createdAt ? { createdAt } : {}),
      },
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
