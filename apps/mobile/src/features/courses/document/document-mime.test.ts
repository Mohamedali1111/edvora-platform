import assert from 'node:assert/strict';
import test from 'node:test';
import { isSupportedDocumentMime } from './document-mime';

test('isSupportedDocumentMime accepts the frozen V1 PDF-only contract', () => {
  assert.equal(isSupportedDocumentMime('application/pdf'), true);
});

test('isSupportedDocumentMime rejects anything outside the V1 contract', () => {
  assert.equal(isSupportedDocumentMime('application/msword'), false);
  assert.equal(isSupportedDocumentMime('image/png'), false);
  assert.equal(isSupportedDocumentMime('application/vnd.openxmlformats-officedocument.wordprocessingml.document'), false);
  assert.equal(isSupportedDocumentMime(''), false);
});
