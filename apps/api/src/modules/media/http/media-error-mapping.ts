import { HttpStatus } from '@nestjs/common';
import { MediaError, type MediaErrorCode } from '../errors/media.errors';

const ERROR_STATUS: Record<MediaErrorCode, HttpStatus> = {
  VIDEO_ASSET_NOT_FOUND: HttpStatus.NOT_FOUND,
  DOCUMENT_ASSET_NOT_FOUND: HttpStatus.NOT_FOUND,
};

const ERROR_MESSAGES: Record<MediaErrorCode, string> = {
  VIDEO_ASSET_NOT_FOUND: 'Video asset was not found.',
  DOCUMENT_ASSET_NOT_FOUND: 'Document asset was not found.',
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
