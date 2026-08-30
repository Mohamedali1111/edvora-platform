export type PresignedUploadCapability = {
  uploadUrl: string;
  expiresAt: Date;
  headers: Record<string, string>;
};

export type DocumentObjectMetadata = {
  exists: boolean;
  contentLengthBytes?: bigint;
  contentType?: string;
};

export interface DocumentStorageProvider {
  createPresignedUpload(input: {
    objectKey: string;
    contentType: string;
    expiresInSeconds: number;
    now: Date;
  }): Promise<PresignedUploadCapability>;

  headObject(objectKey: string): Promise<DocumentObjectMetadata>;

  promoteObject(input: { sourceObjectKey: string; destinationObjectKey: string }): Promise<void>;

  deleteObject(objectKey: string): Promise<void>;
}
