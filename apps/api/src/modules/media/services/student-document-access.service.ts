import { Inject, Injectable } from '@nestjs/common';
import { PrismaService } from '../../../infrastructure/database/prisma.service';
import type { AuthenticatedPrincipal } from '../../auth/http/authenticated-principal';
import { ClockService } from '../../auth/services/clock.service';
import { StudentCourseAccessService } from '../../courses/services/student-course-access.service';
import { DocumentAssetStorageInvariantViolationError } from '../errors/media.errors';
import type { MediaRuntimeConfig } from '../media.config';
import { DOCUMENT_STORAGE_PROVIDER, MEDIA_RUNTIME_CONFIG } from '../media.constants';
import type { DocumentStorageProvider } from '../storage/document-storage.provider';
import type { StudentDocumentAccessStatus } from '../types/student-document-access.types';

/**
 * Runtime authorization and capability issuance for student Document Lesson access. All
 * linkage/lifecycle/readiness proof lives in
 * `StudentCourseAccessService.assertAccessibleDocumentLesson`; this service does not re-derive or
 * duplicate that chain. It only uses the proven `(tenantId, documentAssetId)` pair to load the
 * READY `DocumentAsset` and issue a short-lived R2 GET capability for its finalized object key.
 */
@Injectable()
export class StudentDocumentAccessService {
  constructor(
    private readonly prismaService: PrismaService,
    private readonly access: StudentCourseAccessService,
    private readonly clock: ClockService,
    @Inject(MEDIA_RUNTIME_CONFIG) private readonly mediaConfig: MediaRuntimeConfig,
    @Inject(DOCUMENT_STORAGE_PROVIDER) private readonly documentStorage: DocumentStorageProvider,
  ) {}

  /**
   * A pure authorization/capability action: it never creates a `LessonProgress` row, never marks
   * the Lesson completed, never creates a `QuizAttempt`, never mutates the Enrollment, and never
   * persists the signed URL. Repeated calls may issue fresh short-lived bearer capabilities for
   * the same finalized R2 object key.
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

    const asset = await this.prismaService.client.documentAsset.findUniqueOrThrow({
      where: { id_tenantId: { id: documentAssetId, tenantId } },
      select: { externalAssetRef: true, fileName: true, mimeType: true, fileSizeBytes: true },
    });

    if (!isFinalDocumentObjectKey(asset.externalAssetRef, tenantId, documentAssetId)) {
      throw new DocumentAssetStorageInvariantViolationError();
    }

    const now = this.clock.now();
    const capability = await this.documentStorage.createPresignedDownload({
      objectKey: asset.externalAssetRef,
      expiresInSeconds: this.mediaConfig.documents.r2.downloadUrlTtlSeconds,
      now,
    });

    return {
      lessonId,
      fileName: asset.fileName,
      mimeType: asset.mimeType,
      fileSizeBytes: asset.fileSizeBytes.toString(),
      downloadUrl: capability.downloadUrl,
      expiresAt: capability.expiresAt,
    };
  }
}

function isFinalDocumentObjectKey(objectKey: string, tenantId: string, documentAssetId: string): boolean {
  return objectKey === `tenants/${tenantId}/documents/${documentAssetId}`;
}
