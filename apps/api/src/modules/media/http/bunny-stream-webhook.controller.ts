import { Controller, HttpCode, HttpStatus, Inject, Post, Req } from '@nestjs/common';
import type { Request } from 'express';
import { VIDEO_PROVIDER } from '../media.constants';
import { MediaAssetService } from '../services/media-asset.service';
import type { VideoProvider } from '../video/video.provider';

type RawBodyRequest = Request & {
  rawBody?: Buffer;
};

@Controller('provider-webhooks/bunny/stream')
export class BunnyStreamWebhookController {
  constructor(
    private readonly media: MediaAssetService,
    @Inject(VIDEO_PROVIDER) private readonly videoProvider: VideoProvider,
  ) {}

  @Post()
  @HttpCode(HttpStatus.OK)
  async handle(@Req() request: RawBodyRequest): Promise<{ received: true }> {
    const event = this.videoProvider.verifyAndParseWebhook({
      headers: request.headers,
      rawBody: request.rawBody ?? Buffer.alloc(0),
    });

    await this.media.handleVideoProviderWebhook(event);
    return { received: true };
  }
}
