import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildViewerLoadCommand,
  escapeForInlineScript,
  initialDocumentViewerState,
  mapViewerErrorReason,
  parseViewerMessage,
  reduceDocumentViewerEvent,
} from './document-viewer-protocol';

test('parseViewerMessage accepts a well-formed "ready" message', () => {
  assert.deepEqual(parseViewerMessage(JSON.stringify({ type: 'ready' })), { type: 'ready' });
});

test('parseViewerMessage accepts a well-formed "rendered" message', () => {
  assert.deepEqual(parseViewerMessage(JSON.stringify({ type: 'rendered', pageCount: 3 })), {
    type: 'rendered',
    pageCount: 3,
  });
});

test('parseViewerMessage accepts a well-formed "error" message with and without a detail message', () => {
  assert.deepEqual(parseViewerMessage(JSON.stringify({ type: 'error', reason: 'fetch' })), {
    type: 'error',
    reason: 'fetch',
    message: undefined,
  });
  assert.deepEqual(parseViewerMessage(JSON.stringify({ type: 'error', reason: 'render', message: 'boom' })), {
    type: 'error',
    reason: 'render',
    message: 'boom',
  });
});

test('parseViewerMessage rejects malformed, unrecognized, or non-JSON payloads', () => {
  assert.equal(parseViewerMessage('not json'), null);
  assert.equal(parseViewerMessage(JSON.stringify({ type: 'rendered', pageCount: 'three' })), null);
  assert.equal(parseViewerMessage(JSON.stringify({ type: 'error', reason: 'made-up' })), null);
  assert.equal(parseViewerMessage(JSON.stringify({ type: 'something-else' })), null);
  assert.equal(parseViewerMessage(JSON.stringify('a string, not an object')), null);
  assert.equal(parseViewerMessage(JSON.stringify(null)), null);
});

test('buildViewerLoadCommand carries the exact url and fileName as JSON', () => {
  const command = buildViewerLoadCommand({ url: 'https://example.r2.cloudflarestorage.com/signed', fileName: 'notes.pdf' });
  assert.deepEqual(JSON.parse(command), {
    type: 'load',
    url: 'https://example.r2.cloudflarestorage.com/signed',
    fileName: 'notes.pdf',
  });
});

test('reduceDocumentViewerEvent transitions connecting -> loadingDocument -> displayed', () => {
  let state = initialDocumentViewerState();
  assert.equal(state.phase, 'connecting');

  state = reduceDocumentViewerEvent(state, { type: 'ready' });
  assert.equal(state.phase, 'loadingDocument');

  state = reduceDocumentViewerEvent(state, { type: 'rendered', pageCount: 5 });
  assert.equal(state.phase, 'displayed');
});

test('reduceDocumentViewerEvent transitions to a terminal error state and records the reason', () => {
  const state = reduceDocumentViewerEvent(initialDocumentViewerState(), {
    type: 'error',
    reason: 'render',
    message: 'boom',
  });
  assert.equal(state.phase, 'error');
  assert.equal(state.errorReason, 'render');
});

test('mapViewerErrorReason returns the one honest in-viewer-error copy for every reason', () => {
  assert.equal(mapViewerErrorReason('fetch'), 'document.viewerError');
  assert.equal(mapViewerErrorReason('render'), 'document.viewerError');
  assert.equal(mapViewerErrorReason('unknown'), 'document.viewerError');
});

test('escapeForInlineScript neutralizes a literal </script sequence without altering safe content', () => {
  assert.equal(escapeForInlineScript('const x = 1;'), 'const x = 1;');
  assert.equal(escapeForInlineScript('var s = "</script>";'), 'var s = "<\\/script>";');
  assert.equal(escapeForInlineScript('</SCRIPT some="attr">'), '<\\/SCRIPT some="attr">');
});
