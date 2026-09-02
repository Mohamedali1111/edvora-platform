// Mirrors apps/api/src/modules/media/types/student-video-access.types.ts
// (StudentVideoAccessStatus) exactly. `playbackUrl` is the complete,
// backend-signed Bunny Stream HLS master URL — this app never derives or
// reconstructs it from a library id / CDN hostname / video id; it only ever
// consumes this string verbatim, at runtime, never persisted (see
// use-video-access.ts).
export type VideoAccessResponse = {
  lessonId: string;
  durationSeconds: number | null;
  playbackUrl: string;
  expiresAt: string;
};
