import { IsInt, IsMimeType, IsString, Matches, Max, MaxLength, Min, MinLength } from 'class-validator';

export const DOCUMENT_UPLOAD_ALLOWED_MIME_TYPES = ['application/pdf'] as const;
export const DOCUMENT_UPLOAD_MAX_FILE_SIZE_BYTES = 25 * 1024 * 1024;

export class CreateDocumentUploadIntentDto {
  @IsString()
  @MinLength(1)
  @MaxLength(255)
  @Matches(/\S/)
  fileName!: string;

  @IsString()
  @IsMimeType()
  mimeType!: string;

  @IsInt()
  @Min(1)
  @Max(DOCUMENT_UPLOAD_MAX_FILE_SIZE_BYTES)
  fileSizeBytes!: number;
}
