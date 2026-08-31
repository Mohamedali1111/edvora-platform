import { Matches } from 'class-validator';
import { UUID_PARAM_PATTERN } from '../../tenancy/dto/uuid-param.dto';

export class NotificationIdParamDto {
  @Matches(UUID_PARAM_PATTERN)
  notificationId!: string;
}
