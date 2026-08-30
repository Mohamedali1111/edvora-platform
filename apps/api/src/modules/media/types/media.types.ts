import type { AssetProcessingStatus } from '../../../../.generated/prisma/client';

export type VideoAssetSummary = {
  videoAssetId: string;
  tenantId: string;
  uploadedByUserId: string;
  processingStatus: AssetProcessingStatus;
  durationSeconds: number | null;
  createdAt: Date;
  updatedAt: Date;
};

export type DocumentAssetSummary = {
  documentAssetId: string;
  tenantId: string;
  uploadedByUserId: string;
  fileName: string;
  mimeType: string;
  fileSizeBytes: string;
  processingStatus: AssetProcessingStatus;
  createdAt: Date;
  updatedAt: Date;
};
