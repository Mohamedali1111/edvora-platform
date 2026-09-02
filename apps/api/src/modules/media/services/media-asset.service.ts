import { Inject, Injectable } from '@nestjs/common';
import { AssetProcessingStatus } from '../../../../.generated/prisma/client';
import { PrismaService } from '../../../infrastructure/database/prisma.service';
import { trimToOffsetPage } from '../../../infrastructure/http/pagination';
import type { AuthenticatedPrincipal } from '../../auth/http/authenticated-principal';
import { ClockService } from '../../auth/services/clock.service';
import { UuidV7Service } from '../../auth/services/uuid-v7.service';
import { TenantAuthorizationService } from '../../tenancy/services/tenant-authorization.service';
import {
  DocumentAssetNotFoundError,
  DocumentUploadNotFoundError,
  DocumentUploadSigningFailedError,
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
import type { BunnyStreamWebhookEvent, ProviderVideoMetadata, VideoProvider } from '../video/video.provider';

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
  ): Promise<{ items: VideoAssetSummary[]; hasMore: boolean }> {
    await this.authorization.assertInstructorTenantAccess(principal, tenantId);

    const rows = await this.prismaService.client.videoAsset.findMany({
      where: { tenantId },
      take: limit + 1,
      skip: offset,
      orderBy: [{ createdAt: 'desc' }, { id: 'asc' }],
    });
    const { items, hasMore } = trimToOffsetPage(rows, limit);

    return { items: items.map(toVideoAssetSummary), hasMore };
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
  ): Promise<{ items: DocumentAssetSummary[]; hasMore: boolean }> {
    await this.authorization.assertInstructorTenantAccess(principal, tenantId);

    const rows = await this.prismaService.client.documentAsset.findMany({
      where: { tenantId },
      take: limit + 1,
      skip: offset,
      orderBy: [{ createdAt: 'desc' }, { id: 'asc' }],
    });
    const { items, hasMore } = trimToOffsetPage(rows, limit);

    return { items: items.map(toDocumentAssetSummary), hasMore };
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
    } catch {
      // Mirrors `createVideoUploadIntent`'s signing-failure handling exactly: the asset moves to
      // FAILED so a client can never be misled into holding an upload capability that was never
      // actually issued, and the original provider error is not re-thrown as-is — a typed,
      // documented `MediaError` is thrown instead so this failure mode gets the same stable error
      // code/HTTP status (502) as every other provider-capability-signing failure in this module,
      // rather than falling through to a generic, unmapped `INTERNAL_SERVER_ERROR`.
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
      throw new DocumentUploadSigningFailedError();
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
      // Bunny status 4 ("a resolution finished") is the one PROCESSING-mapped status that can also
      // mean "genuinely, fully done" — see `tryPromoteResolutionFinishedToReady`'s doc comment for
      // the real-provider evidence. Every other PROCESSING-mapped status (1, 2, 7) falls straight
      // through to the plain update below, unchanged.
      if (event.status === 4 && (await this.tryPromoteResolutionFinishedToReady(event))) {
        return;
      }

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
      const durationSeconds = await this.resolveReadyDurationSeconds(event);

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
          durationSeconds,
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

  /**
   * A real Bunny READY webhook cannot be assumed to carry a usable `Length` — proven directly
   * against the real Bunny library (see `docs/MEDIA.md`). When the webhook's own duration is
   * missing/invalid, this makes one authoritative server-to-server metadata lookup — through the
   * provider adapter, using its own configured library identity, never a raw value taken verbatim
   * from the webhook body — so `StudentVideoAccessService`'s duration-aware playback TTL can engage
   * instead of permanently falling back to its 7200-second "unknown duration" TTL.
   *
   * Only fires when a currently-eligible row actually exists for this event's identity: a webhook
   * whose `(libraryId, videoId)` does not match any tracked asset (unknown video, foreign library)
   * must never trigger an outbound Bunny API call. This pre-check is purely an efficiency/hygiene
   * guard, not a correctness dependency — the caller's own `updateMany` `where` clause remains the
   * single source of truth for whether the READY transition actually applies, so a race between this
   * read and that write (e.g. a duplicate concurrent READY webhook) can only make this lookup
   * redundant, never unsafe: the loser's write simply matches zero rows, exactly as it already does
   * today for an already-READY asset.
   *
   * A metadata-fetch failure (network error, non-OK response, or Bunny still reporting no duration)
   * is deliberately swallowed here rather than propagated: Bunny's webhook already authoritatively
   * reported READY, and failing to enrich the duration is a soft degradation — not a reason to
   * withhold, delay, or corrupt the state transition Bunny told us already happened. This is exactly
   * the pre-existing behavior whenever a webhook simply omitted `Length` (silently accepted as
   * `null`), so a fetch failure is not a regression — only a missed best-effort improvement.
   */
  private async resolveReadyDurationSeconds(event: BunnyStreamWebhookEvent): Promise<number | null> {
    if (isValidDurationSeconds(event.durationSeconds)) {
      return event.durationSeconds;
    }

    const eligible = await this.prismaService.client.videoAsset.findFirst({
      where: {
        providerKey: event.libraryId,
        externalAssetRef: event.videoId,
        processingStatus: {
          in: [AssetProcessingStatus.UPLOADING, AssetProcessingStatus.PROCESSING, AssetProcessingStatus.FAILED],
        },
      },
      select: { id: true },
    });

    if (!eligible) {
      return null;
    }

    try {
      const metadata = await this.videoProvider.fetchVideoMetadata({ videoId: event.videoId });
      return isValidDurationSeconds(metadata.durationSeconds) ? metadata.durationSeconds : null;
    } catch {
      return null;
    }
  }

  /**
   * Bunny webhook status 4 ("a resolution finished") fires the first time as soon as a SINGLE
   * resolution finishes — long before the whole encode is done (see `docs/MEDIA.md`) — and real-
   * provider QA proved this specific Bunny library can permanently remain at status 4 and never emit
   * status 3 ("Finished") at all, even once every resolution has genuinely, fully completed. So
   * status 4 alone must never promote to READY; this re-verifies Bunny's *current* full state via one
   * authoritative Get Video call (`isResolutionFinishedGenuinelyComplete`) and only promotes when
   * that strict predicate holds.
   *
   * Mirrors `resolveReadyDurationSeconds`'s existing eligibility-gate pattern exactly: the metadata
   * fetch is skipped entirely (no network call) unless a currently-eligible row exists for this
   * event's identity — this is what keeps an already-READY asset from ever being re-fetched or
   * regressed by a later/duplicate status-4 webhook, and keeps an unknown/foreign identity from
   * triggering a fetch at all, exactly like the READY path already guarantees.
   *
   * Returns `true` only when this call itself performed the READY transition — the caller then skips
   * its own plain PROCESSING update for this same webhook. Returns `false` for every other outcome
   * (ineligible row, predicate not met, race lost to a concurrent update, or the metadata fetch
   * itself failed) so the caller falls through to the existing, unchanged PROCESSING handling —
   * exactly the same "soft enrichment failure never corrupts state" philosophy
   * `resolveReadyDurationSeconds` already uses.
   */
  private async tryPromoteResolutionFinishedToReady(event: BunnyStreamWebhookEvent): Promise<boolean> {
    const eligible = await this.prismaService.client.videoAsset.findFirst({
      where: {
        providerKey: event.libraryId,
        externalAssetRef: event.videoId,
        processingStatus: {
          in: [AssetProcessingStatus.UPLOADING, AssetProcessingStatus.PROCESSING, AssetProcessingStatus.FAILED],
        },
      },
      select: { id: true },
    });

    if (!eligible) {
      return false;
    }

    let metadata: ProviderVideoMetadata;

    try {
      metadata = await this.videoProvider.fetchVideoMetadata({ videoId: event.videoId });
    } catch {
      return false;
    }

    if (!isResolutionFinishedGenuinelyComplete(metadata)) {
      return false;
    }

    const updated = await this.prismaService.client.videoAsset.updateMany({
      where: {
        providerKey: event.libraryId,
        externalAssetRef: event.videoId,
        processingStatus: {
          in: [AssetProcessingStatus.UPLOADING, AssetProcessingStatus.PROCESSING, AssetProcessingStatus.FAILED],
        },
      },
      data: {
        processingStatus: AssetProcessingStatus.READY,
        durationSeconds: metadata.durationSeconds,
        failureCode: null,
        failureReason: null,
      },
    });

    return updated.count > 0;
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

// Mirrors `StudentVideoAccessService.computePlaybackTtlSeconds`'s own definition of "usable
// duration" exactly (a non-positive value is treated as unknown there too, e.g. Bunny's `0` before
// encoding has measured anything) — reused here so a duration this service persists and the TTL
// logic that later reads it agree on the same validity rule.
function isValidDurationSeconds(value: number | null): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0;
}

/**
 * The strict, real-provider-informed readiness check for a Bunny webhook status-4 ("a resolution
 * finished") event — see `MediaAssetService.tryPromoteResolutionFinishedToReady`'s doc comment for
 * why status 4 alone is not trustworthy (real-provider QA proved a genuinely, fully-encoded video in
 * this Bunny library can permanently remain at status 4 and never reach status 3). Every condition
 * below must hold; any missing/unknown/failing field fails safe — the asset stays PROCESSING, never
 * promotes. Exported for direct, DB-free unit testing (see media-asset.service.spec.ts).
 *
 * Deliberately does NOT require a specific hardcoded set/count of `availableResolutions` — only
 * non-emptiness — since instructor/library encoding settings can vary; `encodeProgress === 100`
 * (Bunny's own overall-completion signal, not a per-resolution one) is what actually proves every
 * targeted resolution is done, not the resolution list's size.
 */
export function isResolutionFinishedGenuinelyComplete(metadata: ProviderVideoMetadata): boolean {
  return (
    metadata.status === 4 &&
    metadata.encodeProgress === 100 &&
    isValidDurationSeconds(metadata.durationSeconds) &&
    Array.isArray(metadata.availableResolutions) &&
    metadata.availableResolutions.length > 0 &&
    metadata.hasFailureIndication !== true
  );
}

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
