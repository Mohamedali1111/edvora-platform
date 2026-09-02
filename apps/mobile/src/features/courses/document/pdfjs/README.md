# Vendored pdf.js

`pdf-lib-source.json` and `pdf-worker-source.json` each hold, as a single JSON
string, the verbatim minified contents of one file from Mozilla's `pdfjs-dist`
npm package, version **3.11.174** (`legacy/build/pdf.min.js` and
`legacy/build/pdf.worker.min.js`), licensed under Apache-2.0. See
`https://www.npmjs.com/package/pdfjs-dist/v/3.11.174`.

This is the last `pdfjs-dist` release line that still ships a classic
(non-ES-module) `<script>`-tag build exposing a global `pdfjsLib` — later
majors moved to ESM-only builds, which would need `type="module"` imports and
a real static-asset base URL inside the WebView. Embedding the classic build
as an inline `<script>` string instead lets `document-viewer-html.ts` build one
fully self-contained, static HTML document with no `<script src>`, `fetch`, or
`import` to anything outside itself — see that file's own doc comment.

**Why JSON, not a `.js` file the app imports as code:** these files are never
executed by the app's own JS — they are read as plain text and inlined into
the WebView's HTML by `document-viewer-html.ts`. Storing them as a JSON string
(`JSON.stringify`'d once, checked in as-is) sidesteps needing any Metro
asset-extension configuration and gets robust escaping for free.

**Updating the vendored version:** re-run the same extraction against a newer
`pdfjs-dist@3.x` release if one ships (do not jump to a `4.x` ESM-only build
without also reworking `document-viewer-html.ts`'s loading strategy), and
re-verify with `document-viewer-protocol.test.ts`'s
`escapeForInlineScript` guard that the new source still contains no literal
`</script` sequence (that guard neutralizes one even if it did, but it's worth
re-confirming the assumption stated there).

## License / attribution

pdf.js is Copyright 2023 Mozilla Foundation, licensed under the
**Apache License, Version 2.0**. `LICENSE` in this directory is the verbatim
license text as published with `pdfjs-dist@3.11.174` (`npm view
pdfjs-dist@3.11.174 license` confirms `Apache-2.0`; the same license also
governs the pdf.js source published at `https://github.com/mozilla/pdfjs-dist`).

No attribution has been stripped by vendoring: both `pdf-lib-source.json` and
`pdf-worker-source.json` hold the minified build output exactly as
`pdfjs-dist` publishes it, including its own embedded `@licstart`/`@licend`
copyright-and-license banner (Apache-2.0 §4(a)/(b) requires preserving
copyright, patent, trademark, and attribution notices in Source or Object
form — that banner is that notice, and it ships unmodified inside the vendored
text itself, not just in this README). Apache-2.0 is permissive and
redistribution-in-a-proprietary-app-compatible; it imposes no copyleft/
share-alike obligation on the rest of this repository. Apache-2.0 does not
require a separate `NOTICE` file unless the upstream project ships one — it
does not (checked against the same `pdfjs-dist@3.11.174` package contents this
vendored code was extracted from).
