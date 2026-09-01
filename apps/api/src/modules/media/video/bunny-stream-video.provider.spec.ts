import { createHash, createHmac } from 'node:crypto';
import {
  InvalidVideoProviderWebhookError,
  VideoPlaybackSigningFailedError,
  VideoProviderMetadataFetchFailedError,
} from '../errors/media.errors';
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
      cdnHostname: 'vz-example-123.b-cdn.net',
      tokenAuthenticationKey: 'test-bunny-token-authentication-key',
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

  // -----------------------------------------------------------------------------------------------
  // createPlaybackCapability — Bunny CDN Pull Zone "directory" (path-style) token authentication.
  // This is deliberately NOT the embed/iframe view-token formula
  // (SHA256_HEX(key + videoId + expires)); it is the mechanism that protects the actual HLS
  // playlist.m3u8 and every segment file under a video's own storage path. The construction below is
  // independently reproduced from Bunny's own official reference implementation
  // (github.com/BunnyWay/BunnyCDN.TokenAuthentication) so this test proves the provider matches
  // Bunny's real algorithm, not just some internally-consistent formula.
  // -----------------------------------------------------------------------------------------------

  // This test is anchored to Bunny's OWN literal, externally-published test vector — not a value
  // re-derived from our own formula description, and not produced by calling this provider's own
  // code — copied verbatim from `nodejs/token.test.js` in Bunny's official
  // github.com/BunnyWay/BunnyCDN.TokenAuthentication repository:
  //   signUrl('https://token-tester.b-cdn.net/abc/', 'SecurityKey', 86400, '', /*isDirectory*/ true,
  //           /*pathAllowed*/ '/abc', '', '', false, /*expiresAt*/ 1598024587)
  //   => 'https://token-tester.b-cdn.net/bcdn_token=HS256-uVZvT3SbEoVKYJyDJgbcsDmSFf73cv-uNUVaJiKWpbQ' +
  //      '&token_path=%2Fabc&expires=1598024587/abc/'
  // If Bunny ever changes their accepted algorithm, this hardcoded string (not just our own
  // restated formula) is what would catch the drift.
  it('matches Bunny’s own published official test vector for the directory-token algorithm, verbatim', () => {
    const officialSecurityKey = 'SecurityKey';
    const officialExpiresUnixSeconds = 1598024587;
    const officialTokenPath = '/abc';
    const officialExpectedToken = 'HS256-uVZvT3SbEoVKYJyDJgbcsDmSFf73cv-uNUVaJiKWpbQ';

    // A standalone, minimal re-implementation of exactly Bunny's documented formula — kept
    // deliberately separate from `expectedDirectoryToken` below and from the provider's own code, so
    // a bug shared between the provider and a spec helper cannot silently agree with itself.
    const signingData = `token_path=${officialTokenPath}`;
    const digest = createHmac('sha256', officialSecurityKey)
      .update(officialTokenPath)
      .update(String(officialExpiresUnixSeconds))
      .update(signingData)
      .digest('base64')
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=+$/, '');

    expect(`HS256-${digest}`).toBe(officialExpectedToken);
  });

  function expectedDirectoryToken(videoId: string, expiresUnixSeconds: number, securityKey: string): string {
    const tokenPath = `/${videoId}/`;
    const signingData = `token_path=${tokenPath}`;
    const digest = createHmac('sha256', securityKey)
      .update(tokenPath)
      .update(String(expiresUnixSeconds))
      .update(signingData)
      .digest('base64')
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=+$/, '');
    return `HS256-${digest}`;
  }

  function expectedPlaybackUrl(
    cdnHostname: string,
    videoId: string,
    expiresUnixSeconds: number,
    securityKey: string,
  ): string {
    const tokenPath = `/${videoId}/`;
    const token = expectedDirectoryToken(videoId, expiresUnixSeconds, securityKey);
    return (
      `https://${cdnHostname}/bcdn_token=${token}` +
      `&token_path=${encodeURIComponent(tokenPath)}&expires=${expiresUnixSeconds}${tokenPath}playlist.m3u8`
    );
  }

  const validVideoId = 'a1b2c3d4-e5f6-47a8-89ab-cdef01234567';

  it('signs a directory-scoped HLS playback URL matching Bunny’s documented token construction exactly', () => {
    const provider = new BunnyStreamVideoProvider(config);
    const now = new Date('2026-06-15T12:00:00.000Z');

    const capability = provider.createPlaybackCapability({ videoId: validVideoId, expiresInSeconds: 300, now });
    const expiresUnixSeconds = Math.floor(now.getTime() / 1000) + 300;

    expect(capability.expiresAt).toEqual(new Date(expiresUnixSeconds * 1000));
    expect(capability.playbackUrl).toBe(
      expectedPlaybackUrl(config.video.bunnyStream.cdnHostname, validVideoId, expiresUnixSeconds, config.video.bunnyStream.tokenAuthenticationKey),
    );
  });

  it('uses Bunny’s path-style directory token (/bcdn_token=...), never a query-string token on the manifest', () => {
    const provider = new BunnyStreamVideoProvider(config);
    const now = new Date('2026-06-15T12:00:00.000Z');

    const { playbackUrl } = provider.createPlaybackCapability({ videoId: validVideoId, expiresInSeconds: 300, now });

    // The token must be embedded as a path segment before the video's own /{videoId}/ prefix, not
    // as a `?token=` query parameter — a native HLS player resolves segment URIs relative to
    // everything before the manifest's last `/`, so only the path-embedded form is carried forward
    // automatically into every segment request.
    expect(playbackUrl).toMatch(new RegExp(`^https://${config.video.bunnyStream.cdnHostname}/bcdn_token=HS256-`));
    expect(playbackUrl).toContain(`/${validVideoId}/playlist.m3u8`);
    expect(playbackUrl).not.toMatch(/\?token=/);
    expect(playbackUrl).toContain(`token_path=${encodeURIComponent(`/${validVideoId}/`)}`);
  });

  it('changes the token when the video ID changes', () => {
    const provider = new BunnyStreamVideoProvider(config);
    const now = new Date('2026-06-15T12:00:00.000Z');
    const otherVideoId = 'ffffffff-1111-2222-3333-444444444444';

    const a = provider.createPlaybackCapability({ videoId: validVideoId, expiresInSeconds: 300, now });
    const b = provider.createPlaybackCapability({ videoId: otherVideoId, expiresInSeconds: 300, now });

    expect(a.playbackUrl).not.toBe(b.playbackUrl);
  });

  it('changes the token when the expiry changes', () => {
    const provider = new BunnyStreamVideoProvider(config);
    const now = new Date('2026-06-15T12:00:00.000Z');

    const a = provider.createPlaybackCapability({ videoId: validVideoId, expiresInSeconds: 300, now });
    const b = provider.createPlaybackCapability({ videoId: validVideoId, expiresInSeconds: 900, now });

    expect(a.playbackUrl).not.toBe(b.playbackUrl);
    expect(a.expiresAt.getTime()).not.toBe(b.expiresAt.getTime());
  });

  it('changes the token when the configured security key differs, and never leaks the key into the URL', () => {
    const now = new Date('2026-06-15T12:00:00.000Z');
    const providerA = new BunnyStreamVideoProvider(config);
    const providerB = new BunnyStreamVideoProvider({
      ...config,
      video: {
        ...config.video,
        bunnyStream: { ...config.video.bunnyStream, tokenAuthenticationKey: 'a-completely-different-key' },
      },
    });

    const a = providerA.createPlaybackCapability({ videoId: validVideoId, expiresInSeconds: 300, now });
    const b = providerB.createPlaybackCapability({ videoId: validVideoId, expiresInSeconds: 300, now });

    expect(a.playbackUrl).not.toBe(b.playbackUrl);
    expect(a.playbackUrl).not.toContain(config.video.bunnyStream.tokenAuthenticationKey);
    expect(a.playbackUrl).not.toContain('a-completely-different-key');
  });

  it('rejects a malformed/non-GUID videoId rather than signing an arbitrary path', () => {
    const provider = new BunnyStreamVideoProvider(config);
    const now = new Date('2026-06-15T12:00:00.000Z');

    for (const malformed of ['not-a-guid', '', '../../../etc/passwd', 'a1b2c3d4-e5f6-47a8-89ab', '12345']) {
      expect(() => provider.createPlaybackCapability({ videoId: malformed, expiresInSeconds: 300, now })).toThrow(
        VideoPlaybackSigningFailedError,
      );
    }
  });

  // -----------------------------------------------------------------------------------------------
  // fetchVideoMetadata — the authoritative server-to-server duration-hydration fallback used only
  // when a real Bunny READY webhook's own `Length` field is absent/invalid (proven to actually
  // happen against the real Bunny library — see docs/MEDIA.md). Uses the same host/AccessKey
  // pattern as `createVideoResource` above, against Bunny's "Get Video" endpoint.
  // -----------------------------------------------------------------------------------------------
  describe('fetchVideoMetadata', () => {
    const originalFetch = global.fetch;

    afterEach(() => {
      global.fetch = originalFetch;
    });

    it('requests the video by this provider’s own configured library and API key, and returns its duration', async () => {
      const fetchSpy = jest.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ guid: 'bunny-video-guid', length: 91 }),
      });
      global.fetch = fetchSpy as unknown as typeof fetch;

      const provider = new BunnyStreamVideoProvider(config);
      const metadata = await provider.fetchVideoMetadata({ videoId: 'bunny-video-guid' });

      expect(metadata).toEqual({ durationSeconds: 91 });
      expect(fetchSpy).toHaveBeenCalledTimes(1);
      const [url, init] = fetchSpy.mock.calls[0] as [string, RequestInit & { headers: Record<string, string> }];
      expect(url).toBe('https://video.bunnycdn.com/library/123456/videos/bunny-video-guid');
      expect(init.method).toBe('GET');
      expect(init.headers.AccessKey).toBe('test-bunny-api-key');
      expect(JSON.stringify(init)).not.toContain('test-bunny-webhook-secret');
    });

    it('resolves with a null duration, not an error, when Bunny reports no usable length', async () => {
      for (const length of [undefined, null, -5, 'not-a-number', 0.5]) {
        global.fetch = jest.fn().mockResolvedValue({
          ok: true,
          json: () => Promise.resolve({ guid: 'bunny-video-guid', length }),
        }) as unknown as typeof fetch;

        const provider = new BunnyStreamVideoProvider(config);
        await expect(provider.fetchVideoMetadata({ videoId: 'bunny-video-guid' })).resolves.toEqual({
          durationSeconds: null,
        });
      }
    });

    it('rejects with a typed error on a non-OK response, without inventing a duration', async () => {
      global.fetch = jest.fn().mockResolvedValue({ ok: false, json: () => Promise.resolve({}) }) as unknown as typeof fetch;

      const provider = new BunnyStreamVideoProvider(config);
      await expect(provider.fetchVideoMetadata({ videoId: 'bunny-video-guid' })).rejects.toThrow(
        VideoProviderMetadataFetchFailedError,
      );
    });

    it('rejects with a typed error on a network failure', async () => {
      global.fetch = jest.fn().mockRejectedValue(new Error('network down')) as unknown as typeof fetch;

      const provider = new BunnyStreamVideoProvider(config);
      await expect(provider.fetchVideoMetadata({ videoId: 'bunny-video-guid' })).rejects.toThrow(
        VideoProviderMetadataFetchFailedError,
      );
    });

    it('rejects with a typed error when the response body is not valid JSON', async () => {
      global.fetch = jest.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.reject(new Error('invalid JSON')),
      }) as unknown as typeof fetch;

      const provider = new BunnyStreamVideoProvider(config);
      await expect(provider.fetchVideoMetadata({ videoId: 'bunny-video-guid' })).rejects.toThrow(
        VideoProviderMetadataFetchFailedError,
      );
    });
  });
});
