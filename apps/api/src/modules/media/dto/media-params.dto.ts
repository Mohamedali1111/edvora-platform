import { Matches } from 'class-validator';
import { TenantIdParamDto, UUID_PARAM_PATTERN } from '../../tenancy/dto/uuid-param.dto';

export class VideoAssetIdParamDto extends TenantIdParamDto {
  @Matches(UUID_PARAM_PATTERN)
  videoAssetId!: string;
}

export class DocumentAssetIdParamDto extends TenantIdParamDto {
  @Matches(UUID_PARAM_PATTERN)
  documentAssetId!: string;
}
