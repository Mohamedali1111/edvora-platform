import { Injectable } from '@nestjs/common';
import type { AuthenticatedPrincipal } from '../../auth/http/authenticated-principal';
import { ClockService } from '../../auth/services/clock.service';
import { StudentCourseAccessService } from '../../courses/services/student-course-access.service';
import type { StudentVideoAccessStatus } from '../types/student-video-access.types';

/**
 * The provider-independent runtime authorization boundary for student VIDEO Lesson playback. All
 * linkage/lifecycle/readiness proof lives in
 * `StudentCourseAccessService.assertAccessibleVideoLesson` — this service never re-derives or
 * duplicates that chain, it only trusts the `(tenantId, videoAssetId, durationSeconds)` tuple the
 * proof returns, mirroring `StudentDocumentAccessService` exactly for VIDEO instead of DOCUMENT.
 *
 * No video/streaming provider has been selected yet (see `docs/MEDIA.md`), so this is
 * deliberately NOT the point where a playback URL (HLS/DASH), signed URL, playback token, or DRM
 * license is issued — doing so now would mean fabricating provider material that does not exist.
 * This method is the seam where a future provider/media port call belongs: once a provider is
 * selected, the natural extension point is right after `assertAccessibleVideoLesson` resolves a
 * proven `(tenantId, videoAssetId)` pair, and before this method returns — call the provider's
 * issuance to obtain a real ephemeral playback capability (and, separately, any DRM
 * license/enforcement step the provider offers), then include it in the response. Introducing a
 * formal interface/port for that today, with no real implementation to satisfy it, would be
 * exactly the kind of speculative abstraction this repository's own engineering instructions
 * (`AGENTS.md`) warn against; the seam is documented here in code and in `docs/MEDIA.md` instead.
 */
@Injectable()
export class StudentVideoAccessService {
  constructor(
    private readonly access: StudentCourseAccessService,
    private readonly clock: ClockService,
  ) {}

  /**
   * A pure authorization read: it never creates or updates `LessonProgress`, never marks the
   * Lesson completed, never creates a `QuizAttempt`, never mutates the Enrollment, and never
   * records watch time or a playback/session row (no such model exists in the current schema, and
   * none is required by current docs). Calling this endpoint repeatedly for the same accessible
   * Lesson is safe and idempotent from a data standpoint — every call is simply re-proving the
   * same entitlement. Verified watch/resume/completion telemetry remains explicitly deferred to
   * future Media work; the existing generic manual VIDEO-lesson completion endpoint
   * (`POST /student/courses/:courseId/lessons/:lessonId/complete`) is untouched by this slice.
   */
  async getVideoAccess(
    principal: AuthenticatedPrincipal,
    courseId: string,
    lessonId: string,
  ): Promise<StudentVideoAccessStatus> {
    const { durationSeconds } = await this.access.assertAccessibleVideoLesson(principal, courseId, lessonId);

    return {
      lessonId,
      ready: true,
      durationSeconds,
      authorizedAt: this.clock.now(),
    };
  }
}
