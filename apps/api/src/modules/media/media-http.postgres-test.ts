import { HttpStatus, INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import * as cookieParser from 'cookie-parser';
import * as request from 'supertest';
import type { App } from 'supertest/types';
import {
  AccountStatus,
  AssetProcessingStatus,
  LessonType,
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
import { CoursesModule } from '../courses/courses.module';
import { TenancyModule } from '../tenancy/tenancy.module';
import { MediaModule } from './media.module';

const testDatabaseUrl = process.env.TEST_DATABASE_URL;
const maybeDescribe = testDatabaseUrl ? describe : describe.skip;
const trustedOrigin = 'http://localhost:3000';

maybeDescribe('instructor media HTTP PostgreSQL integration', () => {
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

    await clearMediaData();
  });

  afterEach(async () => {
    await clearMediaData();
    await app?.close();
  });

  it('does not expose fake media registration routes before provider upload integration exists', async () => {
    const { token, tenantId } = await createInstructorTenant('registration-deferred');

    await request(server)
      .post(`/instructor/tenants/${tenantId}/media/videos`)
      .set('Authorization', `Bearer ${token}`)
      .send({
        processingStatus: AssetProcessingStatus.READY,
        durationSeconds: 900,
        providerKey: 'provider',
        externalAssetRef: 'client/fabricated/video',
      })
      .expect(HttpStatus.NOT_FOUND);

    await request(server)
      .post(`/instructor/tenants/${tenantId}/media/documents`)
      .set('Authorization', `Bearer ${token}`)
      .send({
        fileName: 'syllabus.pdf',
        mimeType: 'application/pdf',
        fileSizeBytes: 2048,
        externalAssetRef: 'client/fabricated/document',
      })
      .expect(HttpStatus.NOT_FOUND);

    await expect(prisma.client.videoAsset.count()).resolves.toBe(0);
    await expect(prisma.client.documentAsset.count()).resolves.toBe(0);
  });

  it('lists video and document assets by tenant with deterministic bounded pagination', async () => {
    const { token, tenantId, instructorId } = await createInstructorTenant('list-a');
    const { tenantId: otherTenantId, instructorId: otherInstructorId } =
      await createInstructorTenant('list-b');

    const oldVideo = await createVideoAssetDirect(tenantId, instructorId, new Date('2026-01-01T00:00:00Z'));
    const newVideo = await createVideoAssetDirect(tenantId, instructorId, new Date('2026-01-02T00:00:00Z'));
    await createVideoAssetDirect(otherTenantId, otherInstructorId, new Date('2026-01-03T00:00:00Z'));

    const oldDocument = await createDocumentAssetDirect(
      tenantId,
      instructorId,
      'old.pdf',
      new Date('2026-01-01T00:00:00Z'),
    );
    const newDocument = await createDocumentAssetDirect(
      tenantId,
      instructorId,
      'new.pdf',
      new Date('2026-01-02T00:00:00Z'),
    );
    await createDocumentAssetDirect(otherTenantId, otherInstructorId, 'other.pdf', new Date('2026-01-03T00:00:00Z'));

    await request(server)
      .get(`/instructor/tenants/${tenantId}/media/videos?limit=101`)
      .set('Authorization', `Bearer ${token}`)
      .expect(HttpStatus.BAD_REQUEST);

    await request(server)
      .get(`/instructor/tenants/${tenantId}/media/documents?limit=101`)
      .set('Authorization', `Bearer ${token}`)
      .expect(HttpStatus.BAD_REQUEST);

    await request(server)
      .get(`/instructor/tenants/${tenantId}/media/videos?limit=1&offset=0`)
      .set('Authorization', `Bearer ${token}`)
      .expect(HttpStatus.OK)
      .expect(({ body }) => {
        const typed = body as { items: Array<{ videoAssetId: string }>; limit: number; offset: number };
        expect(typed.limit).toBe(1);
        expect(typed.offset).toBe(0);
        expect(typed.items.map((item) => item.videoAssetId)).toEqual([newVideo]);
      });

    await request(server)
      .get(`/instructor/tenants/${tenantId}/media/videos?limit=1&offset=1`)
      .set('Authorization', `Bearer ${token}`)
      .expect(HttpStatus.OK)
      .expect(({ body }) => {
        const typed = body as { items: Array<{ videoAssetId: string }> };
        expect(typed.items.map((item) => item.videoAssetId)).toEqual([oldVideo]);
      });

    await request(server)
      .get(`/instructor/tenants/${tenantId}/media/documents?limit=2&offset=0`)
      .set('Authorization', `Bearer ${token}`)
      .expect(HttpStatus.OK)
      .expect(({ body }) => {
        const typed = body as { items: Array<{ documentAssetId: string }> };
        expect(typed.items.map((item) => item.documentAssetId)).toEqual([newDocument, oldDocument]);
      });
  });

  it('reads own tenant assets and returns non-leaking not found for random or foreign asset IDs', async () => {
    const { token, tenantId, instructorId } = await createInstructorTenant('detail-a');
    const { tenantId: otherTenantId, instructorId: otherInstructorId } =
      await createInstructorTenant('detail-b');
    const videoAssetId = await createVideoAssetDirect(tenantId, instructorId);
    const documentAssetId = await createDocumentAssetDirect(tenantId, instructorId, 'detail.pdf');
    const foreignVideoAssetId = await createVideoAssetDirect(otherTenantId, otherInstructorId);
    const foreignDocumentAssetId = await createDocumentAssetDirect(otherTenantId, otherInstructorId, 'foreign.pdf');

    await request(server)
      .get(`/instructor/tenants/${tenantId}/media/videos/${videoAssetId}`)
      .set('Authorization', `Bearer ${token}`)
      .expect(HttpStatus.OK)
      .expect(({ body }) => {
        expect(body).toMatchObject({ videoAssetId, tenantId });
        expect(JSON.stringify(body)).not.toMatch(/externalAssetRef|providerKey|url|token|secret/i);
      });

    await request(server)
      .get(`/instructor/tenants/${tenantId}/media/documents/${documentAssetId}`)
      .set('Authorization', `Bearer ${token}`)
      .expect(HttpStatus.OK)
      .expect(({ body }) => {
        expect(body).toMatchObject({ documentAssetId, tenantId, fileName: 'detail.pdf' });
        expect(JSON.stringify(body)).not.toMatch(/externalAssetRef|providerKey|url|token|secret/i);
      });

    await request(server)
      .get(`/instructor/tenants/${tenantId}/media/videos/${foreignVideoAssetId}`)
      .set('Authorization', `Bearer ${token}`)
      .expect(HttpStatus.NOT_FOUND)
      .expect(({ body }) => expect(body).toMatchObject({ error: { code: 'VIDEO_ASSET_NOT_FOUND' } }));

    await request(server)
      .get(`/instructor/tenants/${tenantId}/media/documents/${foreignDocumentAssetId}`)
      .set('Authorization', `Bearer ${token}`)
      .expect(HttpStatus.NOT_FOUND)
      .expect(({ body }) => expect(body).toMatchObject({ error: { code: 'DOCUMENT_ASSET_NOT_FOUND' } }));

    await request(server)
      .get(`/instructor/tenants/${tenantId}/media/videos/${uuid.create()}`)
      .set('Authorization', `Bearer ${token}`)
      .expect(HttpStatus.NOT_FOUND);
  });

  it('denies non-instructors on instructor media routes', async () => {
    const { tenantId } = await createInstructorTenant('role-and-validation');
    const studentToken = await issueAccessToken(await createUser('media-student', PlatformRole.STUDENT), PlatformRole.STUDENT);
    const adminToken = await issueAccessToken(
      await createUser('media-admin', PlatformRole.PLATFORM_ADMIN),
      PlatformRole.PLATFORM_ADMIN,
    );

    await request(server)
      .get(`/instructor/tenants/${tenantId}/media/videos`)
      .set('Authorization', `Bearer ${studentToken}`)
      .expect(HttpStatus.FORBIDDEN);

    await request(server)
      .get(`/instructor/tenants/${tenantId}/media/documents`)
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(HttpStatus.FORBIDDEN);
  });

  it('keeps VideoAsset and DocumentAsset tenant attachment checks intact for Lesson creation', async () => {
    const { token, tenantId, instructorId } = await createInstructorTenant('attach-a');
    const { tenantId: otherTenantId, instructorId: otherInstructorId } =
      await createInstructorTenant('attach-b');
    const courseId = await createCourseDirect(tenantId, instructorId);
    const sectionId = await createSectionDirect(tenantId, courseId);
    const videoAssetId = await createVideoAssetDirect(otherTenantId, otherInstructorId);
    const documentAssetId = await createDocumentAssetDirect(otherTenantId, otherInstructorId, 'foreign.pdf');

    await request(server)
      .post(`/instructor/tenants/${tenantId}/courses/${courseId}/sections/${sectionId}/lessons`)
      .set('Authorization', `Bearer ${token}`)
      .send({ title: 'Foreign video', type: LessonType.VIDEO, videoAssetId })
      .expect(HttpStatus.NOT_FOUND)
      .expect(({ body }) => expect(body).toMatchObject({ error: { code: 'LESSON_REFERENCE_NOT_FOUND' } }));

    await request(server)
      .post(`/instructor/tenants/${tenantId}/courses/${courseId}/sections/${sectionId}/lessons`)
      .set('Authorization', `Bearer ${token}`)
      .send({ title: 'Foreign document', type: LessonType.DOCUMENT, documentAssetId })
      .expect(HttpStatus.NOT_FOUND)
      .expect(({ body }) => expect(body).toMatchObject({ error: { code: 'LESSON_REFERENCE_NOT_FOUND' } }));

    await expect(prisma.client.lesson.count({ where: { sectionId } })).resolves.toBe(0);
  });

  async function clearMediaData(): Promise<void> {
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
      where: { slug: { startsWith: 'media-test-' } },
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
    const tenant = await prisma.client.tenant.create({
      data: {
        id: uuid.create(),
        name: `Media Tenant ${slugSuffix}`,
        slug: `media-test-${slugSuffix}`,
        status: TenantStatus.ACTIVE,
      },
    });
    await prisma.client.instructorProfile.create({ data: { id: uuid.create(), userId: instructorId } });
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

  async function createVideoAssetDirect(
    tenantId: string,
    uploadedByUserId: string,
    createdAt?: Date,
  ): Promise<string> {
    const id = uuid.create();
    await prisma.client.videoAsset.create({
      data: {
        id,
        tenantId,
        uploadedByUserId,
        externalAssetRef: `media-fixture/video/${id}`,
        ...(createdAt ? { createdAt } : {}),
      },
    });
    return id;
  }

  async function createDocumentAssetDirect(
    tenantId: string,
    uploadedByUserId: string,
    fileName: string,
    createdAt?: Date,
  ): Promise<string> {
    const id = uuid.create();
    await prisma.client.documentAsset.create({
      data: {
        id,
        tenantId,
        uploadedByUserId,
        externalAssetRef: `media-fixture/document/${id}`,
        fileName,
        mimeType: 'application/pdf',
        fileSizeBytes: BigInt(1024),
        ...(createdAt ? { createdAt } : {}),
      },
    });
    return id;
  }

  async function createCourseDirect(tenantId: string, createdByUserId: string): Promise<string> {
    const id = uuid.create();
    await prisma.client.course.create({
      data: { id, tenantId, createdByUserId, title: 'Media attachment course' },
    });
    return id;
  }

  async function createSectionDirect(tenantId: string, courseId: string): Promise<string> {
    const id = uuid.create();
    await prisma.client.courseSection.create({
      data: { id, tenantId, courseId, title: 'Media attachment section', position: 1 },
    });
    return id;
  }

  async function issueAccessToken(userId: string, platformRole: PlatformRole): Promise<string> {
    const session = await refreshSessions.createSession({ userId, channel: 'MOBILE' });
    return accessTokens.sign({ userId, sessionId: session.sessionId, platformRole });
  }
});
