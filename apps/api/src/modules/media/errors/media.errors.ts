export type MediaErrorCode =
  | 'VIDEO_ASSET_NOT_FOUND'
  | 'DOCUMENT_ASSET_NOT_FOUND'
  | 'UNSUPPORTED_DOCUMENT_MIME_TYPE'
  | 'DOCUMENT_UPLOAD_NOT_FOUND'
  | 'DOCUMENT_UPLOAD_VERIFICATION_FAILED';

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
