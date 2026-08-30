import { Inject, Injectable } from '@nestjs/common';
import {
  CopyObjectCommand,
  DeleteObjectCommand,
  HeadObjectCommand,
  GetObjectCommand,
  NoSuchKey,
  NotFound,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { MEDIA_RUNTIME_CONFIG } from '../media.constants';
import type { MediaRuntimeConfig } from '../media.config';
import type {
  DocumentObjectMetadata,
  DocumentStorageProvider,
  PresignedDownloadCapability,
  PresignedUploadCapability,
} from './document-storage.provider';

@Injectable()
export class R2DocumentStorageProvider implements DocumentStorageProvider {
  private readonly client: S3Client;
  private readonly bucketName: string;

  constructor(@Inject(MEDIA_RUNTIME_CONFIG) config: MediaRuntimeConfig) {
    this.bucketName = config.documents.r2.bucketName;
    this.client = new S3Client({
      region: 'auto',
      endpoint: config.documents.r2.endpoint,
      credentials: {
        accessKeyId: config.documents.r2.accessKeyId,
        secretAccessKey: config.documents.r2.secretAccessKey,
      },
    });
  }

  async createPresignedUpload(input: {
    objectKey: string;
    contentType: string;
    expiresInSeconds: number;
    now: Date;
  }): Promise<PresignedUploadCapability> {
    const command = new PutObjectCommand({
      Bucket: this.bucketName,
      Key: input.objectKey,
      ContentType: input.contentType,
    });

    const uploadUrl = await getSignedUrl(this.client, command, { expiresIn: input.expiresInSeconds });

    return {
      uploadUrl,
      expiresAt: new Date(input.now.getTime() + input.expiresInSeconds * 1000),
      headers: {
        'Content-Type': input.contentType,
      },
    };
  }

  async createPresignedDownload(input: {
    objectKey: string;
    expiresInSeconds: number;
    now: Date;
  }): Promise<PresignedDownloadCapability> {
    const command = new GetObjectCommand({
      Bucket: this.bucketName,
      Key: input.objectKey,
    });

    const downloadUrl = await getSignedUrl(this.client, command, { expiresIn: input.expiresInSeconds });

    return {
      downloadUrl,
      expiresAt: new Date(input.now.getTime() + input.expiresInSeconds * 1000),
    };
  }

  async headObject(objectKey: string): Promise<DocumentObjectMetadata> {
    try {
      const response = await this.client.send(
        new HeadObjectCommand({
          Bucket: this.bucketName,
          Key: objectKey,
        }),
      );

      return {
        exists: true,
        contentLengthBytes:
          typeof response.ContentLength === 'number' ? BigInt(response.ContentLength) : undefined,
        contentType: response.ContentType,
      };
    } catch (error) {
      if (isMissingObjectError(error)) {
        return { exists: false };
      }

      throw error;
    }
  }

  async promoteObject(input: { sourceObjectKey: string; destinationObjectKey: string }): Promise<void> {
    await this.client.send(
      new CopyObjectCommand({
        Bucket: this.bucketName,
        CopySource: `${this.bucketName}/${encodeR2CopySourceKey(input.sourceObjectKey)}`,
        Key: input.destinationObjectKey,
      }),
    );
  }

  async deleteObject(objectKey: string): Promise<void> {
    await this.client.send(
      new DeleteObjectCommand({
        Bucket: this.bucketName,
        Key: objectKey,
      }),
    );
  }
}

function isMissingObjectError(error: unknown): boolean {
  return error instanceof NoSuchKey || error instanceof NotFound;
}

function encodeR2CopySourceKey(objectKey: string): string {
  return objectKey
    .split('/')
    .map((segment) => encodeURIComponent(segment))
    .join('/');
}
