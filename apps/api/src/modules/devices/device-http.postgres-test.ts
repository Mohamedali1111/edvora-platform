import { Controller, Get, HttpStatus, INestApplication, UseGuards, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import * as cookieParser from 'cookie-parser';
import * as request from 'supertest';
import type { App } from 'supertest/types';
import {
  AccountStatus,
  CredentialType,
  DeviceChangeRequestStatus,
  DevicePlatform,
  PlatformRole,
  RefreshSessionStatus,
  StudentDeviceStatus,
} from '../../../.generated/prisma/client';
import type { DatabaseRuntimeConfig } from '../../infrastructure/database/database.config';
import { DATABASE_RUNTIME_CONFIG } from '../../infrastructure/database/database.constants';
import { PrismaService } from '../../infrastructure/database/prisma.service';
import { ApiExceptionFilter } from '../../infrastructure/http/api-exception.filter';
import { AccessTokenGuard } from '../auth/http/access-token.guard';
import { AUTH_HTTP_CONFIG } from '../auth/http/auth-http.constants';
import { AuthModule } from '../auth/auth.module';
import { AUTH_RUNTIME_CONFIG } from '../auth/auth.constants';
import { testAuthConfig } from '../auth/test-helpers';
import { AccessTokenService } from '../auth/services/access-token.service';
import { PasswordResetTokenService } from '../auth/services/password-reset-token.service';
import { PasswordService } from '../auth/services/password.service';
import { RefreshSessionService } from '../auth/services/refresh-session.service';
import { SecurityEventService } from '../auth/services/security-event.service';
import { UuidV7Service } from '../auth/services/uuid-v7.service';
import { DeviceModule } from './device.module';
import { StudentDeviceGuard } from './http/student-device.guard';
import { INSTALLATION_ID_HEADER } from './types/device.types';

const testDatabaseUrl = process.env.TEST_DATABASE_URL;
const maybeDescribe = testDatabaseUrl ? describe : describe.skip;
const trustedOrigin = 'http://localhost:3000';

type AuthSessionBody = {
  accessToken: string;
  refreshToken: string;
  sessionId: string;
};

type DeviceStatusBody = {
  status: string;
};

type DeviceChangeBody = {
  status: string;
  requestId: string;
};

type DeviceChangeListBody = {
  items: unknown[];
  limit: number;
  offset: number;
};

@Controller('test/student-device')
class ProtectedStudentDeviceController {
  @Get('protected')
  @UseGuards(AccessTokenGuard, StudentDeviceGuard)
  protectedRoute(): { ok: true } {
    return { ok: true };
  }
}

maybeDescribe('student device authorization HTTP PostgreSQL integration', () => {
  let app: INestApplication;
  let server: App;
  let prisma: PrismaService;
  let accessTokens: AccessTokenService;
  let refreshSessions: RefreshSessionService;
  let resets: PasswordResetTokenService;
  let passwordService: PasswordService;
  let securityEvents: SecurityEventService;
  let uuid: UuidV7Service;

  beforeEach(async () => {
    const databaseConfig: DatabaseRuntimeConfig = {
      databaseUrl: testDatabaseUrl as string,
      pool: {
        maxConnections: 4,
        connectionTimeoutMillis: 5_000,
        idleTimeoutMillis: 10_000,
      },
    };

    const moduleRef = await Test.createTestingModule({
      imports: [AuthModule, DeviceModule],
      controllers: [ProtectedStudentDeviceController],
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
    resets = moduleRef.get(PasswordResetTokenService);
    passwordService = moduleRef.get(PasswordService);
    securityEvents = moduleRef.get(SecurityEventService);
    uuid = moduleRef.get(UuidV7Service);

    await clearDeviceData();
  });

  afterEach(async () => {
    jest.restoreAllMocks();
    await app?.close();
  });

  it('keeps login separate from device authorization and authorizes the first device once', async () => {
    const studentId = await createUser('device-login-student', PlatformRole.STUDENT);
    await createCredential(studentId, 'student login password');

    const login = await request(server)
      .post('/auth/login')
      .send({
        email: 'device-login-student@example.test',
        password: 'student login password',
        channel: 'MOBILE',
      })
      .expect(HttpStatus.OK);
    const accessToken = authSessionBody(login).accessToken;

    await expect(prisma.client.studentDevice.count({ where: { studentUserId: studentId } })).resolves.toBe(0);

    await request(server)
      .get('/test/student-device/protected')
      .set('Authorization', `Bearer ${accessToken}`)
      .set(INSTALLATION_ID_HEADER, installation(1))
      .expect(HttpStatus.FORBIDDEN);

    const authorized = await request(server)
      .post('/student/device/authorize')
      .set('Authorization', `Bearer ${accessToken}`)
      .set(INSTALLATION_ID_HEADER, installation(1))
      .send({ platform: DevicePlatform.IOS, deviceModel: 'Test iPhone' })
      .expect(HttpStatus.OK);

    expect(authorized.body).toEqual({ status: 'AUTHORIZED' });

    await request(server)
      .get('/test/student-device/protected')
      .set('Authorization', `Bearer ${accessToken}`)
      .set(INSTALLATION_ID_HEADER, installation(1))
      .expect(HttpStatus.OK);

    await request(server)
      .get('/test/student-device/protected')
      .set('Authorization', `Bearer ${accessToken}`)
      .set(INSTALLATION_ID_HEADER, `${installation(1)}, ${installation(2)}`)
      .expect(HttpStatus.BAD_REQUEST);

    await request(server)
      .post('/student/device/authorize')
      .set('Authorization', `Bearer ${accessToken}`)
      .set(INSTALLATION_ID_HEADER, installation(1))
      .send({ platform: DevicePlatform.IOS, studentUserId: studentId })
      .expect(HttpStatus.BAD_REQUEST);

    await request(server)
      .post('/student/device/authorize')
      .set('Authorization', `Bearer ${accessToken}`)
      .set(INSTALLATION_ID_HEADER, installation(2))
      .send({ platform: DevicePlatform.ANDROID })
      .expect(HttpStatus.OK)
      .expect(({ body }) => {
        expect(body).toEqual({ status: 'CHANGE_REQUIRED', pendingRequest: false });
      });

    await expect(
      prisma.client.studentDevice.count({
        where: { studentUserId: studentId, status: StudentDeviceStatus.ACTIVE },
      }),
    ).resolves.toBe(1);
  });

  it('allows only one first-device winner under concurrent different-installation attempts', async () => {
    const studentId = await createUser('device-race-student', PlatformRole.STUDENT);
    const token = await issueAccessToken(studentId, PlatformRole.STUDENT);

    const [first, second] = await Promise.all([
      request(server)
        .post('/student/device/authorize')
        .set('Authorization', `Bearer ${token}`)
        .set(INSTALLATION_ID_HEADER, installation(11))
        .send({ platform: DevicePlatform.IOS }),
      request(server)
        .post('/student/device/authorize')
        .set('Authorization', `Bearer ${token}`)
        .set(INSTALLATION_ID_HEADER, installation(12))
        .send({ platform: DevicePlatform.ANDROID }),
    ]);

    expect([first.status, second.status]).toEqual([HttpStatus.OK, HttpStatus.OK]);
    expect([deviceStatusBody(first).status, deviceStatusBody(second).status].sort()).toEqual([
      'AUTHORIZED',
      'CHANGE_REQUIRED',
    ]);
    await expect(
      prisma.client.studentDevice.count({
        where: { studentUserId: studentId, status: StudentDeviceStatus.ACTIVE },
      }),
    ).resolves.toBe(1);
  });

  it('treats concurrent same-installation authorization idempotently', async () => {
    const studentId = await createUser('device-idempotent-student', PlatformRole.STUDENT);
    const token = await issueAccessToken(studentId, PlatformRole.STUDENT);

    const [first, second] = await Promise.all([
      request(server)
        .post('/student/device/authorize')
        .set('Authorization', `Bearer ${token}`)
        .set(INSTALLATION_ID_HEADER, installation(21))
        .send({ platform: DevicePlatform.IOS }),
      request(server)
        .post('/student/device/authorize')
        .set('Authorization', `Bearer ${token}`)
        .set(INSTALLATION_ID_HEADER, installation(21))
        .send({ platform: DevicePlatform.IOS }),
    ]);

    expect(first.body).toEqual({ status: 'AUTHORIZED' });
    expect(second.body).toEqual({ status: 'AUTHORIZED' });
    await expect(prisma.client.studentDevice.count({ where: { studentUserId: studentId } })).resolves.toBe(1);
  });

  it('keeps one pending change request and rejects a different candidate while pending', async () => {
    const studentId = await createUser('device-change-student', PlatformRole.STUDENT);
    const token = await issueAccessToken(studentId, PlatformRole.STUDENT);
    await authorizeDevice(token, installation(31), DevicePlatform.IOS);

    const [first, second] = await Promise.all([
      request(server)
        .post('/student/device/change-request')
        .set('Authorization', `Bearer ${token}`)
        .set(INSTALLATION_ID_HEADER, installation(32))
        .send({ platform: DevicePlatform.ANDROID, reason: 'new phone' }),
      request(server)
        .post('/student/device/change-request')
        .set('Authorization', `Bearer ${token}`)
        .set(INSTALLATION_ID_HEADER, installation(33))
        .send({ platform: DevicePlatform.ANDROID, reason: 'other phone' }),
    ]);

    expect([first.status, second.status].sort()).toEqual([HttpStatus.OK, HttpStatus.CONFLICT]);
    await expect(
      prisma.client.deviceChangeRequest.count({
        where: { studentUserId: studentId, status: DeviceChangeRequestStatus.PENDING },
      }),
    ).resolves.toBe(1);

    const existing = await request(server)
      .post('/student/device/change-request')
      .set('Authorization', `Bearer ${token}`)
      .set(INSTALLATION_ID_HEADER, installation(32))
      .send({ platform: DevicePlatform.ANDROID })
      .expect(HttpStatus.OK);

    expect(deviceChangeBody(existing).status).toBe('CHANGE_PENDING');
  });

  it('requires current database Platform Admin state and keeps admin list bounded', async () => {
    const studentId = await createUser('device-list-student', PlatformRole.STUDENT);
    const adminId = await createUser('device-list-admin', PlatformRole.PLATFORM_ADMIN);
    const instructorId = await createUser('device-list-instructor', PlatformRole.INSTRUCTOR);
    const studentToken = await issueAccessToken(studentId, PlatformRole.STUDENT);
    const adminToken = await issueAccessToken(adminId, PlatformRole.PLATFORM_ADMIN);
    const instructorToken = await issueAccessToken(instructorId, PlatformRole.INSTRUCTOR);

    await authorizeDevice(studentToken, installation(34), DevicePlatform.IOS);
    await requestDeviceChange(studentToken, installation(35), DevicePlatform.ANDROID);

    await request(server)
      .get('/admin/device-change-requests')
      .set('Authorization', `Bearer ${instructorToken}`)
      .expect(HttpStatus.FORBIDDEN);

    const listed = await request(server)
      .get('/admin/device-change-requests')
      .query({ limit: 1, offset: 0 })
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(HttpStatus.OK);

    expect(listBody(listed).items).toHaveLength(1);
    expect(listBody(listed)).toMatchObject({ limit: 1, offset: 0 });

    await prisma.client.user.update({
      where: { id: adminId },
      data: { platformRole: PlatformRole.INSTRUCTOR },
    });

    await request(server)
      .get('/admin/device-change-requests')
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(HttpStatus.FORBIDDEN);
  });

  it('allows only Platform Admin to approve and atomically replaces the active device', async () => {
    const studentId = await createUser('device-approval-student', PlatformRole.STUDENT);
    const adminId = await createUser('device-admin', PlatformRole.PLATFORM_ADMIN);
    const instructorId = await createUser('device-instructor', PlatformRole.INSTRUCTOR);
    const studentToken = await issueAccessToken(studentId, PlatformRole.STUDENT);
    const adminToken = await issueAccessToken(adminId, PlatformRole.PLATFORM_ADMIN);
    const instructorToken = await issueAccessToken(instructorId, PlatformRole.INSTRUCTOR);

    await authorizeDevice(studentToken, installation(41), DevicePlatform.IOS);
    const pending = await requestDeviceChange(studentToken, installation(42), DevicePlatform.ANDROID);

    await request(server)
      .post(`/admin/device-change-requests/${deviceChangeBody(pending).requestId}/approve`)
      .set('Authorization', `Bearer ${instructorToken}`)
      .send({})
      .expect(HttpStatus.FORBIDDEN);

    await request(server)
      .post(`/admin/device-change-requests/${deviceChangeBody(pending).requestId}/approve`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ reviewNote: 'Approved synthetic replacement.' })
      .expect(HttpStatus.NO_CONTENT);

    await expect(
      prisma.client.studentDevice.count({
        where: { studentUserId: studentId, status: StudentDeviceStatus.ACTIVE },
      }),
    ).resolves.toBe(1);

    const resolved = await prisma.client.deviceChangeRequest.findUniqueOrThrow({
      where: { id: deviceChangeBody(pending).requestId },
    });
    expect(resolved.status).toBe(DeviceChangeRequestStatus.APPROVED);
    expect(resolved.reviewedByUserId).toBe(adminId);

    await request(server)
      .get('/test/student-device/protected')
      .set('Authorization', `Bearer ${studentToken}`)
      .set(INSTALLATION_ID_HEADER, installation(41))
      .expect(HttpStatus.FORBIDDEN);

    await request(server)
      .get('/test/student-device/protected')
      .set('Authorization', `Bearer ${studentToken}`)
      .set(INSTALLATION_ID_HEADER, installation(42))
      .expect(HttpStatus.OK);

    await request(server)
      .post(`/admin/device-change-requests/${deviceChangeBody(pending).requestId}/reject`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({})
      .expect(HttpStatus.CONFLICT);
  });

  it('rolls back approval when a late transactional security event fails', async () => {
    const studentId = await createUser('device-rollback-student', PlatformRole.STUDENT);
    const adminId = await createUser('device-rollback-admin', PlatformRole.PLATFORM_ADMIN);
    const studentToken = await issueAccessToken(studentId, PlatformRole.STUDENT);
    const adminToken = await issueAccessToken(adminId, PlatformRole.PLATFORM_ADMIN);

    await authorizeDevice(studentToken, installation(44), DevicePlatform.IOS);
    const pending = await requestDeviceChange(studentToken, installation(45), DevicePlatform.ANDROID);
    const requestId = deviceChangeBody(pending).requestId;
    const requestBefore = await prisma.client.deviceChangeRequest.findUniqueOrThrow({
      where: { id: requestId },
    });

    const originalRecordWithinTransaction =
      securityEvents.recordWithinTransaction.bind(securityEvents);
    jest.spyOn(securityEvents, 'recordWithinTransaction').mockImplementation((tx, input) => {
      if (input.eventType === 'DEVICE_CHANGE_APPROVED') {
        throw new Error('synthetic approval event failure');
      }

      return originalRecordWithinTransaction(tx, input);
    });

    await request(server)
      .post(`/admin/device-change-requests/${requestId}/approve`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({})
      .expect(HttpStatus.INTERNAL_SERVER_ERROR);

    await expect(
      prisma.client.studentDevice.findUniqueOrThrow({
        where: { id: requestBefore.currentDeviceId ?? '' },
      }),
    ).resolves.toMatchObject({ status: StudentDeviceStatus.ACTIVE });
    await expect(
      prisma.client.studentDevice.findUniqueOrThrow({
        where: { id: requestBefore.requestedDeviceId ?? '' },
      }),
    ).resolves.toMatchObject({ status: StudentDeviceStatus.PENDING });
    await expect(
      prisma.client.deviceChangeRequest.findUniqueOrThrow({ where: { id: requestId } }),
    ).resolves.toMatchObject({ status: DeviceChangeRequestStatus.PENDING, reviewedByUserId: null });
    await expect(
      prisma.client.securityEvent.count({
        where: { eventType: 'DEVICE_CHANGE_APPROVED', targetUserId: studentId },
      }),
    ).resolves.toBe(0);
  });

  it('allows exactly one terminal outcome when approve and reject race', async () => {
    const studentId = await createUser('device-admin-race-student', PlatformRole.STUDENT);
    const firstAdminId = await createUser('device-admin-race-one', PlatformRole.PLATFORM_ADMIN);
    const secondAdminId = await createUser('device-admin-race-two', PlatformRole.PLATFORM_ADMIN);
    const studentToken = await issueAccessToken(studentId, PlatformRole.STUDENT);
    const firstAdminToken = await issueAccessToken(firstAdminId, PlatformRole.PLATFORM_ADMIN);
    const secondAdminToken = await issueAccessToken(secondAdminId, PlatformRole.PLATFORM_ADMIN);

    await authorizeDevice(studentToken, installation(46), DevicePlatform.IOS);
    const pending = await requestDeviceChange(studentToken, installation(47), DevicePlatform.ANDROID);
    const requestId = deviceChangeBody(pending).requestId;

    const [approved, rejected] = await Promise.all([
      request(server)
        .post(`/admin/device-change-requests/${requestId}/approve`)
        .set('Authorization', `Bearer ${firstAdminToken}`)
        .send({}),
      request(server)
        .post(`/admin/device-change-requests/${requestId}/reject`)
        .set('Authorization', `Bearer ${secondAdminToken}`)
        .send({}),
    ]);

    expect([approved.status, rejected.status].sort()).toEqual([
      HttpStatus.NO_CONTENT,
      HttpStatus.CONFLICT,
    ]);

    const resolved = await prisma.client.deviceChangeRequest.findUniqueOrThrow({
      where: { id: requestId },
    });
    expect([DeviceChangeRequestStatus.APPROVED, DeviceChangeRequestStatus.REJECTED]).toContain(
      resolved.status,
    );
    await expect(
      prisma.client.studentDevice.count({
        where: { studentUserId: studentId, status: StudentDeviceStatus.ACTIVE },
      }),
    ).resolves.toBe(1);
    await expect(
      prisma.client.securityEvent.count({
        where: {
          targetUserId: studentId,
          eventType: { in: ['DEVICE_CHANGE_APPROVED', 'DEVICE_CHANGE_REJECTED'] },
        },
      }),
    ).resolves.toBe(1);
  });

  it('allows exactly one winner for concurrent approvals of the same request', async () => {
    const studentId = await createUser('device-double-approval-student', PlatformRole.STUDENT);
    const firstAdminId = await createUser('device-double-approval-one', PlatformRole.PLATFORM_ADMIN);
    const secondAdminId = await createUser('device-double-approval-two', PlatformRole.PLATFORM_ADMIN);
    const studentToken = await issueAccessToken(studentId, PlatformRole.STUDENT);
    const firstAdminToken = await issueAccessToken(firstAdminId, PlatformRole.PLATFORM_ADMIN);
    const secondAdminToken = await issueAccessToken(secondAdminId, PlatformRole.PLATFORM_ADMIN);

    await authorizeDevice(studentToken, installation(48), DevicePlatform.IOS);
    const pending = await requestDeviceChange(studentToken, installation(49), DevicePlatform.ANDROID);
    const requestId = deviceChangeBody(pending).requestId;

    const [first, second] = await Promise.all([
      request(server)
        .post(`/admin/device-change-requests/${requestId}/approve`)
        .set('Authorization', `Bearer ${firstAdminToken}`)
        .send({}),
      request(server)
        .post(`/admin/device-change-requests/${requestId}/approve`)
        .set('Authorization', `Bearer ${secondAdminToken}`)
        .send({}),
    ]);

    expect([first.status, second.status].sort()).toEqual([
      HttpStatus.NO_CONTENT,
      HttpStatus.CONFLICT,
    ]);
    await expect(
      prisma.client.studentDevice.count({
        where: { studentUserId: studentId, status: StudentDeviceStatus.ACTIVE },
      }),
    ).resolves.toBe(1);
    await expect(
      prisma.client.securityEvent.count({
        where: { targetUserId: studentId, eventType: 'DEVICE_CHANGE_APPROVED' },
      }),
    ).resolves.toBe(1);
  });

  it('rejects a pending change without changing the active device', async () => {
    const studentId = await createUser('device-rejection-student', PlatformRole.STUDENT);
    const adminId = await createUser('device-rejection-admin', PlatformRole.PLATFORM_ADMIN);
    const studentToken = await issueAccessToken(studentId, PlatformRole.STUDENT);
    const adminToken = await issueAccessToken(adminId, PlatformRole.PLATFORM_ADMIN);

    await authorizeDevice(studentToken, installation(51), DevicePlatform.IOS);
    const pending = await requestDeviceChange(studentToken, installation(52), DevicePlatform.ANDROID);

    await request(server)
      .post(`/admin/device-change-requests/${deviceChangeBody(pending).requestId}/reject`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({})
      .expect(HttpStatus.NO_CONTENT);

    const resolved = await prisma.client.deviceChangeRequest.findUniqueOrThrow({
      where: { id: deviceChangeBody(pending).requestId },
    });
    expect(resolved.status).toBe(DeviceChangeRequestStatus.REJECTED);

    await request(server)
      .get('/test/student-device/protected')
      .set('Authorization', `Bearer ${studentToken}`)
      .set(INSTALLATION_ID_HEADER, installation(51))
      .expect(HttpStatus.OK);

    await request(server)
      .get('/test/student-device/protected')
      .set('Authorization', `Bearer ${studentToken}`)
      .set(INSTALLATION_ID_HEADER, installation(52))
      .expect(HttpStatus.FORBIDDEN);
  });

  it('keeps device approval independent from logout and password reset', async () => {
    const studentId = await createUser('device-session-student', PlatformRole.STUDENT);
    await createCredential(studentId, 'original device password');

    const login = await request(server)
      .post('/auth/login')
      .send({
        email: 'device-session-student@example.test',
        password: 'original device password',
        channel: 'MOBILE',
      })
      .expect(HttpStatus.OK);
    const firstAccessToken = authSessionBody(login).accessToken;

    await authorizeDevice(firstAccessToken, installation(61), DevicePlatform.IOS);

    await request(server)
      .post('/auth/logout')
      .set('Authorization', `Bearer ${firstAccessToken}`)
      .expect(HttpStatus.NO_CONTENT);

    await expect(
      prisma.client.studentDevice.count({
        where: { studentUserId: studentId, status: StudentDeviceStatus.ACTIVE },
      }),
    ).resolves.toBe(1);

    const secondLogin = await request(server)
      .post('/auth/login')
      .send({
        email: 'device-session-student@example.test',
        password: 'original device password',
        channel: 'MOBILE',
      })
      .expect(HttpStatus.OK);
    await request(server)
      .get('/test/student-device/protected')
      .set('Authorization', `Bearer ${authSessionBody(secondLogin).accessToken}`)
      .set(INSTALLATION_ID_HEADER, installation(61))
      .expect(HttpStatus.OK);

    const reset = await resets.issue({ userId: studentId });
    await request(server)
      .post('/auth/password/reset/complete')
      .send({
        resetToken: reset.rawToken,
        newPassword: 'changed device password',
      })
      .expect(HttpStatus.NO_CONTENT);

    await expect(
      prisma.client.refreshSession.count({
        where: { userId: studentId, status: RefreshSessionStatus.ACTIVE },
      }),
    ).resolves.toBe(0);
    await expect(
      prisma.client.studentDevice.count({
        where: { studentUserId: studentId, status: StudentDeviceStatus.ACTIVE },
      }),
    ).resolves.toBe(1);

    const thirdLogin = await request(server)
      .post('/auth/login')
      .send({
        email: 'device-session-student@example.test',
        password: 'changed device password',
        channel: 'MOBILE',
      })
      .expect(HttpStatus.OK);

    await request(server)
      .get('/test/student-device/protected')
      .set('Authorization', `Bearer ${authSessionBody(thirdLogin).accessToken}`)
      .set(INSTALLATION_ID_HEADER, installation(61))
      .expect(HttpStatus.OK);
    await request(server)
      .get('/test/student-device/protected')
      .set('Authorization', `Bearer ${authSessionBody(thirdLogin).accessToken}`)
      .set(INSTALLATION_ID_HEADER, installation(62))
      .expect(HttpStatus.FORBIDDEN);
  });

  async function clearDeviceData(): Promise<void> {
    await prisma.client.securityEvent.deleteMany();
    await prisma.client.deviceChangeRequest.deleteMany();
    await prisma.client.refreshSession.deleteMany();
    await prisma.client.authCredential.deleteMany();
    await prisma.client.accountActivationToken.deleteMany();
    await prisma.client.passwordResetToken.deleteMany();
    await prisma.client.studentDevice.deleteMany();
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

  async function issueAccessToken(userId: string, platformRole: PlatformRole): Promise<string> {
    const session = await refreshSessions.createSession({ userId, channel: 'MOBILE' });
    return accessTokens.sign({ userId, sessionId: session.sessionId, platformRole });
  }

  async function authorizeDevice(
    accessToken: string,
    installationId: string,
    platform: DevicePlatform,
  ): Promise<request.Response> {
    return request(server)
      .post('/student/device/authorize')
      .set('Authorization', `Bearer ${accessToken}`)
      .set(INSTALLATION_ID_HEADER, installationId)
      .send({ platform })
      .expect(HttpStatus.OK);
  }

  async function requestDeviceChange(
    accessToken: string,
    installationId: string,
    platform: DevicePlatform,
  ): Promise<request.Response> {
    return request(server)
      .post('/student/device/change-request')
      .set('Authorization', `Bearer ${accessToken}`)
      .set(INSTALLATION_ID_HEADER, installationId)
      .send({ platform })
      .expect(HttpStatus.OK);
  }
});

function installation(suffix: number): string {
  return `00000000-0000-7000-8000-${suffix.toString().padStart(12, '0')}`;
}

function authSessionBody(response: request.Response): AuthSessionBody {
  return response.body as unknown as AuthSessionBody;
}

function deviceStatusBody(response: request.Response): DeviceStatusBody {
  return response.body as unknown as DeviceStatusBody;
}

function deviceChangeBody(response: request.Response): DeviceChangeBody {
  return response.body as unknown as DeviceChangeBody;
}

function listBody(response: request.Response): DeviceChangeListBody {
  return response.body as unknown as DeviceChangeListBody;
}
