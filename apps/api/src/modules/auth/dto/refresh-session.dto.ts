import { IsEnum, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';
import { SessionChannelDto } from './session-channel.dto';

export class RefreshSessionDto {
  @IsEnum(SessionChannelDto)
  channel!: SessionChannelDto;

  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(4096)
  refreshToken?: string;

  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(64)
  sessionId?: string;
}
