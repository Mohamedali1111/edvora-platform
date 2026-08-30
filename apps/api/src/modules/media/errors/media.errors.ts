export type MediaErrorCode = 'VIDEO_ASSET_NOT_FOUND' | 'DOCUMENT_ASSET_NOT_FOUND';

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
