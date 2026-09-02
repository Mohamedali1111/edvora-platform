import pdfLibSource from './pdfjs/pdf-lib-source.json';
import pdfWorkerSource from './pdfjs/pdf-worker-source.json';
import { escapeForInlineScript } from './document-viewer-protocol';

/**
 * A fully self-contained, static HTML document: vendored pdf.js (see
 * pdfjs/README.md for provenance) plus a minimal renderer, with no
 * `<script src>`, `fetch`, or `import` to anything outside this string, and
 * no reference to any Edvora URL, credential, or document identifier baked
 * in. Built exactly once per app process — this module exports the already-
 * computed constant, not a function — and reused verbatim across every
 * Document Lesson: the document itself is never baked into this HTML, only
 * requested at runtime via `postMessage` (see document-viewer-protocol.ts)
 * after the WebView reports `{type:'ready'}`.
 *
 * Deliberately renders each page to a plain `<canvas>` rather than pdf.js's
 * own bundled viewer app/text layer: no text selection, no in-document
 * search, no annotation layer, no "open in" / print / download affordance —
 * exactly the "no more than a protected read-only view" surface this
 * milestone calls for (see the milestone report's "Document Lesson Screen"
 * section). `user-select`/`-webkit-touch-callout` are disabled as a
 * best-effort deterrent against the WebView's native long-press "save/copy"
 * affordances — not claimed as airtight, same honesty standard already
 * established for the VIDEO capture-notice copy.
 */
export const DOCUMENT_VIEWER_HTML = buildDocumentViewerHtml();

function buildDocumentViewerHtml(): string {
  const pdfLib = escapeForInlineScript(pdfLibSource);
  const pdfWorker = escapeForInlineScript(pdfWorkerSource);

  return `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=3, user-scalable=yes" />
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'unsafe-inline' blob:; worker-src blob:; connect-src https:; img-src data: blob:; style-src 'unsafe-inline';" />
<style>
  html, body { margin: 0; padding: 0; background: #e9e9ec; }
  * { -webkit-touch-callout: none; -webkit-user-select: none; user-select: none; }
  #pages { display: flex; flex-direction: column; align-items: center; gap: 8px; padding: 8px 0 32px; }
  canvas { max-width: 100%; height: auto; box-shadow: 0 1px 4px rgba(0, 0, 0, 0.25); background: #fff; }
</style>
</head>
<body>
<div id="pages"></div>
<script id="pdfjs-worker-src" type="text/plain">${pdfWorker}</script>
<script>${pdfLib}</script>
<script>
(function () {
  function post(message) {
    if (window.ReactNativeWebView && window.ReactNativeWebView.postMessage) {
      window.ReactNativeWebView.postMessage(JSON.stringify(message));
    }
  }

  var container = document.getElementById('pages');
  var started = false;

  try {
    var workerText = document.getElementById('pdfjs-worker-src').textContent;
    var workerBlob = new Blob([workerText], { type: 'text/javascript' });
    pdfjsLib.GlobalWorkerOptions.workerSrc = URL.createObjectURL(workerBlob);
  } catch (err) {
    post({ type: 'error', reason: 'unknown', message: String(err && err.message) });
  }

  async function renderDocument(url) {
    var response;

    try {
      response = await fetch(url, { cache: 'no-store', credentials: 'omit' });
    } catch (err) {
      post({ type: 'error', reason: 'fetch', message: String(err && err.message) });
      return;
    }

    if (!response.ok) {
      post({ type: 'error', reason: 'fetch', message: 'HTTP ' + response.status });
      return;
    }

    try {
      var buffer = await response.arrayBuffer();
      var pdf = await pdfjsLib.getDocument({ data: new Uint8Array(buffer) }).promise;
      var containerWidth = Math.max(container.clientWidth, 1);

      for (var pageNumber = 1; pageNumber <= pdf.numPages; pageNumber++) {
        var page = await pdf.getPage(pageNumber);
        var baseViewport = page.getViewport({ scale: 1 });
        var scale = Math.min(3, (window.devicePixelRatio || 1) * (containerWidth / baseViewport.width));
        var viewport = page.getViewport({ scale: scale });
        var canvas = document.createElement('canvas');
        canvas.width = viewport.width;
        canvas.height = viewport.height;
        canvas.style.width = '100%';
        container.appendChild(canvas);
        await page.render({ canvasContext: canvas.getContext('2d'), viewport: viewport }).promise;
      }

      post({ type: 'rendered', pageCount: pdf.numPages });
    } catch (err) {
      post({ type: 'error', reason: 'render', message: String(err && err.message) });
    }
  }

  function handleMessage(event) {
    if (started) {
      return;
    }

    var raw = event && event.data;

    if (typeof raw !== 'string') {
      return;
    }

    var message;

    try {
      message = JSON.parse(raw);
    } catch (err) {
      return;
    }

    if (message && message.type === 'load' && typeof message.url === 'string') {
      started = true;
      renderDocument(message.url);
    }
  }

  // react-native-webview delivers an injected postMessage via \`document\` on
  // Android and \`window\` on iOS — a documented cross-platform quirk, so both
  // are wired here.
  document.addEventListener('message', handleMessage);
  window.addEventListener('message', handleMessage);

  post({ type: 'ready' });
})();
</script>
</body>
</html>`;
}
