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

export type DocumentUploadIntent = {
  documentAssetId: string;
  uploadUrl: string;
  expiresAt: Date;
  headers: Record<string, string>;
};

export type VideoUploadIntent = {
  videoAssetId: string;
  tusEndpoint: string;
  expiresAt: Date;
  headers: Record<string, string>;
  provider: {
    bunnyStream: {
      libraryId: string;
      videoId: string;
    };
  };
};

export type DocumentUploadConfirmation = {
  documentAssetId: string;
  processingStatus: AssetProcessingStatus;
  fileName: string;
  mimeType: string;
  fileSizeBytes: string;
  verifiedAt: Date | null;
};
