import {
  ArgumentsHost,
  BadRequestException,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
} from '@nestjs/common';
import type { Response } from 'express';
import { ThrottlerException } from '@nestjs/throttler';
import { AuthError } from '../../modules/auth/errors/auth.errors';
import { mapAuthErrorToHttp } from '../../modules/auth/http/auth-error-mapping';
import { CourseError } from '../../modules/courses/errors/course.errors';
import { mapCourseErrorToHttp } from '../../modules/courses/http/course-error-mapping';
import { DeviceError } from '../../modules/devices/errors/device.errors';
import { mapDeviceErrorToHttp } from '../../modules/devices/http/device-error-mapping';
import { MediaError } from '../../modules/media/errors/media.errors';
import { mapMediaErrorToHttp } from '../../modules/media/http/media-error-mapping';
import { QuizError } from '../../modules/quizzes/errors/quiz.errors';
import { mapQuizErrorToHttp } from '../../modules/quizzes/http/quiz-error-mapping';
import { TenancyError } from '../../modules/tenancy/errors/tenancy.errors';
import { mapTenancyErrorToHttp } from '../../modules/tenancy/http/tenancy-error-mapping';

type ErrorResponseBody = {
  error: {
    code: string;
    message: string;
  };
};

@Catch()
export class ApiExceptionFilter implements ExceptionFilter {
  catch(exception: unknown, host: ArgumentsHost): void {
    const response = host.switchToHttp().getResponse<Response>();
    const { status, body } = mapException(exception);

    response.status(status).json(body);
  }
}

function mapException(exception: unknown): { status: number; body: ErrorResponseBody } {
  if (exception instanceof AuthError) {
    return mapAuthErrorToHttp(exception);
  }

  if (exception instanceof DeviceError) {
    return mapDeviceErrorToHttp(exception);
  }

  if (exception instanceof CourseError) {
    return mapCourseErrorToHttp(exception);
  }

  if (exception instanceof QuizError) {
    return mapQuizErrorToHttp(exception);
  }

  if (exception instanceof MediaError) {
    return mapMediaErrorToHttp(exception);
  }

  if (exception instanceof TenancyError) {
    return mapTenancyErrorToHttp(exception);
  }

  if (exception instanceof ThrottlerException) {
    return {
      status: HttpStatus.TOO_MANY_REQUESTS,
      body: {
        error: {
          code: 'RATE_LIMITED',
          message: 'Too many requests.',
        },
      },
    };
  }

  if (exception instanceof BadRequestException) {
    const responseBody = exception.getResponse();
    const explicitError = extractExplicitError(responseBody);

    if (explicitError) {
      return {
        status: exception.getStatus(),
        body: explicitError,
      };
    }

    return {
      status: exception.getStatus(),
      body: {
        error: {
          code: 'VALIDATION_FAILED',
          message: 'Request validation failed.',
        },
      },
    };
  }

  if (exception instanceof HttpException) {
    const responseBody = exception.getResponse();
    const explicitError =
      typeof responseBody === 'string' ? null : extractExplicitError(responseBody);

    if (explicitError) {
      return {
        status: exception.getStatus(),
        body: explicitError,
      };
    }

    return {
      status: exception.getStatus(),
      body: {
        error: {
          code: 'HTTP_ERROR',
          message: 'Request failed.',
        },
      },
    };
  }

  return {
    status: HttpStatus.INTERNAL_SERVER_ERROR,
    body: {
      error: {
        code: 'INTERNAL_SERVER_ERROR',
        message: 'Internal server error.',
      },
    },
  };
}

function extractExplicitError(value: string | object): ErrorResponseBody | null {
  if (!value || typeof value !== 'object') {
    return null;
  }

  const maybe = value as Partial<ErrorResponseBody>;
  if (
    maybe.error &&
    typeof maybe.error.code === 'string' &&
    typeof maybe.error.message === 'string'
  ) {
    return {
      error: {
        code: maybe.error.code,
        message: maybe.error.message,
      },
    };
  }

  return null;
}
