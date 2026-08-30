export type MediaErrorCode =
  | 'VIDEO_ASSET_NOT_FOUND'
  | 'DOCUMENT_ASSET_NOT_FOUND'
  | 'UNSUPPORTED_DOCUMENT_MIME_TYPE'
  | 'DOCUMENT_UPLOAD_NOT_FOUND'
  | 'DOCUMENT_UPLOAD_VERIFICATION_FAILED'
  | 'DOCUMENT_ASSET_STORAGE_INVARIANT_VIOLATION'
  | 'VIDEO_UPLOAD_SIGNING_FAILED'
  | 'VIDEO_PROVIDER_CREATE_FAILED'
  | 'INVALID_VIDEO_PROVIDER_WEBHOOK';

export class MediaError extends Error {
  constructor(
    readonly code: MediaErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'MediaError';
  }
}

export class VideoAssetNotFoundError extends MediaError {
  constructor() {
    super('VIDEO_ASSET_NOT_FOUND', 'Video asset was not found.');
  }
}

export class DocumentAssetNotFoundError extends MediaError {
  constructor() {
    super('DOCUMENT_ASSET_NOT_FOUND', 'Document asset was not found.');
  }
}

export class UnsupportedDocumentMimeTypeError extends MediaError {
  constructor() {
    super('UNSUPPORTED_DOCUMENT_MIME_TYPE', 'Document MIME type is not supported.');
  }
}

export class DocumentUploadNotFoundError extends MediaError {
  constructor() {
    super('DOCUMENT_UPLOAD_NOT_FOUND', 'Document upload was not found.');
  }
}

export class DocumentUploadVerificationFailedError extends MediaError {
  constructor() {
    super('DOCUMENT_UPLOAD_VERIFICATION_FAILED', 'Document upload verification failed.');
  }
}

export class DocumentAssetStorageInvariantViolationError extends MediaError {
  constructor() {
    super('DOCUMENT_ASSET_STORAGE_INVARIANT_VIOLATION', 'Document asset storage state is invalid.');
  }
}

export class VideoUploadSigningFailedError extends MediaError {
  constructor() {
    super('VIDEO_UPLOAD_SIGNING_FAILED', 'Video upload authorization could not be created.');
  }
}

export class VideoProviderCreateFailedError extends MediaError {
  constructor() {
    super('VIDEO_PROVIDER_CREATE_FAILED', 'Video provider resource could not be created.');
  }
}

export class InvalidVideoProviderWebhookError extends MediaError {
  constructor() {
    super('INVALID_VIDEO_PROVIDER_WEBHOOK', 'Video provider webhook signature is invalid.');
  }
}
