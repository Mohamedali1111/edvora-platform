import { HttpStatus, INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import * as cookieParser from 'cookie-parser';
import * as request from 'supertest';
import type { App } from 'supertest/types';
import {
  AccountStatus,
  CourseStatus,
  CourseVisibility,
  DevicePlatform,
  EnrollmentStatus,
  NotificationCategory,
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
import { RefreshSessionService } from '../auth/services/refresh-session.service';
import { TokenCryptoService } from '../auth/services/token-crypto.service';
import { UuidV7Service } from '../auth/services/uuid-v7.service';
import { testAuthConfig } from '../auth/test-helpers';
import { INSTALLATION_ID_HEADER } from '../devices/types/device.types';
import { NotificationService } from './services/notification.service';
import { TenancyModule } from '../tenancy/tenancy.module';

const testDatabaseUrl = process.env.TEST_DATABASE_URL;
const maybeDescribe = testDatabaseUrl ? describe : describe.skip;
const trustedOrigin = 'http://localhost:3000';

type NotificationResponse = {
  notificationId: string;
  type: string;
  category: NotificationCategory;
  title: string;
  body: string;
  domainEntityType: string | null;
  domainEntityId: string | null;
  read: boolean;
  readAt: string | null;
  createdAt: string;
  recipientUserId?: string;
  tenantId?: string;
};

maybeDescribe('notification HTTP PostgreSQL integration', () => {
  let app: INestApplication;
  let server: App;
  let prisma: PrismaService;
  let accessTokens: AccessTokenService;
  let refreshSessions: RefreshSessionService;
  let tokenCrypto: TokenCryptoService;
  let uuid: UuidV7Service;
  let notifications: NotificationService;

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
    tokenCrypto = moduleRef.get(TokenCryptoService);
    uuid = moduleRef.get(UuidV7Service);
    notifications = moduleRef.get(NotificationService);

    await clearNotificationData();
  });

  afterEach(async () => {
    await app?.close();
  });

  it('lists only the current student notifications with bounded deterministic pagination', async () => {
    const { tenantId, instructorId } = await createInstructorTenant('student-list');
    const studentId = await createStudentWithTenant('student-list-own', tenantId, instructorId);
    const otherStudentId = await createStudentWithTenant('student-list-other', tenantId, instructorId);
    const token = await issueAccessToken(studentId, PlatformRole.STUDENT);
    const installationId = installation(1);
    await createActiveDevice(studentId, installationId);

    const oldestId = await createNotification({
      recipientUserId: studentId,
      tenantId,
      type: 'TEST_OLD',
      title: 'Old',
      body: 'Old body',
      createdAt: new Date('2026-01-01T00:00:00.000Z'),
    });
    const sameTimeLowId = '00000000-0000-7000-8000-000000000010';
    const sameTimeHighId = '00000000-0000-7000-8000-000000000020';
    await createNotification({
      id: sameTimeLowId,
      recipientUserId: studentId,
      tenantId,
      type: 'TEST_LOW',
      title: 'Low',
      body: 'Low body',
      createdAt: new Date('2026-01-02T00:00:00.000Z'),
    });
    await createNotification({
      id: sameTimeHighId,
      recipientUserId: studentId,
      tenantId,
      type: 'TEST_HIGH',
      title: 'High',
      body: 'High body',
      createdAt: new Date('2026-01-02T00:00:00.000Z'),
    });
    await createNotification({
      recipientUserId: otherStudentId,
      tenantId,
      type: 'TEST_FOREIGN',
      title: 'Foreign',
      body: 'Foreign body',
      createdAt: new Date('2026-01-03T00:00:00.000Z'),
    });

    await request(server)
      .get('/student/notifications?limit=101')
      .set('Authorization', `Bearer ${token}`)
      .set(INSTALLATION_ID_HEADER, installationId)
      .expect(HttpStatus.BAD_REQUEST);

    const firstPage = await request(server)
      .get('/student/notifications?limit=2&offset=0')
      .set('Authorization', `Bearer ${token}`)
      .set(INSTALLATION_ID_HEADER, installationId)
      .expect(HttpStatus.OK);

    const firstPageBody = responseBody<{ items: NotificationResponse[]; limit: number; offset: number }>(firstPage);
    expect(firstPageBody.limit).toBe(2);
    expect(firstPageBody.offset).toBe(0);
    expect(firstPageBody.items.map((item) => item.notificationId)).toEqual([sameTimeHighId, sameTimeLowId]);
    expect(firstPageBody.items[0].recipientUserId).toBeUndefined();
    expect(firstPageBody.items[0].tenantId).toBeUndefined();

    const secondPage = await request(server)
      .get('/student/notifications?limit=2&offset=2')
      .set('Authorization', `Bearer ${token}`)
      .set(INSTALLATION_ID_HEADER, installationId)
      .expect(HttpStatus.OK);
    expect(responseBody<{ items: NotificationResponse[] }>(secondPage).items.map((item) => item.notificationId)).toEqual([
      oldestId,
    ]);
  });

  it('counts unread rows with a database count and updates count before and after mark-read/read-all', async () => {
    const { tenantId, instructorId } = await createInstructorTenant('student-count');
    const studentId = await createStudentWithTenant('student-count-own', tenantId, instructorId);
    const otherStudentId = await createStudentWithTenant('student-count-other', tenantId, instructorId);
    const token = await issueAccessToken(studentId, PlatformRole.STUDENT);
    const installationId = installation(2);
    await createActiveDevice(studentId, installationId);

    const firstId = await createNotification({ recipientUserId: studentId, tenantId, type: 'COUNT_A' });
    await createNotification({ recipientUserId: studentId, tenantId, type: 'COUNT_B' });
    await createNotification({
      recipientUserId: studentId,
      tenantId,
      type: 'COUNT_READ',
      readAt: new Date('2026-01-01T00:00:00.000Z'),
    });
    await createNotification({ recipientUserId: otherStudentId, tenantId, type: 'COUNT_FOREIGN' });

    await request(server)
      .get('/student/notifications/unread-count')
      .set('Authorization', `Bearer ${token}`)
      .set(INSTALLATION_ID_HEADER, installationId)
      .expect(HttpStatus.OK)
      .expect(({ body }) => expect(body).toEqual({ unreadCount: 2 }));

    await request(server)
      .patch(`/student/notifications/${firstId}/read`)
      .set('Authorization', `Bearer ${token}`)
      .set(INSTALLATION_ID_HEADER, installationId)
      .expect(HttpStatus.OK);

    await request(server)
      .get('/student/notifications/unread-count')
      .set('Authorization', `Bearer ${token}`)
      .set(INSTALLATION_ID_HEADER, installationId)
      .expect(HttpStatus.OK)
      .expect(({ body }) => expect(body).toEqual({ unreadCount: 1 }));

    await request(server)
      .patch('/student/notifications/read-all')
      .set('Authorization', `Bearer ${token}`)
      .set(INSTALLATION_ID_HEADER, installationId)
      .expect(HttpStatus.OK)
      .expect(({ body }) => expect(body).toEqual({ updatedCount: 1 }));

    await expect(
      prisma.client.notification.count({ where: { recipientUserId: otherStudentId, readAt: null } }),
    ).resolves.toBe(1);
  });

  it('marks only the owned student notification read idempotently and preserves the original readAt', async () => {
    const { tenantId, instructorId } = await createInstructorTenant('student-read');
    const studentId = await createStudentWithTenant('student-read-own', tenantId, instructorId);
    const otherStudentId = await createStudentWithTenant('student-read-other', tenantId, instructorId);
    const token = await issueAccessToken(studentId, PlatformRole.STUDENT);
    const installationId = installation(3);
    await createActiveDevice(studentId, installationId);

    const notificationId = await createNotification({ recipientUserId: studentId, tenantId, type: 'READ_OWN' });
    const foreignNotificationId = await createNotification({
      recipientUserId: otherStudentId,
      tenantId,
      type: 'READ_FOREIGN',
    });
    const randomNotificationId = uuid.create();

    const first = await request(server)
      .patch(`/student/notifications/${notificationId}/read`)
      .set('Authorization', `Bearer ${token}`)
      .set(INSTALLATION_ID_HEADER, installationId)
      .expect(HttpStatus.OK);
    const firstBody = responseBody<NotificationResponse>(first);
    expect(firstBody.read).toBe(true);
    expect(firstBody.readAt).toEqual(expect.any(String));

    const persistedReadAt = (await prisma.client.notification.findUniqueOrThrow({ where: { id: notificationId } }))
      .readAt;
    expect(persistedReadAt).not.toBeNull();

    const second = await request(server)
      .patch(`/student/notifications/${notificationId}/read`)
      .set('Authorization', `Bearer ${token}`)
      .set(INSTALLATION_ID_HEADER, installationId)
      .expect(HttpStatus.OK);
    expect(responseBody<NotificationResponse>(second).readAt).toBe(persistedReadAt?.toISOString());

    await expect(
      prisma.client.notification.findUniqueOrThrow({ where: { id: notificationId } }),
    ).resolves.toMatchObject({ readAt: persistedReadAt });

    for (const id of [randomNotificationId, foreignNotificationId]) {
      await request(server)
        .patch(`/student/notifications/${id}/read`)
        .set('Authorization', `Bearer ${token}`)
        .set(INSTALLATION_ID_HEADER, installationId)
        .expect(HttpStatus.NOT_FOUND)
        .expect(({ body }) => {
          expect(body).toEqual({
            error: {
              code: 'NOTIFICATION_NOT_FOUND',
              message: 'Notification was not found.',
            },
          });
        });
    }

    await expect(
      prisma.client.notification.findUniqueOrThrow({ where: { id: foreignNotificationId } }),
    ).resolves.toMatchObject({ readAt: null });
  });

  it('preserves the first readAt when concurrent mark-read requests race on one unread notification', async () => {
    const { tenantId, instructorId } = await createInstructorTenant('student-read-race');
    const studentId = await createStudentWithTenant('student-read-race-own', tenantId, instructorId);
    const token = await issueAccessToken(studentId, PlatformRole.STUDENT);
    const installationId = installation(31);
    await createActiveDevice(studentId, installationId);

    const notificationId = await createNotification({
      recipientUserId: studentId,
      tenantId,
      type: 'READ_RACE',
    });

    const [first, second] = await Promise.all([
      request(server)
        .patch(`/student/notifications/${notificationId}/read`)
        .set('Authorization', `Bearer ${token}`)
        .set(INSTALLATION_ID_HEADER, installationId),
      request(server)
        .patch(`/student/notifications/${notificationId}/read`)
        .set('Authorization', `Bearer ${token}`)
        .set(INSTALLATION_ID_HEADER, installationId),
    ]);

    expect(first.status).toBe(HttpStatus.OK);
    expect(second.status).toBe(HttpStatus.OK);

    const persistedReadAt = (await prisma.client.notification.findUniqueOrThrow({ where: { id: notificationId } }))
      .readAt;
    expect(persistedReadAt).not.toBeNull();
    const persistedIso = persistedReadAt?.toISOString();
    expect(responseBody<NotificationResponse>(first).readAt).toBe(persistedIso);
    expect(responseBody<NotificationResponse>(second).readAt).toBe(persistedIso);

    await request(server)
      .patch(`/student/notifications/${notificationId}/read`)
      .set('Authorization', `Bearer ${token}`)
      .set(INSTALLATION_ID_HEADER, installationId)
      .expect(HttpStatus.OK)
      .expect(({ body }) => {
        expect((body as NotificationResponse).readAt).toBe(persistedIso);
      });

    await expect(
      prisma.client.notification.findUniqueOrThrow({ where: { id: notificationId } }),
    ).resolves.toMatchObject({ readAt: persistedReadAt });
  });

  it('enforces the student device and active student guard chain for student notifications', async () => {
    const { tenantId, instructorId, token: instructorToken } = await createInstructorTenant('student-guards');
    const studentId = await createStudentWithTenant('student-guards-own', tenantId, instructorId);
    const token = await issueAccessToken(studentId, PlatformRole.STUDENT);
    const installationId = installation(4);
    await createNotification({ recipientUserId: studentId, tenantId, type: 'GUARD' });

    await request(server)
      .get('/student/notifications')
      .set('Authorization', `Bearer ${token}`)
      .set(INSTALLATION_ID_HEADER, installationId)
      .expect(HttpStatus.FORBIDDEN);

    await createActiveDevice(studentId, installationId);
    await request(server)
      .get('/student/notifications')
      .set('Authorization', `Bearer ${token}`)
      .set(INSTALLATION_ID_HEADER, installationId)
      .expect(HttpStatus.OK);

    await request(server)
      .get('/student/notifications')
      .set('Authorization', `Bearer ${instructorToken}`)
      .set(INSTALLATION_ID_HEADER, installationId)
      .expect(HttpStatus.FORBIDDEN);

    await prisma.client.user.update({
      where: { id: studentId },
      data: { accountStatus: AccountStatus.SUSPENDED },
    });

    await request(server)
      .get('/student/notifications')
      .set('Authorization', `Bearer ${token}`)
      .set(INSTALLATION_ID_HEADER, installationId)
      .expect(HttpStatus.FORBIDDEN);
  });

  it('allows instructors to read and mark only their own notification inbox', async () => {
    const { tenantId, instructorId, token } = await createInstructorTenant('instructor-inbox');
    const { instructorId: otherInstructorId } = await createInstructorTenant('instructor-inbox-other');
    const ownNotificationId = await createNotification({
      recipientUserId: instructorId,
      tenantId,
      type: 'INSTRUCTOR_OWN',
    });
    const foreignNotificationId = await createNotification({
      recipientUserId: otherInstructorId,
      tenantId: null,
      type: 'INSTRUCTOR_FOREIGN',
    });

    await request(server)
      .get('/instructor/notifications?limit=25&offset=0')
      .set('Authorization', `Bearer ${token}`)
      .expect(HttpStatus.OK)
      .expect(({ body }) => {
        const typed = body as { items: NotificationResponse[] };
        expect(typed.items.map((item) => item.notificationId)).toEqual([ownNotificationId]);
        expect(typed.items[0].recipientUserId).toBeUndefined();
      });

    await request(server)
      .get('/instructor/notifications/unread-count')
      .set('Authorization', `Bearer ${token}`)
      .expect(HttpStatus.OK)
      .expect(({ body }) => expect(body).toEqual({ unreadCount: 1 }));

    await request(server)
      .patch(`/instructor/notifications/${foreignNotificationId}/read`)
      .set('Authorization', `Bearer ${token}`)
      .expect(HttpStatus.NOT_FOUND);

    await request(server)
      .patch(`/instructor/notifications/${ownNotificationId}/read`)
      .set('Authorization', `Bearer ${token}`)
      .expect(HttpStatus.OK)
      .expect(({ body }) => {
        const typed = body as NotificationResponse;
        expect(typed.read).toBe(true);
      });
  });

  it('creates one student notification when a new active enrollment is successfully created', async () => {
    const { tenantId, instructorId, token } = await createInstructorTenant('producer');
    const studentId = await createStudentWithTenant('producer-student', tenantId, instructorId);
    const courseId = await createCourse(tenantId, instructorId, 'Producer Course');

    const response = await request(server)
      .post(`/instructor/tenants/${tenantId}/enrollments`)
      .set('Authorization', `Bearer ${token}`)
      .send({ studentUserId: studentId, courseId })
      .expect(HttpStatus.CREATED);
    const enrollmentId = responseBody<{ enrollmentId: string }>(response).enrollmentId;

    const row = await prisma.client.notification.findFirstOrThrow({
      where: {
        recipientUserId: studentId,
        type: 'COURSE_ENROLLMENT_CREATED',
        domainEntityType: 'Enrollment',
        domainEntityId: enrollmentId,
      },
    });
    expect(row).toMatchObject({
      tenantId,
      recipientUserId: studentId,
      category: NotificationCategory.COURSE,
      title: 'New course enrollment',
      body: 'You have been enrolled in Producer Course.',
      readAt: null,
    });
  });

  it('does not create a notification for rejected cross-tenant enrollment attempts', async () => {
    const { tenantId, instructorId, token } = await createInstructorTenant('cross-tenant-a');
    const { tenantId: otherTenantId, instructorId: otherInstructorId } =
      await createInstructorTenant('cross-tenant-b');
    const studentId = await createStudentWithTenant('cross-tenant-student-a', tenantId, instructorId);
    const otherStudentId = await createStudentWithTenant(
      'cross-tenant-student-b',
      otherTenantId,
      otherInstructorId,
    );
    const courseId = await createCourse(tenantId, instructorId, 'Cross Tenant Course');

    await request(server)
      .post(`/instructor/tenants/${tenantId}/enrollments`)
      .set('Authorization', `Bearer ${token}`)
      .send({ studentUserId: otherStudentId, courseId })
      .expect(HttpStatus.NOT_FOUND);

    await expect(prisma.client.notification.count()).resolves.toBe(0);

    await request(server)
      .post(`/instructor/tenants/${tenantId}/enrollments`)
      .set('Authorization', `Bearer ${token}`)
      .send({ studentUserId: studentId, courseId })
      .expect(HttpStatus.CREATED);

    await expect(
      prisma.client.notification.count({ where: { recipientUserId: studentId, tenantId } }),
    ).resolves.toBe(1);
    await expect(
      prisma.client.notification.count({ where: { recipientUserId: otherStudentId } }),
    ).resolves.toBe(0);
  });

  it('does not create duplicate notifications when an enrollment create is retried or raced', async () => {
    const { tenantId, instructorId, token } = await createInstructorTenant('producer-race');
    const studentId = await createStudentWithTenant('producer-race-student', tenantId, instructorId);
    const courseId = await createCourse(tenantId, instructorId, 'Producer Race Course');

    const [first, second] = await Promise.all([
      request(server)
        .post(`/instructor/tenants/${tenantId}/enrollments`)
        .set('Authorization', `Bearer ${token}`)
        .send({ studentUserId: studentId, courseId }),
      request(server)
        .post(`/instructor/tenants/${tenantId}/enrollments`)
        .set('Authorization', `Bearer ${token}`)
        .send({ studentUserId: studentId, courseId }),
    ]);

    expect([first.status, second.status].sort()).toEqual([HttpStatus.CREATED, HttpStatus.CONFLICT].sort());
    await expect(
      prisma.client.enrollment.count({
        where: { studentUserId: studentId, courseId, status: EnrollmentStatus.ACTIVE },
      }),
    ).resolves.toBe(1);
    await expect(
      prisma.client.notification.count({
        where: {
          recipientUserId: studentId,
          tenantId,
          type: 'COURSE_ENROLLMENT_CREATED',
          domainEntityType: 'Enrollment',
        },
      }),
    ).resolves.toBe(1);

    const enrollment = await prisma.client.enrollment.findFirstOrThrow({
      where: { studentUserId: studentId, courseId },
    });
    await prisma.client.$transaction((tx) =>
      notifications.createEnrollmentCreatedNotification(tx, {
        tenantId,
        courseId,
        courseTitle: 'Producer Race Course',
        enrollmentId: enrollment.id,
        studentUserId: studentId,
        now: new Date(),
      }),
    );
    await expect(
      prisma.client.notification.count({
        where: {
          recipientUserId: studentId,
          tenantId,
          type: 'COURSE_ENROLLMENT_CREATED',
          domainEntityId: enrollment.id,
        },
      }),
    ).resolves.toBe(1);
  });

  async function clearNotificationData(): Promise<void> {
    await prisma.client.notification.deleteMany();
    await prisma.client.securityEvent.deleteMany();
    await prisma.client.lessonProgress.deleteMany();
    await prisma.client.quizAttemptAnswer.deleteMany();
    await prisma.client.quizAttempt.deleteMany();
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
          startsWith: 'notification-test-',
        },
      },
    });
    await prisma.client.user.deleteMany({
      where: {
        normalizedEmail: {
          endsWith: '@notification.test',
        },
      },
    });
  }

  async function createUser(emailPrefix: string, platformRole: PlatformRole): Promise<string> {
    const id = uuid.create();
    await prisma.client.user.create({
      data: {
        id,
        email: `${emailPrefix}@notification.test`,
        normalizedEmail: `${emailPrefix}@notification.test`,
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
        name: `Notification Tenant ${slugSuffix}`,
        slug: `notification-test-${slugSuffix}`,
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

  async function createNotification(input: {
    id?: string;
    tenantId?: string | null;
    recipientUserId: string;
    type: string;
    title?: string;
    body?: string;
    readAt?: Date | null;
    createdAt?: Date;
  }): Promise<string> {
    const id = input.id ?? uuid.create();
    await prisma.client.notification.create({
      data: {
        id,
        tenantId: input.tenantId ?? null,
        recipientUserId: input.recipientUserId,
        type: input.type,
        category: NotificationCategory.COURSE,
        title: input.title ?? input.type,
        body: input.body ?? `${input.type} body`,
        readAt: input.readAt ?? null,
        createdAt: input.createdAt ?? new Date(),
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
