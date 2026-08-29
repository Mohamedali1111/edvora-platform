import { IsOptional, IsString, MaxLength } from 'class-validator';
import { DeviceMetadataDto } from './device-metadata.dto';

export class RequestDeviceChangeDto extends DeviceMetadataDto {
  @IsOptional()
  @IsString()
  @MaxLength(500)
  reason?: string;
}
