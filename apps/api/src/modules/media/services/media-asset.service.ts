import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../infrastructure/database/prisma.service';
import type { AuthenticatedPrincipal } from '../../auth/http/authenticated-principal';
import { TenantAuthorizationService } from '../../tenancy/services/tenant-authorization.service';
import { DocumentAssetNotFoundError, VideoAssetNotFoundError } from '../errors/media.errors';
import type { DocumentAssetSummary, VideoAssetSummary } from '../types/media.types';

@Injectable()
export class MediaAssetService {
  constructor(
    private readonly prismaService: PrismaService,
    private readonly authorization: TenantAuthorizationService,
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
