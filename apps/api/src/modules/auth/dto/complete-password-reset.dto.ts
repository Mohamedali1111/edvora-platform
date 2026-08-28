import { IsString, MaxLength, MinLength } from 'class-validator';

export class CompletePasswordResetDto {
  @IsString()
  @MinLength(1)
  @MaxLength(4096)
  resetToken!: string;

  @IsString()
  @MinLength(1)
  @MaxLength(128)
  newPassword!: string;
}
