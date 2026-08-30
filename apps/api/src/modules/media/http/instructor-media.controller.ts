import { Body, Controller, Get, HttpCode, HttpStatus, Param, Post, Query, UseGuards } from '@nestjs/common';
import { Throttle, ThrottlerGuard } from '@nestjs/throttler';
import { AccessTokenGuard } from '../../auth/http/access-token.guard';
import type { AuthenticatedPrincipal } from '../../auth/http/authenticated-principal';
import { CurrentAuth } from '../../auth/http/current-auth.decorator';
import { PaginationQueryDto } from '../../tenancy/dto/pagination-query.dto';
import { TenantIdParamDto } from '../../tenancy/dto/uuid-param.dto';
import { CreateDocumentUploadIntentDto } from '../dto/document-upload.dto';
import { CreateVideoUploadIntentDto } from '../dto/video-upload.dto';
import { DocumentAssetIdParamDto, VideoAssetIdParamDto } from '../dto/media-params.dto';
import { MediaAssetService } from '../services/media-asset.service';
import type {
  DocumentAssetSummary,
  DocumentUploadConfirmation,
  DocumentUploadIntent,
  VideoAssetSummary,
  VideoUploadIntent,
} from '../types/media.types';

type VideoAssetListResponse = {
  items: VideoAssetSummary[];
  limit: number;
  offset: number;
};

type DocumentAssetListResponse = {
  items: DocumentAssetSummary[];
  limit: number;
  offset: number;
};

const MEDIA_THROTTLE = {
  media: {
    limit: 60,
    ttl: 60_000,
  },
} as const;

@Controller('instructor/tenants/:tenantId/media')
@UseGuards(ThrottlerGuard, AccessTokenGuard)
@Throttle(MEDIA_THROTTLE)
export class InstructorMediaController {
  constructor(private readonly media: MediaAssetService) {}

  @Get('videos')
  @HttpCode(HttpStatus.OK)
  async listVideos(
    @CurrentAuth() principal: AuthenticatedPrincipal,
    @Param() params: TenantIdParamDto,
    @Query() query: PaginationQueryDto,
  ): Promise<VideoAssetListResponse> {
    const limit = query.limit ?? 25;
    const offset = query.offset ?? 0;
    return {
      items: await this.media.listVideoAssets(principal, params.tenantId, limit, offset),
      limit,
      offset,
    };
  }

  @Get('videos/:videoAssetId')
  @HttpCode(HttpStatus.OK)
  async videoDetail(
    @CurrentAuth() principal: AuthenticatedPrincipal,
    @Param() params: VideoAssetIdParamDto,
  ): Promise<VideoAssetSummary> {
    return this.media.getVideoAsset(principal, params.tenantId, params.videoAssetId);
  }

  @Get('documents')
  @HttpCode(HttpStatus.OK)
  async listDocuments(
    @CurrentAuth() principal: AuthenticatedPrincipal,
    @Param() params: TenantIdParamDto,
    @Query() query: PaginationQueryDto,
  ): Promise<DocumentAssetListResponse> {
    const limit = query.limit ?? 25;
    const offset = query.offset ?? 0;
    return {
      items: await this.media.listDocumentAssets(principal, params.tenantId, limit, offset),
      limit,
      offset,
    };
  }

  @Get('documents/:documentAssetId')
  @HttpCode(HttpStatus.OK)
  async documentDetail(
    @CurrentAuth() principal: AuthenticatedPrincipal,
    @Param() params: DocumentAssetIdParamDto,
  ): Promise<DocumentAssetSummary> {
    return this.media.getDocumentAsset(principal, params.tenantId, params.documentAssetId);
  }

  @Post('documents/upload-intents')
  @HttpCode(HttpStatus.CREATED)
  async createDocumentUploadIntent(
    @CurrentAuth() principal: AuthenticatedPrincipal,
    @Param() params: TenantIdParamDto,
    @Body() body: CreateDocumentUploadIntentDto,
  ): Promise<DocumentUploadIntent> {
    return this.media.createDocumentUploadIntent(principal, params.tenantId, body);
  }

  @Post('videos/upload-intents')
  @HttpCode(HttpStatus.CREATED)
  async createVideoUploadIntent(
    @CurrentAuth() principal: AuthenticatedPrincipal,
    @Param() params: TenantIdParamDto,
    @Body() body: CreateVideoUploadIntentDto,
  ): Promise<VideoUploadIntent> {
    return this.media.createVideoUploadIntent(principal, params.tenantId, body);
  }

  @Post('documents/:documentAssetId/confirm-upload')
  @HttpCode(HttpStatus.OK)
  async confirmDocumentUpload(
    @CurrentAuth() principal: AuthenticatedPrincipal,
    @Param() params: DocumentAssetIdParamDto,
  ): Promise<DocumentUploadConfirmation> {
    return this.media.confirmDocumentUpload(principal, params.tenantId, params.documentAssetId);
  }
}
