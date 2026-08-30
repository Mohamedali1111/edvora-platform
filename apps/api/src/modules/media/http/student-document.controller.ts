import { Controller, Get, HttpCode, HttpStatus, Param, UseGuards } from '@nestjs/common';
import { Throttle, ThrottlerGuard } from '@nestjs/throttler';
import { AccessTokenGuard } from '../../auth/http/access-token.guard';
import type { AuthenticatedPrincipal } from '../../auth/http/authenticated-principal';
import { CurrentAuth } from '../../auth/http/current-auth.decorator';
import { StudentLessonIdParamDto } from '../../courses/dto/course-params.dto';
import { StudentDeviceGuard } from '../../devices/http/student-device.guard';
import { StudentDocumentAccessService } from '../services/student-document-access.service';
import type { StudentDocumentAccessStatus } from '../types/student-document-access.types';

// Deliberately routed as a nested resource under the already-authorized Course/Lesson path
// (never a bare `/student/documents/:documentAssetId`) so a document can only ever be reached
// through the exact DOCUMENT Lesson that references it — see
// `StudentCourseAccessService.assertAccessibleDocumentLesson`. GET, not POST: this issues a
// short-lived R2 download capability (see `StudentDocumentAccessService`), but it remains a pure,
// side-effect-free authorization/capability read — not an action that creates or mutates anything.
const STUDENT_DOCUMENT_THROTTLE = {
  document: {
    limit: 60,
    ttl: 60_000,
  },
} as const;

@Controller('student/courses/:courseId/lessons/:lessonId/document')
@UseGuards(ThrottlerGuard, AccessTokenGuard, StudentDeviceGuard)
@Throttle(STUDENT_DOCUMENT_THROTTLE)
export class StudentDocumentController {
  constructor(private readonly documentAccess: StudentDocumentAccessService) {}

  @Get('access')
  @HttpCode(HttpStatus.OK)
  async getAccess(
    @CurrentAuth() principal: AuthenticatedPrincipal,
    @Param() params: StudentLessonIdParamDto,
  ): Promise<StudentDocumentAccessStatus> {
    return this.documentAccess.getDocumentAccess(principal, params.courseId, params.lessonId);
  }
}
