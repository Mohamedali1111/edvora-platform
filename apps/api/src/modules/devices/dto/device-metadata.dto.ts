import { IsEnum, IsOptional, IsString, MaxLength } from 'class-validator';
import { DevicePlatform } from '../../../../.generated/prisma/client';

export class DeviceMetadataDto {
  @IsEnum(DevicePlatform)
  platform!: DevicePlatform;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  deviceModel?: string;

  @IsOptional()
  @IsString()
  @MaxLength(80)
  osVersion?: string;

  @IsOptional()
  @IsString()
  @MaxLength(40)
  appVersion?: string;
}
