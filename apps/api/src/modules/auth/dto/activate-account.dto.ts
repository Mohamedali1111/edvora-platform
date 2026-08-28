import { AccountActivationPurpose } from '../../../../.generated/prisma/client';
import { IsEnum, IsString, MaxLength, MinLength } from 'class-validator';

export class ActivateAccountDto {
  @IsString()
  @MinLength(1)
  @MaxLength(4096)
  activationToken!: string;

  @IsEnum(AccountActivationPurpose)
  purpose!: AccountActivationPurpose;

  @IsString()
  @MinLength(1)
  @MaxLength(128)
  newPassword!: string;
}
