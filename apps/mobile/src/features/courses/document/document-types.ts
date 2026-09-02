// Mirrors apps/api/src/modules/media/types/student-document-access.types.ts
// (StudentDocumentAccessStatus) exactly. `downloadUrl` is the complete,
// backend-signed R2 GET URL — this app never derives or reconstructs it from
// an account id / bucket / object key / tenant id; it only ever consumes this
// string verbatim, at runtime, never persisted (see document-client.ts and
// document-lesson-screen.tsx).
export type DocumentAccessResponse = {
  lessonId: string;
  fileName: string;
  mimeType: string;
  fileSizeBytes: string;
  downloadUrl: string;
  expiresAt: string;
};
