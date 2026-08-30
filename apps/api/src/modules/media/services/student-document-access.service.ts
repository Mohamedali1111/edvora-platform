import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../infrastructure/database/prisma.service';
import type { AuthenticatedPrincipal } from '../../auth/http/authenticated-principal';
import { ClockService } from '../../auth/services/clock.service';
import { StudentCourseAccessService } from '../../courses/services/student-course-access.service';
import type { StudentDocumentAccessStatus } from '../types/student-document-access.types';

/**
 * The provider-independent runtime authorization boundary for student Document Lesson access.
 * All linkage/lifecycle/readiness proof lives in
 * `StudentCourseAccessService.assertAccessibleDocumentLesson` — this service never re-derives or
 * duplicates that chain, it only trusts the `(tenantId, documentAssetId)` pair the proof
 * returns and reads the same safe, already-established metadata fields (`fileName`, `mimeType`,
 * `fileSizeBytes`) the student Course structure endpoint already exposes for a DOCUMENT lesson.
 *
 * No storage/video provider has been selected yet (see `docs/MEDIA.md`), so this is deliberately
 * NOT the point where a signed download URL, access token, or other ephemeral capability is
 * issued — doing so now would mean fabricating provider material that does not exist. This
 * method is the seam where a future provider/media port call belongs: once a provider is
 * selected, the natural extension point is right after `assertAccessibleDocumentLesson` resolves
 * a proven `(tenantId, documentAssetId)` pair, and before this method returns — call the
 * provider's issuance to obtain a real ephemeral capability, then include it in the response.
 * Introducing a formal interface/port for that today, with no real implementation to satisfy it,
 * would be exactly the kind of speculative abstraction this repository's own engineering
 * instructions (`AGENTS.md`) warn against; the seam is documented here in code and in
 * `docs/MEDIA.md` instead.
 */
@Injectable()
export class StudentDocumentAccessService {
  constructor(
    private readonly prismaService: PrismaService,
    private readonly access: StudentCourseAccessService,
    private readonly clock: ClockService,
  ) {}

  /**
   * A pure authorization read: it never creates a `LessonProgress` row, never mutates the
   * Enrollment, and never writes any access-history row (none is required by the current schema
   * or docs). Calling this endpoint repeatedly for the same accessible Lesson is safe and
   * idempotent from a data standpoint — every call is simply re-proving the same entitlement.
   */
  async getDocumentAccess(
    principal: AuthenticatedPrincipal,
    courseId: string,
    lessonId: string,
  ): Promise<StudentDocumentAccessStatus> {
    const { tenantId, documentAssetId } = await this.access.assertAccessibleDocumentLesson(
      principal,
      courseId,
      lessonId,
    );

    // Re-reads the same composite-key-proven, same-tenant DocumentAsset row for its safe display
    // metadata only. Never selects `externalAssetRef`, `providerKey`, or any other
    // provider/storage-internal field.
    const asset = await this.prismaService.client.documentAsset.findUniqueOrThrow({
      where: { id_tenantId: { id: documentAssetId, tenantId } },
      select: { fileName: true, mimeType: true, fileSizeBytes: true },
    });

    return {
      lessonId,
      fileName: asset.fileName,
      mimeType: asset.mimeType,
      fileSizeBytes: asset.fileSizeBytes.toString(),
      ready: true,
      authorizedAt: this.clock.now(),
    };
  }
}
