import { Inject, Injectable } from '@nestjs/common';
import type { AuthenticatedPrincipal } from '../../auth/http/authenticated-principal';
import { ClockService } from '../../auth/services/clock.service';
import { StudentCourseAccessService } from '../../courses/services/student-course-access.service';
import { VideoAssetProviderInvariantViolationError } from '../errors/media.errors';
import { VIDEO_PROVIDER } from '../media.constants';
import type { StudentVideoAccessStatus } from '../types/student-video-access.types';
import type { VideoProvider } from '../video/video.provider';

// Playback capability TTL is derived from the specific video's own known duration, not a single
// flat constant. Bunny's directory token expiry is one fixed wall-clock deadline checked on every
// request under the signed path — it is not a sliding per-segment/session window — so a short flat
// TTL (e.g. ~5 minutes) would 403 mid-playback for any lecture longer than that. Instead:
//   ttl = clamp(durationSeconds + BUFFER, MIN, MAX)
// `BUFFER` covers the gap between authorization and first byte, pausing, and seeking backward into
// already-played segments after the naive "duration" point. `MIN`/`MAX` keep the capability
// meaningfully short-lived even for very short or unexpectedly long videos. See docs/MEDIA.md for
// the full reasoning; the API can always be called again to obtain a fresh capability.
const PLAYBACK_URL_BUFFER_SECONDS = 15 * 60; // 15 minutes
const PLAYBACK_URL_MIN_TTL_SECONDS = 5 * 60; // 5 minutes
const PLAYBACK_URL_MAX_TTL_SECONDS = 4 * 60 * 60; // 4 hours
// Used only when `durationSeconds` is unknown (null/non-positive) — a conservative, bounded
// fallback rather than defaulting to the maximum.
const PLAYBACK_URL_FALLBACK_TTL_SECONDS = 2 * 60 * 60; // 2 hours

/**
 * Real Bunny Stream playback capability issuance for student VIDEO Lesson access. All
 * linkage/lifecycle/readiness proof lives in
 * `StudentCourseAccessService.assertAccessibleVideoLesson` — this service never re-derives or
 * duplicates that chain. It only uses the proven `(tenantId, videoAssetId, providerKey,
 * externalAssetRef)` tuple to issue a short-lived, path-scoped HLS playback URL through the
 * injected `VideoProvider`.
 */
@Injectable()
export class StudentVideoAccessService {
  constructor(
    private readonly access: StudentCourseAccessService,
    private readonly clock: ClockService,
    @Inject(VIDEO_PROVIDER) private readonly videoProvider: VideoProvider,
  ) {}

  /**
   * A pure authorization/capability action: it never creates or updates `LessonProgress`, never
   * marks the Lesson completed, never creates a `QuizAttempt`, never mutates the Enrollment, and
   * never persists the signed playback URL anywhere (no DB write, no log line, no `SecurityEvent`
   * row). Repeated calls for the same accessible Lesson are safe and simply issue a fresh ephemeral
   * capability each time — no playback-session row is created or required. If issuance fails (an
   * unexpected provider-identity mismatch, or a malformed persisted `externalAssetRef`), it throws
   * without touching the `VideoAsset`, `Enrollment`, or any progress state — a signing failure can
   * never regress or poison durable state.
   */
  async getVideoAccess(
    principal: AuthenticatedPrincipal,
    courseId: string,
    lessonId: string,
  ): Promise<StudentVideoAccessStatus> {
    const { durationSeconds, providerKey, externalAssetRef } = await this.access.assertAccessibleVideoLesson(
      principal,
      courseId,
      lessonId,
    );

    // Only a READY VideoAsset reaches this point (enforced by `assertAccessibleVideoLesson`), but a
    // READY row whose persisted provider identity does not match the currently configured Bunny
    // Stream library is an invariant violation, not a normal "not found" case — reject safely rather
    // than sign a path against the wrong/foreign library. `createPlaybackCapability` separately
    // refuses a malformed `externalAssetRef` shape (see `BunnyStreamVideoProvider`).
    if (providerKey !== this.videoProvider.providerKey) {
      throw new VideoAssetProviderInvariantViolationError();
    }

    const now = this.clock.now();
    const capability = this.videoProvider.createPlaybackCapability({
      videoId: externalAssetRef,
      expiresInSeconds: computePlaybackTtlSeconds(durationSeconds),
      now,
    });

    return {
      lessonId,
      durationSeconds,
      playbackUrl: capability.playbackUrl,
      expiresAt: capability.expiresAt,
    };
  }
}

function computePlaybackTtlSeconds(durationSeconds: number | null): number {
  if (durationSeconds === null || durationSeconds <= 0) {
    return PLAYBACK_URL_FALLBACK_TTL_SECONDS;
  }

  const withBuffer = durationSeconds + PLAYBACK_URL_BUFFER_SECONDS;
  return Math.min(PLAYBACK_URL_MAX_TTL_SECONDS, Math.max(PLAYBACK_URL_MIN_TTL_SECONDS, withBuffer));
}
