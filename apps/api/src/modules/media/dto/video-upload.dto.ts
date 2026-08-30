import { IsString, Matches, MaxLength, MinLength } from 'class-validator';

export class CreateVideoUploadIntentDto {
  @IsString()
  @MinLength(1)
  @MaxLength(240)
  @Matches(/\S/)
  title!: string;
}
