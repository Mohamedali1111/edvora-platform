import { IsEmail, IsEnum, IsString, MaxLength, MinLength } from 'class-validator';
import { SessionChannelDto } from './session-channel.dto';

export class LoginDto {
  @IsEmail()
  @MaxLength(320)
  email!: string;

  @IsString()
  @MinLength(1)
  @MaxLength(128)
  password!: string;

  @IsEnum(SessionChannelDto)
  channel!: SessionChannelDto;
}
