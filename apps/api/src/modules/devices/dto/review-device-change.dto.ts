import { IsOptional, IsString, MaxLength } from 'class-validator';

export class ReviewDeviceChangeDto {
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  reviewNote?: string;
}
