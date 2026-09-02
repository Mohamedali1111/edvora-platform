import assert from 'node:assert/strict';
import test from 'node:test';
import { ApiError } from '../../../lib/api/errors';
import { mapVideoAccessError } from './video-error-mapping';

test('mapVideoAccessError maps LESSON_NOT_FOUND to the honest "not available" copy', () => {
  assert.equal(
    mapVideoAccessError(new ApiError({ kind: 'backend', code: 'LESSON_NOT_FOUND', message: 'x' })),
    'video.error.notAvailable',
  );
});

test('mapVideoAccessError maps signing/provider-invariant failures to a distinct code', () => {
  assert.equal(
    mapVideoAccessError(new ApiError({ kind: 'backend', code: 'VIDEO_PLAYBACK_SIGNING_FAILED', message: 'x' })),
    'video.error.signingFailed',
  );
  assert.equal(
    mapVideoAccessError(new ApiError({ kind: 'backend', code: 'VIDEO_ASSET_PROVIDER_INVARIANT_VIOLATION', message: 'x' })),
    'video.error.signingFailed',
  );
});

test('mapVideoAccessError maps network failures and falls back safely for anything else', () => {
  assert.equal(mapVideoAccessError(new ApiError({ kind: 'network', code: 'NETWORK_UNAVAILABLE', message: 'x' })), 'video.error.network');
  assert.equal(mapVideoAccessError(new ApiError({ kind: 'backend', code: 'SOME_OTHER_CODE', message: 'x' })), 'video.error.generic');
  assert.equal(mapVideoAccessError(new Error('not an ApiError')), 'video.error.generic');
});
