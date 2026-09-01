export type MediaErrorCode =
  | 'VIDEO_ASSET_NOT_FOUND'
  | 'DOCUMENT_ASSET_NOT_FOUND'
  | 'UNSUPPORTED_DOCUMENT_MIME_TYPE'
  | 'DOCUMENT_UPLOAD_NOT_FOUND'
  | 'DOCUMENT_UPLOAD_VERIFICATION_FAILED'
  | 'DOCUMENT_ASSET_STORAGE_INVARIANT_VIOLATION'
  | 'DOCUMENT_UPLOAD_SIGNING_FAILED'
  | 'VIDEO_UPLOAD_SIGNING_FAILED'
  | 'VIDEO_PROVIDER_CREATE_FAILED'
  | 'INVALID_VIDEO_PROVIDER_WEBHOOK'
  | 'VIDEO_ASSET_PROVIDER_INVARIANT_VIOLATION'
  | 'VIDEO_PLAYBACK_SIGNING_FAILED'
  | 'VIDEO_PROVIDER_METADATA_FETCH_FAILED';

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

export class DocumentUploadSigningFailedError extends MediaError {
  constructor() {
    super('DOCUMENT_UPLOAD_SIGNING_FAILED', 'Document upload authorization could not be created.');
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

/**
 * A READY `VideoAsset`'s persisted provider identity (`providerKey`/`externalAssetRef`) does not
 * match what the currently configured video provider expects — e.g. the asset was created against a
 * different Bunny Stream library than the one this API instance is configured for. Rejecting safely
 * here (rather than signing an arbitrary/foreign path) is deliberate: see `docs/MEDIA.md`.
 */
export class VideoAssetProviderInvariantViolationError extends MediaError {
  constructor() {
    super('VIDEO_ASSET_PROVIDER_INVARIANT_VIOLATION', 'Video asset provider identity is invalid.');
  }
}

export class VideoPlaybackSigningFailedError extends MediaError {
  constructor() {
    super('VIDEO_PLAYBACK_SIGNING_FAILED', 'Video playback authorization could not be created.');
  }
}

/**
 * A server-to-server metadata lookup against the provider (used only to hydrate `durationSeconds`
 * when a READY webhook itself did not carry a usable duration — see
 * `MediaAssetService.handleVideoProviderWebhook`) failed outright (network error, non-OK response).
 * This never reaches an HTTP response: it is always caught locally within the webhook handler,
 * which degrades to the existing "unknown duration" behavior rather than letting an enrichment
 * failure block or corrupt the READY transition Bunny's webhook already authoritatively reported.
 * The type/HTTP-status mapping exists only for the `MediaErrorCode` exhaustiveness check below.
 */
export class VideoProviderMetadataFetchFailedError extends MediaError {
  constructor() {
    super('VIDEO_PROVIDER_METADATA_FETCH_FAILED', 'Video provider metadata could not be retrieved.');
  }
}
