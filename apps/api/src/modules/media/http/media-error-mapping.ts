import { HttpStatus } from '@nestjs/common';
import { MediaError, type MediaErrorCode } from '../errors/media.errors';

const ERROR_STATUS: Record<MediaErrorCode, HttpStatus> = {
  VIDEO_ASSET_NOT_FOUND: HttpStatus.NOT_FOUND,
  DOCUMENT_ASSET_NOT_FOUND: HttpStatus.NOT_FOUND,
  UNSUPPORTED_DOCUMENT_MIME_TYPE: HttpStatus.BAD_REQUEST,
  DOCUMENT_UPLOAD_NOT_FOUND: HttpStatus.CONFLICT,
  DOCUMENT_UPLOAD_VERIFICATION_FAILED: HttpStatus.BAD_GATEWAY,
  DOCUMENT_ASSET_STORAGE_INVARIANT_VIOLATION: HttpStatus.BAD_GATEWAY,
  VIDEO_UPLOAD_SIGNING_FAILED: HttpStatus.BAD_GATEWAY,
  VIDEO_PROVIDER_CREATE_FAILED: HttpStatus.BAD_GATEWAY,
  INVALID_VIDEO_PROVIDER_WEBHOOK: HttpStatus.UNAUTHORIZED,
  VIDEO_ASSET_PROVIDER_INVARIANT_VIOLATION: HttpStatus.BAD_GATEWAY,
  VIDEO_PLAYBACK_SIGNING_FAILED: HttpStatus.BAD_GATEWAY,
};

const ERROR_MESSAGES: Record<MediaErrorCode, string> = {
  VIDEO_ASSET_NOT_FOUND: 'Video asset was not found.',
  DOCUMENT_ASSET_NOT_FOUND: 'Document asset was not found.',
  UNSUPPORTED_DOCUMENT_MIME_TYPE: 'Document MIME type is not supported.',
  DOCUMENT_UPLOAD_NOT_FOUND: 'Document upload was not found.',
  DOCUMENT_UPLOAD_VERIFICATION_FAILED: 'Document upload verification failed.',
  DOCUMENT_ASSET_STORAGE_INVARIANT_VIOLATION: 'Document asset storage state is invalid.',
  VIDEO_UPLOAD_SIGNING_FAILED: 'Video upload authorization could not be created.',
  VIDEO_PROVIDER_CREATE_FAILED: 'Video provider resource could not be created.',
  INVALID_VIDEO_PROVIDER_WEBHOOK: 'Video provider webhook signature is invalid.',
  VIDEO_ASSET_PROVIDER_INVARIANT_VIOLATION: 'Video asset provider identity is invalid.',
  VIDEO_PLAYBACK_SIGNING_FAILED: 'Video playback authorization could not be created.',
};

type ErrorResponseBody = {
  error: {
    code: string;
    message: string;
  };
};

export function mapMediaErrorToHttp(error: MediaError): {
  status: HttpStatus;
  body: ErrorResponseBody;
} {
  return {
    status: ERROR_STATUS[error.code],
    body: {
      error: {
        code: error.code,
        message: ERROR_MESSAGES[error.code],
      },
    },
  };
}
