import { Inject, Injectable } from '@nestjs/common';
import { AssetProcessingStatus } from '../../../../.generated/prisma/client';
import { PrismaService } from '../../../infrastructure/database/prisma.service';
import type { AuthenticatedPrincipal } from '../../auth/http/authenticated-principal';
import { ClockService } from '../../auth/services/clock.service';
import { UuidV7Service } from '../../auth/services/uuid-v7.service';
import { TenantAuthorizationService } from '../../tenancy/services/tenant-authorization.service';
import {
  DocumentAssetNotFoundError,
  DocumentUploadNotFoundError,
  DocumentUploadVerificationFailedError,
  UnsupportedDocumentMimeTypeError,
  VideoUploadSigningFailedError,
  VideoAssetNotFoundError,
} from '../errors/media.errors';
import { DOCUMENT_STORAGE_PROVIDER, MEDIA_RUNTIME_CONFIG, VIDEO_PROVIDER } from '../media.constants';
import type { MediaRuntimeConfig } from '../media.config';
import {
  DOCUMENT_UPLOAD_ALLOWED_MIME_TYPES,
  type CreateDocumentUploadIntentDto,
} from '../dto/document-upload.dto';
import type { CreateVideoUploadIntentDto } from '../dto/video-upload.dto';
import type { DocumentStorageProvider } from '../storage/document-storage.provider';
import type {
  DocumentAssetSummary,
  DocumentUploadConfirmation,
  DocumentUploadIntent,
  VideoAssetSummary,
  VideoUploadIntent,
} from '../types/media.types';
import type { BunnyStreamWebhookEvent, VideoProvider } from '../video/video.provider';

@Injectable()
export class MediaAssetService {
  constructor(
    private readonly prismaService: PrismaService,
    private readonly authorization: TenantAuthorizationService,
    private readonly uuid: UuidV7Service,
    private readonly clock: ClockService,
    @Inject(MEDIA_RUNTIME_CONFIG) private readonly mediaConfig: MediaRuntimeConfig,
    @Inject(DOCUMENT_STORAGE_PROVIDER) private readonly documentStorage: DocumentStorageProvider,
    @Inject(VIDEO_PROVIDER) private readonly videoProvider: VideoProvider,
  ) {}

  async listVideoAssets(
    principal: AuthenticatedPrincipal,
    tenantId: string,
    limit: number,
    offset: number,
  ): Promise<VideoAssetSummary[]> {
    await this.authorization.assertInstructorTenantAccess(principal, tenantId);

    const assets = await this.prismaService.client.videoAsset.findMany({
      where: { tenantId },
      take: limit,
      skip: offset,
      orderBy: [{ createdAt: 'desc' }, { id: 'asc' }],
    });

    return assets.map(toVideoAssetSummary);
  }

  async getVideoAsset(
    principal: AuthenticatedPrincipal,
    tenantId: string,
    videoAssetId: string,
  ): Promise<VideoAssetSummary> {
    await this.authorization.assertInstructorTenantAccess(principal, tenantId);

    const asset = await this.prismaService.client.videoAsset.findUnique({
      where: { id_tenantId: { id: videoAssetId, tenantId } },
    });

    if (!asset) {
      throw new VideoAssetNotFoundError();
    }

    return toVideoAssetSummary(asset);
  }

  async listDocumentAssets(
    principal: AuthenticatedPrincipal,
    tenantId: string,
    limit: number,
    offset: number,
  ): Promise<DocumentAssetSummary[]> {
    await this.authorization.assertInstructorTenantAccess(principal, tenantId);

    const assets = await this.prismaService.client.documentAsset.findMany({
      where: { tenantId },
      take: limit,
      skip: offset,
      orderBy: [{ createdAt: 'desc' }, { id: 'asc' }],
    });

    return assets.map(toDocumentAssetSummary);
  }

  async getDocumentAsset(
    principal: AuthenticatedPrincipal,
    tenantId: string,
    documentAssetId: string,
  ): Promise<DocumentAssetSummary> {
    await this.authorization.assertInstructorTenantAccess(principal, tenantId);

    const asset = await this.prismaService.client.documentAsset.findUnique({
      where: { id_tenantId: { id: documentAssetId, tenantId } },
    });

    if (!asset) {
      throw new DocumentAssetNotFoundError();
    }

    return toDocumentAssetSummary(asset);
  }

  async createDocumentUploadIntent(
    principal: AuthenticatedPrincipal,
    tenantId: string,
    input: CreateDocumentUploadIntentDto,
  ): Promise<DocumentUploadIntent> {
    await this.authorization.assertInstructorTenantAccess(principal, tenantId);
    assertSupportedDocumentMimeType(input.mimeType);

    const documentAssetId = this.uuid.create();
    const temporaryObjectKey = temporaryDocumentObjectKey(tenantId, documentAssetId);
    const now = this.clock.now();

    await this.prismaService.client.documentAsset.create({
      data: {
        id: documentAssetId,
        tenantId,
        uploadedByUserId: principal.userId,
        externalAssetRef: temporaryObjectKey,
        fileName: input.fileName.trim(),
        mimeType: input.mimeType,
        fileSizeBytes: BigInt(input.fileSizeBytes),
        processingStatus: AssetProcessingStatus.UPLOADING,
      },
    });

    let capability: Awaited<ReturnType<DocumentStorageProvider['createPresignedUpload']>>;

    try {
      capability = await this.documentStorage.createPresignedUpload({
        objectKey: temporaryObjectKey,
        contentType: input.mimeType,
        expiresInSeconds: this.mediaConfig.documents.r2.uploadUrlTtlSeconds,
        now,
      });
    } catch (error) {
      await this.prismaService.client.documentAsset.updateMany({
        where: {
          id: documentAssetId,
          tenantId,
          processingStatus: AssetProcessingStatus.UPLOADING,
          externalAssetRef: temporaryObjectKey,
        },
        data: {
          processingStatus: AssetProcessingStatus.FAILED,
          failureReason: 'DOCUMENT_UPLOAD_SIGNING_FAILED',
        },
      });
      throw error;
    }

    return {
      documentAssetId,
      uploadUrl: capability.uploadUrl,
      expiresAt: capability.expiresAt,
      headers: capability.headers,
    };
  }

  async createVideoUploadIntent(
    principal: AuthenticatedPrincipal,
    tenantId: string,
    input: CreateVideoUploadIntentDto,
  ): Promise<VideoUploadIntent> {
    await this.authorization.assertInstructorTenantAccess(principal, tenantId);

    const videoAssetId = this.uuid.create();
    const providerResource = await this.videoProvider.createVideoResource({ title: input.title.trim() });
    const now = this.clock.now();

    await this.prismaService.client.videoAsset.create({
      data: {
        id: videoAssetId,
        tenantId,
        uploadedByUserId: principal.userId,
        providerKey: this.videoProvider.providerKey,
        externalAssetRef: providerResource.videoId,
        processingStatus: AssetProcessingStatus.UPLOADING,
      },
    });

    try {
      const capability = this.videoProvider.createTusUploadCapability({
        videoId: providerResource.videoId,
        expiresInSeconds: this.mediaConfig.video.bunnyStream.tusAuthorizationTtlSeconds,
        now,
      });

      return {
        videoAssetId,
        tusEndpoint: capability.endpoint,
        expiresAt: capability.expiresAt,
        headers: capability.headers,
        provider: {
          bunnyStream: {
            libraryId: capability.libraryId,
            videoId: capability.videoId,
          },
        },
      };
    } catch {
      await this.prismaService.client.videoAsset.updateMany({
        where: {
          id: videoAssetId,
          tenantId,
          externalAssetRef: providerResource.videoId,
          processingStatus: AssetProcessingStatus.UPLOADING,
        },
        data: {
          processingStatus: AssetProcessingStatus.FAILED,
          failureCode: 'VIDEO_UPLOAD_SIGNING_FAILED',
          failureReason: 'VIDEO_UPLOAD_SIGNING_FAILED',
        },
      });
      throw new VideoUploadSigningFailedError();
    }
  }

  async handleVideoProviderWebhook(event: BunnyStreamWebhookEvent): Promise<void> {
    const next = mapBunnyStatusToAssetUpdate(event);

    if (next.kind === 'ignore') {
      return;
    }

    if (next.status === AssetProcessingStatus.UPLOADING) {
      await this.prismaService.client.videoAsset.updateMany({
        where: {
          providerKey: event.libraryId,
          externalAssetRef: event.videoId,
          processingStatus: AssetProcessingStatus.UPLOADING,
        },
        data: { processingStatus: AssetProcessingStatus.UPLOADING },
      });
      return;
    }

    if (next.status === AssetProcessingStatus.PROCESSING) {
      await this.prismaService.client.videoAsset.updateMany({
        where: {
          providerKey: event.libraryId,
          externalAssetRef: event.videoId,
          processingStatus: { in: [AssetProcessingStatus.UPLOADING, AssetProcessingStatus.PROCESSING] },
        },
        data: { processingStatus: AssetProcessingStatus.PROCESSING },
      });
      return;
    }

    if (next.status === AssetProcessingStatus.READY) {
      await this.prismaService.client.videoAsset.updateMany({
        where: {
          providerKey: event.libraryId,
          externalAssetRef: event.videoId,
          processingStatus: {
            in: [AssetProcessingStatus.UPLOADING, AssetProcessingStatus.PROCESSING, AssetProcessingStatus.FAILED],
          },
        },
        data: {
          processingStatus: AssetProcessingStatus.READY,
          durationSeconds: event.durationSeconds,
          failureCode: null,
          failureReason: null,
        },
      });
      return;
    }

    if (next.status === AssetProcessingStatus.FAILED) {
      await this.prismaService.client.videoAsset.updateMany({
        where: {
          providerKey: event.libraryId,
          externalAssetRef: event.videoId,
          processingStatus: { in: [AssetProcessingStatus.UPLOADING, AssetProcessingStatus.PROCESSING] },
        },
        data: {
          processingStatus: AssetProcessingStatus.FAILED,
          failureCode: next.failureCode,
          failureReason: next.failureReason,
        },
      });
    }
  }

  async confirmDocumentUpload(
    principal: AuthenticatedPrincipal,
    tenantId: string,
    documentAssetId: string,
  ): Promise<DocumentUploadConfirmation> {
    await this.authorization.assertInstructorTenantAccess(principal, tenantId);

    const asset = await this.prismaService.client.documentAsset.findUnique({
      where: { id_tenantId: { id: documentAssetId, tenantId } },
      select: {
        id: true,
        externalAssetRef: true,
        fileName: true,
        mimeType: true,
        fileSizeBytes: true,
        processingStatus: true,
      },
    });

    if (!asset) {
      throw new DocumentAssetNotFoundError();
    }

    if (asset.processingStatus === AssetProcessingStatus.READY) {
      return toDocumentUploadConfirmation(asset, null);
    }

    if (asset.processingStatus !== AssetProcessingStatus.UPLOADING) {
      throw new DocumentUploadNotFoundError();
    }

    const temporaryObjectKey = temporaryDocumentObjectKey(tenantId, documentAssetId);
    const finalObjectKey = finalDocumentObjectKey(tenantId, documentAssetId);

    const metadata = await this.documentStorage.headObject(asset.externalAssetRef);

    if (!metadata.exists) {
      const current = await this.readDocumentConfirmationRow(tenantId, documentAssetId);
      if (current?.processingStatus === AssetProcessingStatus.READY) {
        return toDocumentUploadConfirmation(current, null);
      }
      throw new DocumentUploadNotFoundError();
    }

    const sizeMatches = metadata.contentLengthBytes === asset.fileSizeBytes;
    const contentTypeMatches = !metadata.contentType || metadata.contentType === asset.mimeType;

    if (!sizeMatches || !contentTypeMatches) {
      await this.prismaService.client.documentAsset.updateMany({
        where: {
          id: documentAssetId,
          tenantId,
          processingStatus: AssetProcessingStatus.UPLOADING,
        },
        data: {
          processingStatus: AssetProcessingStatus.FAILED,
          failureReason: !sizeMatches ? 'DOCUMENT_UPLOAD_SIZE_MISMATCH' : 'DOCUMENT_UPLOAD_CONTENT_TYPE_MISMATCH',
        },
      });

      const current = await this.prismaService.client.documentAsset.findUniqueOrThrow({
        where: { id_tenantId: { id: documentAssetId, tenantId } },
        select: {
          id: true,
          fileName: true,
          mimeType: true,
          fileSizeBytes: true,
          processingStatus: true,
        },
      });

      return toDocumentUploadConfirmation(current, null);
    }

    try {
      await this.documentStorage.promoteObject({
        sourceObjectKey: temporaryObjectKey,
        destinationObjectKey: finalObjectKey,
      });
    } catch (error) {
      const current = await this.readDocumentConfirmationRow(tenantId, documentAssetId);
      if (current?.processingStatus === AssetProcessingStatus.READY) {
        return toDocumentUploadConfirmation(current, null);
      }
      throw error;
    }

    const finalMetadata = await this.documentStorage.headObject(finalObjectKey);
    const finalSizeMatches = finalMetadata.exists && finalMetadata.contentLengthBytes === asset.fileSizeBytes;
    const finalContentTypeMatches = !finalMetadata.contentType || finalMetadata.contentType === asset.mimeType;

    if (!finalSizeMatches || !finalContentTypeMatches) {
      const current = await this.readDocumentConfirmationRow(tenantId, documentAssetId);
      if (current?.processingStatus === AssetProcessingStatus.READY) {
        return toDocumentUploadConfirmation(current, null);
      }
      throw new DocumentUploadVerificationFailedError();
    }

    const verifiedAt = this.clock.now();
    const updated = await this.prismaService.client.documentAsset.updateMany({
      where: {
        id: documentAssetId,
        tenantId,
        processingStatus: AssetProcessingStatus.UPLOADING,
        externalAssetRef: temporaryObjectKey,
      },
      data: {
        externalAssetRef: finalObjectKey,
        processingStatus: AssetProcessingStatus.READY,
        failureReason: null,
      },
    });

    if (updated.count === 0) {
      const current = await this.prismaService.client.documentAsset.findUnique({
        where: { id_tenantId: { id: documentAssetId, tenantId } },
        select: {
          id: true,
          fileName: true,
          mimeType: true,
          fileSizeBytes: true,
          processingStatus: true,
        },
      });

      if (current?.processingStatus === AssetProcessingStatus.READY) {
        return toDocumentUploadConfirmation(current, verifiedAt);
      }

      throw new DocumentUploadVerificationFailedError();
    }

    const ready = await this.prismaService.client.documentAsset.findUniqueOrThrow({
      where: { id_tenantId: { id: documentAssetId, tenantId } },
      select: {
        id: true,
        fileName: true,
        mimeType: true,
        fileSizeBytes: true,
        processingStatus: true,
      },
    });

    await this.tryDeleteTemporaryObjectIfStillSafe(ready, temporaryObjectKey);

    return toDocumentUploadConfirmation(ready, verifiedAt);
  }

  private async readDocumentConfirmationRow(
    tenantId: string,
    documentAssetId: string,
  ): Promise<{
    id: string;
    fileName: string;
    mimeType: string;
    fileSizeBytes: bigint;
    processingStatus: DocumentUploadConfirmation['processingStatus'];
  } | null> {
    return this.prismaService.client.documentAsset.findUnique({
      where: { id_tenantId: { id: documentAssetId, tenantId } },
      select: {
        id: true,
        fileName: true,
        mimeType: true,
        fileSizeBytes: true,
        processingStatus: true,
      },
    });
  }

  private async tryDeleteTemporaryObjectIfStillSafe(
    ready: {
      id: string;
      processingStatus: DocumentUploadConfirmation['processingStatus'];
    },
    temporaryObjectKey: string,
  ): Promise<void> {
    if (ready.processingStatus !== AssetProcessingStatus.READY) {
      return;
    }

    try {
      await this.documentStorage.deleteObject(temporaryObjectKey);
    } catch {
      // Cleanup is deliberately best-effort after the final object and DB READY state exist. A
      // stale temporary object may still be overwritten by the old bearer PUT, but READY points at
      // the separate final key, so the finalized asset cannot be mutated by that capability.
    }
  }
}

type VideoAssetUpdate =
  | { kind: 'ignore' }
  | {
      kind: 'update';
      status:
        | typeof AssetProcessingStatus.UPLOADING
        | typeof AssetProcessingStatus.PROCESSING
        | typeof AssetProcessingStatus.READY;
    }
  | {
      kind: 'update';
      status: typeof AssetProcessingStatus.FAILED;
      failureCode: string;
      failureReason: string;
    };

function mapBunnyStatusToAssetUpdate(event: BunnyStreamWebhookEvent): VideoAssetUpdate {
  switch (event.status) {
    case 0:
    case 6:
      return { kind: 'update', status: AssetProcessingStatus.UPLOADING };
    case 1:
    case 2:
    case 4:
    case 7:
      return { kind: 'update', status: AssetProcessingStatus.PROCESSING };
    case 3:
      return { kind: 'update', status: AssetProcessingStatus.READY };
    case 5:
      return {
        kind: 'update',
        status: AssetProcessingStatus.FAILED,
        failureCode: 'BUNNY_STREAM_ENCODING_FAILED',
        failureReason: 'BUNNY_STREAM_ENCODING_FAILED',
      };
    case 8:
      return {
        kind: 'update',
        status: AssetProcessingStatus.FAILED,
        failureCode: 'BUNNY_STREAM_PRESIGNED_UPLOAD_FAILED',
        failureReason: 'BUNNY_STREAM_PRESIGNED_UPLOAD_FAILED',
      };
    case 9:
    case 10:
      return { kind: 'ignore' };
  }
}

function toVideoAssetSummary(row: {
  id: string;
  tenantId: string;
  uploadedByUserId: string;
  processingStatus: VideoAssetSummary['processingStatus'];
  durationSeconds: number | null;
  createdAt: Date;
  updatedAt: Date;
}): VideoAssetSummary {
  return {
    videoAssetId: row.id,
    tenantId: row.tenantId,
    uploadedByUserId: row.uploadedByUserId,
    processingStatus: row.processingStatus,
    durationSeconds: row.durationSeconds,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function toDocumentAssetSummary(row: {
  id: string;
  tenantId: string;
  uploadedByUserId: string;
  fileName: string;
  mimeType: string;
  fileSizeBytes: bigint;
  processingStatus: DocumentAssetSummary['processingStatus'];
  createdAt: Date;
  updatedAt: Date;
}): DocumentAssetSummary {
  return {
    documentAssetId: row.id,
    tenantId: row.tenantId,
    uploadedByUserId: row.uploadedByUserId,
    fileName: row.fileName,
    mimeType: row.mimeType,
    fileSizeBytes: row.fileSizeBytes.toString(),
    processingStatus: row.processingStatus,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function assertSupportedDocumentMimeType(mimeType: string): void {
  if (!DOCUMENT_UPLOAD_ALLOWED_MIME_TYPES.includes(mimeType as (typeof DOCUMENT_UPLOAD_ALLOWED_MIME_TYPES)[number])) {
    throw new UnsupportedDocumentMimeTypeError();
  }
}

function temporaryDocumentObjectKey(tenantId: string, documentAssetId: string): string {
  return `tenants/${tenantId}/document-uploads/${documentAssetId}`;
}

function finalDocumentObjectKey(tenantId: string, documentAssetId: string): string {
  return `tenants/${tenantId}/documents/${documentAssetId}`;
}

function toDocumentUploadConfirmation(
  row: {
    id: string;
    fileName: string;
    mimeType: string;
    fileSizeBytes: bigint;
    processingStatus: DocumentUploadConfirmation['processingStatus'];
  },
  verifiedAt: Date | null,
): DocumentUploadConfirmation {
  return {
    documentAssetId: row.id,
    processingStatus: row.processingStatus,
    fileName: row.fileName,
    mimeType: row.mimeType,
    fileSizeBytes: row.fileSizeBytes.toString(),
    verifiedAt,
  };
}
