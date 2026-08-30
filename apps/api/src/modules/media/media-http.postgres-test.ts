import { HttpStatus, INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import * as cookieParser from 'cookie-parser';
import { createHmac, timingSafeEqual } from 'node:crypto';
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
import type { MediaRuntimeConfig } from './media.config';
import { DOCUMENT_STORAGE_PROVIDER, MEDIA_RUNTIME_CONFIG, VIDEO_PROVIDER } from './media.constants';
import { MediaModule } from './media.module';
import { InvalidVideoProviderWebhookError, VideoProviderCreateFailedError } from './errors/media.errors';
import type {
  DocumentObjectMetadata,
  DocumentStorageProvider,
  PresignedDownloadCapability,
  PresignedUploadCapability,
} from './storage/document-storage.provider';
import type {
  BunnyStreamWebhookEvent,
  ProviderVideoResource,
  TusUploadCapability,
  VideoProvider,
} from './video/video.provider';

const testDatabaseUrl = process.env.TEST_DATABASE_URL;
const maybeDescribe = testDatabaseUrl ? describe : describe.skip;
const trustedOrigin = 'http://localhost:3000';
const testMediaConfig: MediaRuntimeConfig = {
  documents: {
    r2: {
      endpoint: 'https://example-account.r2.cloudflarestorage.com',
      accessKeyId: 'test-access-key',
      secretAccessKey: 'test-secret-key',
      bucketName: 'test-documents',
      uploadUrlTtlSeconds: 600,
      downloadUrlTtlSeconds: 300,
    },
  },
  video: {
    bunnyStream: {
      libraryId: '123456',
      apiKey: 'test-bunny-api-key',
      webhookSigningSecret: 'test-bunny-webhook-secret',
      tusUploadUrl: 'https://video.bunnycdn.com/tusupload',
      tusAuthorizationTtlSeconds: 21_600,
    },
  },
};

maybeDescribe('instructor media HTTP PostgreSQL integration', () => {
  let app: INestApplication;
  let server: App;
  let prisma: PrismaService;
  let accessTokens: AccessTokenService;
  let refreshSessions: RefreshSessionService;
  let uuid: UuidV7Service;
  let documentStorage: FakeDocumentStorageProvider;
  let videoProvider: FakeVideoProvider;

  beforeEach(async () => {
    const databaseConfig: DatabaseRuntimeConfig = {
      databaseUrl: testDatabaseUrl as string,
      pool: {
        maxConnections: 6,
        connectionTimeoutMillis: 5_000,
        idleTimeoutMillis: 10_000,
      },
    };

    documentStorage = new FakeDocumentStorageProvider();
    videoProvider = new FakeVideoProvider();

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
      .overrideProvider(MEDIA_RUNTIME_CONFIG)
      .useValue(testMediaConfig)
      .overrideProvider(DOCUMENT_STORAGE_PROVIDER)
      .useValue(documentStorage)
      .overrideProvider(VIDEO_PROVIDER)
      .useValue(videoProvider)
      .compile();

    app = moduleRef.createNestApplication({ rawBody: true });
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

  it('does not expose fake video registration or old fake document registration routes', async () => {
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

  it('creates an authorized Bunny TUS upload intent with server-derived asset state', async () => {
    const { token, tenantId, instructorId } = await createInstructorTenant('video-upload-intent');

    const rejected = await request(server)
      .post(`/instructor/tenants/${tenantId}/media/videos/upload-intents`)
      .set('Authorization', `Bearer ${token}`)
      .send({
        title: '  Intro Video  ',
        tenantId: uuid.create(),
        uploadedByUserId: uuid.create(),
        id: uuid.create(),
        providerKey: 'client-provider',
        externalAssetRef: 'client-guid',
        processingStatus: AssetProcessingStatus.READY,
      })
      .expect(HttpStatus.BAD_REQUEST);
    expect(rejected.body).toMatchObject({ error: { code: 'VALIDATION_FAILED' } });

    const response = await request(server)
      .post(`/instructor/tenants/${tenantId}/media/videos/upload-intents`)
      .set('Authorization', `Bearer ${token}`)
      .send({ title: '  Intro Video  ' })
      .expect(HttpStatus.CREATED);

    const body = responseBody<{
      videoAssetId: string;
      tusEndpoint: string;
      expiresAt: string;
      headers: Record<string, string>;
      provider: { bunnyStream: { libraryId: string; videoId: string } };
    }>(response);

    expect(body.videoAssetId).toMatch(/^[0-9a-f-]{36}$/);
    expect(body.tusEndpoint).toBe('https://video.bunnycdn.com/tusupload');
    expect(body.provider.bunnyStream).toEqual({ libraryId: '123456', videoId: 'fake-bunny-video-1' });
    expect(body.headers).toEqual({
      AuthorizationSignature: 'signature-for-fake-bunny-video-1',
      AuthorizationExpire: '21600',
      VideoId: 'fake-bunny-video-1',
      LibraryId: '123456',
    });
    expect(JSON.stringify(body)).not.toMatch(/api[-_ ]?key|webhook|secret|test-bunny-api-key|test-bunny-webhook-secret|playback|hls|drm/i);
    expect(videoProvider.createRequests).toEqual([{ title: 'Intro Video' }]);

    await expect(prisma.client.videoAsset.findUniqueOrThrow({ where: { id: body.videoAssetId } })).resolves.toMatchObject({
      tenantId,
      uploadedByUserId: instructorId,
      providerKey: '123456',
      externalAssetRef: 'fake-bunny-video-1',
      processingStatus: AssetProcessingStatus.UPLOADING,
      durationSeconds: null,
    });
  });

  it('denies non-instructors and foreign tenants for video upload intents', async () => {
    const { tenantId } = await createInstructorTenant('video-denied-owner');
    const { token: foreignToken } = await createInstructorTenant('video-denied-foreign');
    const studentToken = await issueAccessToken(await createUser('video-denied-student', PlatformRole.STUDENT), PlatformRole.STUDENT);

    await request(server)
      .post(`/instructor/tenants/${tenantId}/media/videos/upload-intents`)
      .set('Authorization', `Bearer ${studentToken}`)
      .send({ title: 'Video' })
      .expect(HttpStatus.FORBIDDEN);

    await request(server)
      .post(`/instructor/tenants/${tenantId}/media/videos/upload-intents`)
      .set('Authorization', `Bearer ${foreignToken}`)
      .send({ title: 'Video' })
      .expect(HttpStatus.FORBIDDEN);

    await expect(prisma.client.videoAsset.count()).resolves.toBe(0);
    expect(videoProvider.createRequests).toEqual([]);
  });

  it('creates no asset when Bunny resource creation fails', async () => {
    const { token, tenantId } = await createInstructorTenant('video-provider-fails');
    videoProvider.failCreate = true;

    await request(server)
      .post(`/instructor/tenants/${tenantId}/media/videos/upload-intents`)
      .set('Authorization', `Bearer ${token}`)
      .send({ title: 'Video' })
      .expect(HttpStatus.BAD_GATEWAY);

    await expect(prisma.client.videoAsset.count()).resolves.toBe(0);
  });

  it('leaves safe FAILED durable state when Bunny TUS signing fails after provider and DB creation', async () => {
    const { token, tenantId } = await createInstructorTenant('video-signing-fails');
    videoProvider.failTusSigning = true;

    await request(server)
      .post(`/instructor/tenants/${tenantId}/media/videos/upload-intents`)
      .set('Authorization', `Bearer ${token}`)
      .send({ title: 'Video' })
      .expect(HttpStatus.BAD_GATEWAY);

    const asset = await prisma.client.videoAsset.findFirstOrThrow();
    expect(asset).toMatchObject({
      tenantId,
      providerKey: '123456',
      externalAssetRef: 'fake-bunny-video-1',
      processingStatus: AssetProcessingStatus.FAILED,
      failureCode: 'VIDEO_UPLOAD_SIGNING_FAILED',
      failureReason: 'VIDEO_UPLOAD_SIGNING_FAILED',
    });
  });

  it('accepts valid Bunny HMAC webhooks and applies monotonic status mapping', async () => {
    const { tenantId, instructorId } = await createInstructorTenant('video-webhook');
    const videoAssetId = await createVideoAssetDirect(tenantId, instructorId);
    await prisma.client.videoAsset.update({
      where: { id: videoAssetId },
      data: { providerKey: '123456', externalAssetRef: 'bunny-guid-1' },
    });

    await postBunnyWebhook({ VideoLibraryId: 123456, VideoGuid: 'bunny-guid-1', Status: 1 }).expect(HttpStatus.OK);
    await expect(prisma.client.videoAsset.findUniqueOrThrow({ where: { id: videoAssetId } })).resolves.toMatchObject({
      processingStatus: AssetProcessingStatus.PROCESSING,
    });

    await postBunnyWebhook({ VideoLibraryId: 123456, VideoGuid: 'bunny-guid-1', Status: 4, Length: 91 }).expect(HttpStatus.OK);
    await expect(prisma.client.videoAsset.findUniqueOrThrow({ where: { id: videoAssetId } })).resolves.toMatchObject({
      processingStatus: AssetProcessingStatus.PROCESSING,
      durationSeconds: null,
    });

    await postBunnyWebhook({ VideoLibraryId: 123456, VideoGuid: 'bunny-guid-1', Status: 3, Length: 91 }).expect(HttpStatus.OK);
    await expect(prisma.client.videoAsset.findUniqueOrThrow({ where: { id: videoAssetId } })).resolves.toMatchObject({
      processingStatus: AssetProcessingStatus.READY,
      durationSeconds: 91,
      failureCode: null,
      failureReason: null,
    });

    await postBunnyWebhook({ VideoLibraryId: 123456, VideoGuid: 'bunny-guid-1', Status: 1 }).expect(HttpStatus.OK);
    await postBunnyWebhook({ VideoLibraryId: 123456, VideoGuid: 'bunny-guid-1', Status: 5 }).expect(HttpStatus.OK);
    await postBunnyWebhook({ VideoLibraryId: 123456, VideoGuid: 'bunny-guid-1', Status: 3, Length: 91 }).expect(HttpStatus.OK);
    await expect(prisma.client.videoAsset.findUniqueOrThrow({ where: { id: videoAssetId } })).resolves.toMatchObject({
      processingStatus: AssetProcessingStatus.READY,
      durationSeconds: 91,
      failureCode: null,
      failureReason: null,
    });
  });

  it('rejects invalid Bunny webhook signatures and raw-body tampering', async () => {
    const payload = { VideoLibraryId: 123456, VideoGuid: 'bunny-guid-1', Status: 3 };
    const raw = JSON.stringify(payload);
    const validSignature = signBunnyWebhook(raw);

    await request(server)
      .post('/provider-webhooks/bunny/stream')
      .set('Content-Type', 'application/json')
      .send(raw)
      .expect(HttpStatus.UNAUTHORIZED);

    await request(server)
      .post('/provider-webhooks/bunny/stream')
      .set('Content-Type', 'application/json')
      .set('X-BunnyStream-Signature-Version', 'v1')
      .set('X-BunnyStream-Signature-Algorithm', 'hmac-sha256')
      .set('X-BunnyStream-Signature', 'not-hex')
      .send(raw)
      .expect(HttpStatus.UNAUTHORIZED);

    await request(server)
      .post('/provider-webhooks/bunny/stream')
      .set('Content-Type', 'application/json')
      .set('X-BunnyStream-Signature-Version', 'v2')
      .set('X-BunnyStream-Signature-Algorithm', 'hmac-sha256')
      .set('X-BunnyStream-Signature', validSignature)
      .send(raw)
      .expect(HttpStatus.UNAUTHORIZED);

    await request(server)
      .post('/provider-webhooks/bunny/stream')
      .set('Content-Type', 'application/json')
      .set('X-BunnyStream-Signature-Version', 'v1')
      .set('X-BunnyStream-Signature-Algorithm', 'hmac-sha1')
      .set('X-BunnyStream-Signature', validSignature)
      .send(raw)
      .expect(HttpStatus.UNAUTHORIZED);

    await request(server)
      .post('/provider-webhooks/bunny/stream')
      .set('Content-Type', 'application/json')
      .set('X-BunnyStream-Signature-Version', 'v1')
      .set('X-BunnyStream-Signature-Algorithm', 'hmac-sha256')
      .set('X-BunnyStream-Signature', signBunnyWebhook(raw).replace(/^./, '0'))
      .send(raw)
      .expect(HttpStatus.UNAUTHORIZED);

    await request(server)
      .post('/provider-webhooks/bunny/stream')
      .set('Content-Type', 'application/json')
      .set('X-BunnyStream-Signature-Version', 'v1')
      .set('X-BunnyStream-Signature-Algorithm', 'hmac-sha256')
      .set('X-BunnyStream-Signature', validSignature)
      .send(JSON.stringify({ ...payload, Status: 5 }))
      .expect(HttpStatus.UNAUTHORIZED);
  });

  it('maps Bunny failure and unknown-provider callbacks safely without cross-library substitution', async () => {
    const { tenantId, instructorId } = await createInstructorTenant('video-webhook-failure');
    const videoAssetId = await createVideoAssetDirect(tenantId, instructorId);
    await prisma.client.videoAsset.update({
      where: { id: videoAssetId },
      data: { providerKey: '123456', externalAssetRef: 'bunny-guid-1' },
    });

    await postBunnyWebhook({ VideoLibraryId: 654321, VideoGuid: 'bunny-guid-1', Status: 3, Length: 20 }).expect(HttpStatus.OK);
    await postBunnyWebhook({ VideoLibraryId: 123456, VideoGuid: 'unknown-guid', Status: 3, Length: 20 }).expect(HttpStatus.OK);
    await expect(prisma.client.videoAsset.findUniqueOrThrow({ where: { id: videoAssetId } })).resolves.toMatchObject({
      processingStatus: AssetProcessingStatus.UPLOADING,
      durationSeconds: null,
    });

    await postBunnyWebhook({ VideoLibraryId: 123456, VideoGuid: 'bunny-guid-1', Status: 5 }).expect(HttpStatus.OK);
    await expect(prisma.client.videoAsset.findUniqueOrThrow({ where: { id: videoAssetId } })).resolves.toMatchObject({
      processingStatus: AssetProcessingStatus.FAILED,
      failureCode: 'BUNNY_STREAM_ENCODING_FAILED',
      failureReason: 'BUNNY_STREAM_ENCODING_FAILED',
    });
  });

  it('concurrent stale and READY Bunny webhooks deterministically converge to READY', async () => {
    const { tenantId, instructorId } = await createInstructorTenant('video-webhook-concurrent');
    const videoAssetId = await createVideoAssetDirect(tenantId, instructorId);
    await prisma.client.videoAsset.update({
      where: { id: videoAssetId },
      data: { providerKey: '123456', externalAssetRef: 'bunny-guid-concurrent' },
    });

    await Promise.all([
      postBunnyWebhook({ VideoLibraryId: 123456, VideoGuid: 'bunny-guid-concurrent', Status: 3, Length: 120 }),
      postBunnyWebhook({ VideoLibraryId: 123456, VideoGuid: 'bunny-guid-concurrent', Status: 1 }),
    ]);

    await expect(prisma.client.videoAsset.findUniqueOrThrow({ where: { id: videoAssetId } })).resolves.toMatchObject({
      processingStatus: AssetProcessingStatus.READY,
      durationSeconds: 120,
    });
  });

  it('creates an authorized direct R2 document upload intent with server-owned asset state and key', async () => {
    const { token, tenantId, instructorId } = await createInstructorTenant('upload-intent');

    const response = await request(server)
      .post(`/instructor/tenants/${tenantId}/media/documents/upload-intents`)
      .set('Authorization', `Bearer ${token}`)
      .send({
        fileName: 'Syllabus Week 1.pdf',
        mimeType: 'application/pdf',
        fileSizeBytes: 2048,
        tenantId: uuid.create(),
        uploadedByUserId: uuid.create(),
        externalAssetRef: 'client-controlled/key',
        processingStatus: AssetProcessingStatus.READY,
      })
      .expect(HttpStatus.BAD_REQUEST);
    expect(response.body).toMatchObject({ error: { code: 'VALIDATION_FAILED' } });

    const ok = await request(server)
      .post(`/instructor/tenants/${tenantId}/media/documents/upload-intents`)
      .set('Authorization', `Bearer ${token}`)
      .send({
        fileName: 'Syllabus Week 1.pdf',
        mimeType: 'application/pdf',
        fileSizeBytes: 2048,
      })
      .expect(HttpStatus.CREATED);

    const body = responseBody<{
      documentAssetId: string;
      uploadUrl: string;
      expiresAt: string;
      headers: Record<string, string>;
    }>(ok);

    expect(body.documentAssetId).toMatch(/^[0-9a-f-]{36}$/);
    expect(body.uploadUrl).toBe(`https://upload.example/${documentStorage.lastUploadObjectKey}?signature=redacted`);
    expect(body.headers).toEqual({ 'Content-Type': 'application/pdf' });
    expect(new Date(body.expiresAt).getTime() - Date.now()).toBeLessThanOrEqual(610_000);
    expect(JSON.stringify(body)).not.toMatch(/externalAssetRef|accessKey|secret|bucket|r2\.cloudflarestorage|client-controlled/i);

    const asset = await prisma.client.documentAsset.findUniqueOrThrow({ where: { id: body.documentAssetId } });
    expect(asset).toMatchObject({
      tenantId,
      uploadedByUserId: instructorId,
      fileName: 'Syllabus Week 1.pdf',
      mimeType: 'application/pdf',
      processingStatus: AssetProcessingStatus.UPLOADING,
    });
    expect(asset.fileSizeBytes).toBe(BigInt(2048));
    expect(asset.externalAssetRef).toBe(`tenants/${tenantId}/document-uploads/${body.documentAssetId}`);
    expect(asset.externalAssetRef).not.toContain('Syllabus');
    expect(documentStorage.uploadRequests).toEqual([
      {
        objectKey: asset.externalAssetRef,
        contentType: 'application/pdf',
        expiresInSeconds: 600,
      },
    ]);
  });

  it('rejects invalid document upload metadata without creating an asset', async () => {
    const { token, tenantId } = await createInstructorTenant('invalid-metadata');

    for (const payload of [
      { fileName: '', mimeType: 'application/pdf', fileSizeBytes: 1024 },
      { fileName: '   ', mimeType: 'application/pdf', fileSizeBytes: 1024 },
      { fileName: 'x'.repeat(256), mimeType: 'application/pdf', fileSizeBytes: 1024 },
      { fileName: 'notes.pdf', mimeType: 'text/html', fileSizeBytes: 1024 },
      { fileName: 'notes.pdf', mimeType: 'application/pdf', fileSizeBytes: 0 },
      { fileName: 'notes.pdf', mimeType: 'application/pdf', fileSizeBytes: 25 * 1024 * 1024 + 1 },
    ]) {
      await request(server)
        .post(`/instructor/tenants/${tenantId}/media/documents/upload-intents`)
        .set('Authorization', `Bearer ${token}`)
        .send(payload)
        .expect(HttpStatus.BAD_REQUEST);
    }

    await expect(prisma.client.documentAsset.count()).resolves.toBe(0);
  });

  it('denies non-instructors and foreign tenants for document upload intents', async () => {
    const { tenantId } = await createInstructorTenant('upload-denied-owner');
    const { token: foreignToken } = await createInstructorTenant('upload-denied-foreign');
    const studentToken = await issueAccessToken(await createUser('upload-denied-student', PlatformRole.STUDENT), PlatformRole.STUDENT);

    const payload = { fileName: 'notes.pdf', mimeType: 'application/pdf', fileSizeBytes: 1024 };

    await request(server)
      .post(`/instructor/tenants/${tenantId}/media/documents/upload-intents`)
      .set('Authorization', `Bearer ${studentToken}`)
      .send(payload)
      .expect(HttpStatus.FORBIDDEN);

    await request(server)
      .post(`/instructor/tenants/${tenantId}/media/documents/upload-intents`)
      .set('Authorization', `Bearer ${foreignToken}`)
      .send(payload)
      .expect(HttpStatus.FORBIDDEN);

    await expect(prisma.client.documentAsset.count()).resolves.toBe(0);
  });

  it('does not create a successful asset state when provider signing fails', async () => {
    const { token, tenantId } = await createInstructorTenant('signing-fails');
    documentStorage.failSigning = true;

    await request(server)
      .post(`/instructor/tenants/${tenantId}/media/documents/upload-intents`)
      .set('Authorization', `Bearer ${token}`)
      .send({ fileName: 'notes.pdf', mimeType: 'application/pdf', fileSizeBytes: 1024 })
      .expect(HttpStatus.INTERNAL_SERVER_ERROR);

    await expect(prisma.client.documentAsset.count()).resolves.toBe(1);
    await expect(prisma.client.documentAsset.findFirstOrThrow()).resolves.toMatchObject({
      processingStatus: AssetProcessingStatus.FAILED,
      failureReason: 'DOCUMENT_UPLOAD_SIGNING_FAILED',
    });
  });

  it('confirms an uploaded R2 document by promoting the verified temporary object to the final READY key', async () => {
    const { token, tenantId } = await createInstructorTenant('confirm-ready');
    const created = await createUploadIntent(token, tenantId, 2048);
    const asset = await prisma.client.documentAsset.findUniqueOrThrow({ where: { id: created.documentAssetId } });
    documentStorage.objects.set(asset.externalAssetRef, {
      exists: true,
      contentLengthBytes: BigInt(2048),
      contentType: 'application/pdf',
    });

    const confirmed = await request(server)
      .post(`/instructor/tenants/${tenantId}/media/documents/${created.documentAssetId}/confirm-upload`)
      .set('Authorization', `Bearer ${token}`)
      .expect(HttpStatus.OK);

    expect(confirmed.body).toMatchObject({
      documentAssetId: created.documentAssetId,
      processingStatus: AssetProcessingStatus.READY,
      fileSizeBytes: '2048',
    });
    expect(JSON.stringify(confirmed.body)).not.toMatch(/externalAssetRef|accessKey|secret|bucket|uploadUrl|signature/i);
    await expect(
      prisma.client.documentAsset.findUniqueOrThrow({ where: { id: created.documentAssetId } }),
    ).resolves.toMatchObject({
      externalAssetRef: `tenants/${tenantId}/documents/${created.documentAssetId}`,
      processingStatus: AssetProcessingStatus.READY,
      failureReason: null,
    });
    expect(documentStorage.objects.has(`tenants/${tenantId}/document-uploads/${created.documentAssetId}`)).toBe(false);
    expect(documentStorage.objects.get(`tenants/${tenantId}/documents/${created.documentAssetId}`)).toEqual({
      exists: true,
      contentLengthBytes: BigInt(2048),
      contentType: 'application/pdf',
    });

    const repeated = await request(server)
      .post(`/instructor/tenants/${tenantId}/media/documents/${created.documentAssetId}/confirm-upload`)
      .set('Authorization', `Bearer ${token}`)
      .expect(HttpStatus.OK);
    expect(repeated.body).toMatchObject({
      documentAssetId: created.documentAssetId,
      processingStatus: AssetProcessingStatus.READY,
    });
  });

  it('keeps READY pointed at the finalized object when the old upload capability overwrites the temporary key', async () => {
    const { token, tenantId } = await createInstructorTenant('old-put-reuse');
    const created = await createUploadIntent(token, tenantId, 1024);
    const temporaryKey = `tenants/${tenantId}/document-uploads/${created.documentAssetId}`;
    const finalKey = `tenants/${tenantId}/documents/${created.documentAssetId}`;
    documentStorage.objects.set(temporaryKey, {
      exists: true,
      contentLengthBytes: BigInt(1024),
      contentType: 'application/pdf',
    });

    await request(server)
      .post(`/instructor/tenants/${tenantId}/media/documents/${created.documentAssetId}/confirm-upload`)
      .set('Authorization', `Bearer ${token}`)
      .expect(HttpStatus.OK);

    const ready = await prisma.client.documentAsset.findUniqueOrThrow({ where: { id: created.documentAssetId } });
    expect(ready).toMatchObject({
      externalAssetRef: finalKey,
      processingStatus: AssetProcessingStatus.READY,
    });
    expect(documentStorage.objects.get(finalKey)).toMatchObject({
      contentLengthBytes: BigInt(1024),
      contentType: 'application/pdf',
    });

    documentStorage.objects.set(temporaryKey, {
      exists: true,
      contentLengthBytes: BigInt(1),
      contentType: 'application/pdf',
    });

    const afterOverwrite = await prisma.client.documentAsset.findUniqueOrThrow({
      where: { id: created.documentAssetId },
    });
    expect(afterOverwrite.externalAssetRef).toBe(finalKey);
    expect(documentStorage.objects.get(afterOverwrite.externalAssetRef)).toMatchObject({
      contentLengthBytes: BigInt(1024),
      contentType: 'application/pdf',
    });
  });

  it('does not mark missing or transient-provider-failure uploads READY', async () => {
    const { token, tenantId } = await createInstructorTenant('confirm-missing');
    const missing = await createUploadIntent(token, tenantId, 1024);

    await request(server)
      .post(`/instructor/tenants/${tenantId}/media/documents/${missing.documentAssetId}/confirm-upload`)
      .set('Authorization', `Bearer ${token}`)
      .expect(HttpStatus.CONFLICT)
      .expect(({ body }) => expect(body).toMatchObject({ error: { code: 'DOCUMENT_UPLOAD_NOT_FOUND' } }));
    await expect(
      prisma.client.documentAsset.findUniqueOrThrow({ where: { id: missing.documentAssetId } }),
    ).resolves.toMatchObject({ processingStatus: AssetProcessingStatus.UPLOADING });

    const transient = await createUploadIntent(token, tenantId, 1024);
    documentStorage.failHead = true;
    await request(server)
      .post(`/instructor/tenants/${tenantId}/media/documents/${transient.documentAssetId}/confirm-upload`)
      .set('Authorization', `Bearer ${token}`)
      .expect(HttpStatus.INTERNAL_SERVER_ERROR);
    await expect(
      prisma.client.documentAsset.findUniqueOrThrow({ where: { id: transient.documentAssetId } }),
    ).resolves.toMatchObject({ processingStatus: AssetProcessingStatus.UPLOADING });
  });

  it('marks definite invalid uploads FAILED without trusting client claims', async () => {
    const { token, tenantId } = await createInstructorTenant('confirm-invalid');
    const created = await createUploadIntent(token, tenantId, 1024);
    const asset = await prisma.client.documentAsset.findUniqueOrThrow({ where: { id: created.documentAssetId } });
    documentStorage.objects.set(asset.externalAssetRef, {
      exists: true,
      contentLengthBytes: BigInt(2048),
      contentType: 'application/pdf',
    });

    await request(server)
      .post(`/instructor/tenants/${tenantId}/media/documents/${created.documentAssetId}/confirm-upload`)
      .set('Authorization', `Bearer ${token}`)
      .send({ succeeded: true, fileSizeBytes: 1024, processingStatus: AssetProcessingStatus.READY })
      .expect(HttpStatus.OK)
      .expect(({ body }) => expect(body).toMatchObject({ processingStatus: AssetProcessingStatus.FAILED }));

    await expect(
      prisma.client.documentAsset.findUniqueOrThrow({ where: { id: created.documentAssetId } }),
    ).resolves.toMatchObject({
      processingStatus: AssetProcessingStatus.FAILED,
      failureReason: 'DOCUMENT_UPLOAD_SIZE_MISMATCH',
    });
  });

  it('marks a definite provider content-type mismatch FAILED and never READY', async () => {
    const { token, tenantId } = await createInstructorTenant('confirm-mime-invalid');
    const created = await createUploadIntent(token, tenantId, 1024);
    const asset = await prisma.client.documentAsset.findUniqueOrThrow({ where: { id: created.documentAssetId } });
    documentStorage.objects.set(asset.externalAssetRef, {
      exists: true,
      contentLengthBytes: BigInt(1024),
      contentType: 'text/html',
    });

    await request(server)
      .post(`/instructor/tenants/${tenantId}/media/documents/${created.documentAssetId}/confirm-upload`)
      .set('Authorization', `Bearer ${token}`)
      .expect(HttpStatus.OK)
      .expect(({ body }) => expect(body).toMatchObject({ processingStatus: AssetProcessingStatus.FAILED }));

    await expect(
      prisma.client.documentAsset.findUniqueOrThrow({ where: { id: created.documentAssetId } }),
    ).resolves.toMatchObject({
      externalAssetRef: asset.externalAssetRef,
      processingStatus: AssetProcessingStatus.FAILED,
      failureReason: 'DOCUMENT_UPLOAD_CONTENT_TYPE_MISMATCH',
    });
    expect(documentStorage.objects.has(`tenants/${tenantId}/documents/${created.documentAssetId}`)).toBe(false);
  });

  it('denies random and cross-tenant confirmation without leaking or regressing state', async () => {
    const owner = await createInstructorTenant('confirm-owner');
    const other = await createInstructorTenant('confirm-other');
    const created = await createUploadIntent(owner.token, owner.tenantId, 1024);

    await request(server)
      .post(`/instructor/tenants/${owner.tenantId}/media/documents/${uuid.create()}/confirm-upload`)
      .set('Authorization', `Bearer ${owner.token}`)
      .expect(HttpStatus.NOT_FOUND)
      .expect(({ body }) => expect(body).toMatchObject({ error: { code: 'DOCUMENT_ASSET_NOT_FOUND' } }));

    await request(server)
      .post(`/instructor/tenants/${other.tenantId}/media/documents/${created.documentAssetId}/confirm-upload`)
      .set('Authorization', `Bearer ${other.token}`)
      .expect(HttpStatus.NOT_FOUND)
      .expect(({ body }) => expect(body).toMatchObject({ error: { code: 'DOCUMENT_ASSET_NOT_FOUND' } }));

    await expect(
      prisma.client.documentAsset.findUniqueOrThrow({ where: { id: created.documentAssetId } }),
    ).resolves.toMatchObject({ processingStatus: AssetProcessingStatus.UPLOADING });
  });

  it('concurrent successful confirmations converge to READY', async () => {
    const { token, tenantId } = await createInstructorTenant('confirm-concurrent');
    const created = await createUploadIntent(token, tenantId, 4096);
    const asset = await prisma.client.documentAsset.findUniqueOrThrow({ where: { id: created.documentAssetId } });
    documentStorage.objects.set(asset.externalAssetRef, {
      exists: true,
      contentLengthBytes: BigInt(4096),
      contentType: 'application/pdf',
    });

    const responses = await Promise.all(
      Array.from({ length: 4 }, () =>
        request(server)
          .post(`/instructor/tenants/${tenantId}/media/documents/${created.documentAssetId}/confirm-upload`)
          .set('Authorization', `Bearer ${token}`),
      ),
    );

    expect(responses.map((response) => response.status)).toEqual([
      HttpStatus.OK,
      HttpStatus.OK,
      HttpStatus.OK,
      HttpStatus.OK,
    ]);
    await expect(
      prisma.client.documentAsset.findUniqueOrThrow({ where: { id: created.documentAssetId } }),
    ).resolves.toMatchObject({
      externalAssetRef: `tenants/${tenantId}/documents/${created.documentAssetId}`,
      processingStatus: AssetProcessingStatus.READY,
    });
  });

  it('does not accept document bytes through NestJS upload-intent routes', async () => {
    const { token, tenantId } = await createInstructorTenant('bytes-not-proxied');

    await request(server)
      .post(`/instructor/tenants/${tenantId}/media/documents/upload-intents`)
      .set('Authorization', `Bearer ${token}`)
      .set('Content-Type', 'application/pdf')
      .send(Buffer.from('%PDF fake body'))
      .expect(HttpStatus.BAD_REQUEST);

    await expect(prisma.client.documentAsset.count()).resolves.toBe(0);
    expect(documentStorage.uploadRequests).toEqual([]);
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

  async function createUploadIntent(
    token: string,
    tenantId: string,
    fileSizeBytes: number,
  ): Promise<{ documentAssetId: string }> {
    const response = await request(server)
      .post(`/instructor/tenants/${tenantId}/media/documents/upload-intents`)
      .set('Authorization', `Bearer ${token}`)
      .send({ fileName: 'notes.pdf', mimeType: 'application/pdf', fileSizeBytes })
      .expect(HttpStatus.CREATED);

    return responseBody<{ documentAssetId: string }>(response);
  }

  function postBunnyWebhook(payload: Record<string, unknown>): request.Test {
    const rawBody = JSON.stringify(payload);
    return request(server)
      .post('/provider-webhooks/bunny/stream')
      .set('Content-Type', 'application/json')
      .set('X-BunnyStream-Signature-Version', 'v1')
      .set('X-BunnyStream-Signature-Algorithm', 'hmac-sha256')
      .set('X-BunnyStream-Signature', signBunnyWebhook(rawBody))
      .send(rawBody);
  }
});

const BUNNY_WEBHOOK_SECRET = 'test-bunny-webhook-secret';

function signBunnyWebhook(rawBody: string): string {
  return createHmac('sha256', BUNNY_WEBHOOK_SECRET).update(Buffer.from(rawBody, 'utf8')).digest('hex');
}

class FakeVideoProvider implements VideoProvider {
  readonly providerKey = '123456';
  readonly createRequests: Array<{ title: string }> = [];
  failCreate = false;
  failTusSigning = false;
  private nextVideoNumber = 1;

  createVideoResource(input: { title: string }): Promise<ProviderVideoResource> {
    if (this.failCreate) {
      return Promise.reject(new VideoProviderCreateFailedError());
    }

    this.createRequests.push(input);
    const videoId = `fake-bunny-video-${this.nextVideoNumber}`;
    this.nextVideoNumber += 1;
    return Promise.resolve({ videoId });
  }

  createTusUploadCapability(input: {
    videoId: string;
    expiresInSeconds: number;
    now: Date;
  }): TusUploadCapability {
    if (this.failTusSigning) {
      throw new Error('test Bunny TUS signing failure');
    }

    return {
      endpoint: 'https://video.bunnycdn.com/tusupload',
      libraryId: this.providerKey,
      videoId: input.videoId,
      expiresAt: new Date(input.now.getTime() + input.expiresInSeconds * 1000),
      headers: {
        AuthorizationSignature: `signature-for-${input.videoId}`,
        AuthorizationExpire: String(input.expiresInSeconds),
        VideoId: input.videoId,
        LibraryId: this.providerKey,
      },
    };
  }

  verifyAndParseWebhook(input: {
    headers: Record<string, string | string[] | undefined>;
    rawBody: Buffer;
  }): BunnyStreamWebhookEvent {
    const version = readHeader(input.headers, 'x-bunnystream-signature-version');
    const algorithm = readHeader(input.headers, 'x-bunnystream-signature-algorithm');
    const signature = readHeader(input.headers, 'x-bunnystream-signature');

    if (version !== 'v1' || algorithm !== 'hmac-sha256' || !/^[0-9a-f]{64}$/.test(signature)) {
      throw new InvalidVideoProviderWebhookError();
    }

    const expected = signBunnyWebhook(input.rawBody.toString('utf8'));
    const actual = Buffer.from(signature, 'hex');
    const expectedBytes = Buffer.from(expected, 'hex');
    if (actual.length !== expectedBytes.length || !timingSafeEqual(actual, expectedBytes)) {
      throw new InvalidVideoProviderWebhookError();
    }

    const payload = JSON.parse(input.rawBody.toString('utf8')) as Record<string, unknown>;
    return {
      libraryId: String(payload.VideoLibraryId),
      videoId: String(payload.VideoGuid),
      status: payload.Status as BunnyStreamWebhookEvent['status'],
      durationSeconds: typeof payload.Length === 'number' ? payload.Length : null,
    };
  }
}

function readHeader(headers: Record<string, string | string[] | undefined>, name: string): string {
  const value = headers[name];
  return Array.isArray(value) ? (value[0] ?? '') : (value ?? '');
}

class FakeDocumentStorageProvider implements DocumentStorageProvider {
  readonly uploadRequests: Array<{ objectKey: string; contentType: string; expiresInSeconds: number }> = [];
  readonly objects = new Map<string, DocumentObjectMetadata>();
  lastUploadObjectKey = '';
  failSigning = false;
  failHead = false;

  createPresignedUpload(input: {
    objectKey: string;
    contentType: string;
    expiresInSeconds: number;
    now: Date;
  }): Promise<PresignedUploadCapability> {
    if (this.failSigning) {
      return Promise.reject(new Error('test signing failure'));
    }

    this.lastUploadObjectKey = input.objectKey;
    this.uploadRequests.push({
      objectKey: input.objectKey,
      contentType: input.contentType,
      expiresInSeconds: input.expiresInSeconds,
    });

    return Promise.resolve({
      uploadUrl: `https://upload.example/${input.objectKey}?signature=redacted`,
      expiresAt: new Date(input.now.getTime() + input.expiresInSeconds * 1000),
      headers: { 'Content-Type': input.contentType },
    });
  }

  headObject(objectKey: string): Promise<DocumentObjectMetadata> {
    if (this.failHead) {
      return Promise.reject(new Error('test transient provider failure'));
    }

    return Promise.resolve(this.objects.get(objectKey) ?? { exists: false });
  }

  promoteObject(input: { sourceObjectKey: string; destinationObjectKey: string }): Promise<void> {
    const source = this.objects.get(input.sourceObjectKey);
    if (!source?.exists) {
      return Promise.reject(new Error('test source object missing'));
    }

    this.objects.set(input.destinationObjectKey, { ...source });
    return Promise.resolve();
  }

  deleteObject(objectKey: string): Promise<void> {
    this.objects.delete(objectKey);
    return Promise.resolve();
  }

  createPresignedDownload(input: {
    objectKey: string;
    expiresInSeconds: number;
    now: Date;
  }): Promise<PresignedDownloadCapability> {
    return Promise.resolve({
      downloadUrl: `https://download.example/${input.objectKey}?signature=redacted`,
      expiresAt: new Date(input.now.getTime() + input.expiresInSeconds * 1000),
    });
  }
}

function responseBody<T>(response: request.Response): T {
  return response.body as T;
}
