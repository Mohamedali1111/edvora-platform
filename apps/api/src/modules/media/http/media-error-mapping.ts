import { HttpStatus } from '@nestjs/common';
import { MediaError, type MediaErrorCode } from '../errors/media.errors';

const ERROR_STATUS: Record<MediaErrorCode, HttpStatus> = {
  VIDEO_ASSET_NOT_FOUND: HttpStatus.NOT_FOUND,
  DOCUMENT_ASSET_NOT_FOUND: HttpStatus.NOT_FOUND,
  UNSUPPORTED_DOCUMENT_MIME_TYPE: HttpStatus.BAD_REQUEST,
  DOCUMENT_UPLOAD_NOT_FOUND: HttpStatus.CONFLICT,
  DOCUMENT_UPLOAD_VERIFICATION_FAILED: HttpStatus.BAD_GATEWAY,
};

const ERROR_MESSAGES: Record<MediaErrorCode, string> = {
  VIDEO_ASSET_NOT_FOUND: 'Video asset was not found.',
  DOCUMENT_ASSET_NOT_FOUND: 'Document asset was not found.',
  UNSUPPORTED_DOCUMENT_MIME_TYPE: 'Document MIME type is not supported.',
  DOCUMENT_UPLOAD_NOT_FOUND: 'Document upload was not found.',
  DOCUMENT_UPLOAD_VERIFICATION_FAILED: 'Document upload verification failed.',
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
