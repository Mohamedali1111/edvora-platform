import assert from 'node:assert/strict';
import test from 'node:test';
import { ApiError } from '../../../lib/api/errors';
import { mapDocumentAccessError } from './document-error-mapping';

test('mapDocumentAccessError maps LESSON_NOT_FOUND to the honest "not available" copy', () => {
  assert.equal(
    mapDocumentAccessError(new ApiError({ kind: 'backend', code: 'LESSON_NOT_FOUND', message: 'x' })),
    'document.error.notAvailable',
  );
});

test('mapDocumentAccessError maps a storage invariant violation to a distinct code', () => {
  assert.equal(
    mapDocumentAccessError(
      new ApiError({ kind: 'backend', code: 'DOCUMENT_ASSET_STORAGE_INVARIANT_VIOLATION', message: 'x' }),
    ),
    'document.error.signingFailed',
  );
});

test('mapDocumentAccessError maps network failures and falls back safely for anything else', () => {
  assert.equal(
    mapDocumentAccessError(new ApiError({ kind: 'network', code: 'NETWORK_UNAVAILABLE', message: 'x' })),
    'document.error.network',
  );
  assert.equal(
    mapDocumentAccessError(new ApiError({ kind: 'backend', code: 'SOME_OTHER_CODE', message: 'x' })),
    'document.error.generic',
  );
  assert.equal(mapDocumentAccessError(new Error('not an ApiError')), 'document.error.generic');
});
