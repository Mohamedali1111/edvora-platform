import { createHash, createHmac } from 'node:crypto';
import { InvalidVideoProviderWebhookError } from '../errors/media.errors';
import type { MediaRuntimeConfig } from '../media.config';
import { BunnyStreamVideoProvider } from './bunny-stream-video.provider';

const config: MediaRuntimeConfig = {
  documents: {
    r2: {
      endpoint: 'https://example-account.r2.cloudflarestorage.com',
      accessKeyId: 'test-access-key',
      secretAccessKey: 'test-secret-key',
      bucketName: 'test-documents',
      uploadUrlTtlSeconds: 600,
      downloadUrlTtlSeconds: 300,
    },
  },
  video: {
    bunnyStream: {
      libraryId: '123456',
      apiKey: 'test-bunny-api-key',
      webhookSigningSecret: 'test-bunny-webhook-secret',
      tusUploadUrl: 'https://video.bunnycdn.com/tusupload',
      tusAuthorizationTtlSeconds: 21_600,
    },
  },
};

describe('BunnyStreamVideoProvider', () => {
  it('creates Bunny TUS upload authorization without exposing the API key', () => {
    const provider = new BunnyStreamVideoProvider(config);
    const now = new Date('2026-06-15T12:00:00.000Z');
    const capability = provider.createTusUploadCapability({
      videoId: 'bunny-video-guid',
      expiresInSeconds: 600,
      now,
    });
    const expires = Math.floor(now.getTime() / 1000) + 600;
    const expectedSignature = createHash('sha256')
      .update(`123456test-bunny-api-key${expires}bunny-video-guid`)
      .digest('hex');

    expect(capability).toEqual({
      endpoint: 'https://video.bunnycdn.com/tusupload',
      libraryId: '123456',
      videoId: 'bunny-video-guid',
      expiresAt: new Date(expires * 1000),
      headers: {
        AuthorizationSignature: expectedSignature,
        AuthorizationExpire: String(expires),
        VideoId: 'bunny-video-guid',
        LibraryId: '123456',
      },
    });
    expect(JSON.stringify(capability)).not.toContain('test-bunny-api-key');
  });

  it('verifies Bunny v1 HMAC over the exact raw body and parses status metadata', () => {
    const provider = new BunnyStreamVideoProvider(config);
    const rawBody = Buffer.from(
      JSON.stringify({ VideoLibraryId: 123456, VideoGuid: 'bunny-video-guid', Status: 3, Length: 91 }),
      'utf8',
    );
    const signature = createHmac('sha256', 'test-bunny-webhook-secret').update(rawBody).digest('hex');

    expect(
      provider.verifyAndParseWebhook({
        headers: {
          'x-bunnystream-signature-version': 'v1',
          'x-bunnystream-signature-algorithm': 'hmac-sha256',
          'x-bunnystream-signature': signature,
        },
        rawBody,
      }),
    ).toEqual({
      libraryId: '123456',
      videoId: 'bunny-video-guid',
      status: 3,
      durationSeconds: 91,
    });
  });

  it('rejects unsupported versions, algorithms, malformed signatures, and tampered raw bodies', () => {
    const provider = new BunnyStreamVideoProvider(config);
    const rawBody = Buffer.from(JSON.stringify({ VideoLibraryId: 123456, VideoGuid: 'bunny-video-guid', Status: 3 }));
    const signature = createHmac('sha256', 'test-bunny-webhook-secret').update(rawBody).digest('hex');

    for (const input of [
      { version: 'v2', algorithm: 'hmac-sha256', signature, rawBody },
      { version: 'v1', algorithm: 'hmac-sha1', signature, rawBody },
      { version: 'v1', algorithm: 'hmac-sha256', signature: 'not-hex', rawBody },
      {
        version: 'v1',
        algorithm: 'hmac-sha256',
        signature,
        rawBody: Buffer.from(JSON.stringify({ VideoLibraryId: 123456, VideoGuid: 'bunny-video-guid', Status: 5 })),
      },
    ]) {
      expect(() =>
        provider.verifyAndParseWebhook({
          headers: {
            'x-bunnystream-signature-version': input.version,
            'x-bunnystream-signature-algorithm': input.algorithm,
            'x-bunnystream-signature': input.signature,
          },
          rawBody: input.rawBody,
        }),
      ).toThrow(InvalidVideoProviderWebhookError);
    }
  });
});
