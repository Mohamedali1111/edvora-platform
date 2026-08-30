import { Controller, Get, HttpCode, HttpStatus, Param, UseGuards } from '@nestjs/common';
import { Throttle, ThrottlerGuard } from '@nestjs/throttler';
import { AccessTokenGuard } from '../../auth/http/access-token.guard';
import type { AuthenticatedPrincipal } from '../../auth/http/authenticated-principal';
import { CurrentAuth } from '../../auth/http/current-auth.decorator';
import { StudentLessonIdParamDto } from '../../courses/dto/course-params.dto';
import { StudentDeviceGuard } from '../../devices/http/student-device.guard';
import { StudentVideoAccessService } from '../services/student-video-access.service';
import type { StudentVideoAccessStatus } from '../types/student-video-access.types';

// Deliberately routed as a nested resource under the already-authorized Course/Lesson path
// (never a bare `/student/videos/:videoAssetId`) so a video can only ever be reached through the
// exact VIDEO Lesson that references it — see
// `StudentCourseAccessService.assertAccessibleVideoLesson`. GET, not POST: this issues a
// short-lived, path-scoped Bunny HLS playback capability (see `StudentVideoAccessService`), but it
// remains a pure, side-effect-free authorization/capability read — not an action that creates or
// mutates anything. Mirrors `StudentDocumentController` exactly.
const STUDENT_VIDEO_THROTTLE = {
  video: {
    limit: 60,
    ttl: 60_000,
  },
} as const;

@Controller('student/courses/:courseId/lessons/:lessonId/video')
@UseGuards(ThrottlerGuard, AccessTokenGuard, StudentDeviceGuard)
@Throttle(STUDENT_VIDEO_THROTTLE)
export class StudentVideoController {
  constructor(private readonly videoAccess: StudentVideoAccessService) {}

  @Get('access')
  @HttpCode(HttpStatus.OK)
  async getAccess(
    @CurrentAuth() principal: AuthenticatedPrincipal,
    @Param() params: StudentLessonIdParamDto,
  ): Promise<StudentVideoAccessStatus> {
    return this.videoAccess.getVideoAccess(principal, params.courseId, params.lessonId);
  }
}
