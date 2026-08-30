/**
 * Student document access carries safe display metadata plus a short-lived R2 download bearer
 * capability for the already-finalized READY object. It deliberately excludes `documentAssetId`,
 * `tenantId`, `externalAssetRef`, bucket/account/provider configuration, and every other
 * instructor-authoring/provider-internal field.
 */
export type StudentDocumentAccessStatus = {
  lessonId: string;
  fileName: string;
  mimeType: string;
  fileSizeBytes: string;
  downloadUrl: string;
  expiresAt: Date;
};
