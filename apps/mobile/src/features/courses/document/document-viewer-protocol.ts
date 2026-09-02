import type { TranslationKey } from '../../../lib/i18n/translations';

// Pure message contract between the Document Lesson screen (React Native) and
// the sandboxed local pdf.js viewer running inside the WebView (see
// document-viewer-html.ts). The signed R2 download URL only ever crosses this
// boundary via `buildViewerLoadCommand`'s `postMessage` payload — never via
// the WebView's `source`/navigation — so it never appears in navigation
// history or a route param (see the milestone report's "R2 Capability
// Security" section).

export type ViewerErrorReason = 'fetch' | 'render' | 'unknown';

export type ViewerInboundMessage =
  | { type: 'ready' }
  | { type: 'rendered'; pageCount: number }
  | { type: 'error'; reason: ViewerErrorReason; message?: string };

/**
 * Parses a raw `onMessage` event payload from the viewer WebView. Returns
 * `null` for anything that isn't a recognized, well-formed message — the
 * caller treats that as simply ignorable, never as a crash or a fake success
 * (a WebView is an untrusted-ish surface even when it only ever runs code
 * this app bundled itself; parsing defensively costs nothing here).
 */
export function parseViewerMessage(raw: string): ViewerInboundMessage | null {
  let data: unknown;

  try {
    data = JSON.parse(raw);
  } catch {
    return null;
  }

  if (!data || typeof data !== 'object') {
    return null;
  }

  const message = data as Record<string, unknown>;

  if (message.type === 'ready') {
    return { type: 'ready' };
  }

  if (message.type === 'rendered' && typeof message.pageCount === 'number') {
    return { type: 'rendered', pageCount: message.pageCount };
  }

  if (
    message.type === 'error' &&
    (message.reason === 'fetch' || message.reason === 'render' || message.reason === 'unknown')
  ) {
    return {
      type: 'error',
      reason: message.reason,
      message: typeof message.message === 'string' ? message.message : undefined,
    };
  }

  return null;
}

/**
 * Builds the one command this screen ever sends into the viewer: load and
 * render this exact signed URL. Sent exactly once per WebView instance, right
 * after the viewer reports `{type:'ready'}` — see document-lesson-screen.tsx.
 */
export function buildViewerLoadCommand(input: { url: string; fileName: string }): string {
  return JSON.stringify({ type: 'load', url: input.url, fileName: input.fileName });
}

export type DocumentViewerPhase = 'connecting' | 'loadingDocument' | 'displayed' | 'error';

export type DocumentViewerState = {
  phase: DocumentViewerPhase;
  errorReason?: ViewerErrorReason;
};

export function initialDocumentViewerState(): DocumentViewerState {
  return { phase: 'connecting' };
}

/**
 * Pure state transition for every inbound viewer message. `'ready'` means the
 * viewer's own JS finished loading and is waiting for the load command this
 * screen sends right after; `'rendered'` and `'error'` are terminal for a
 * given WebView instance — a retry remounts a fresh one rather than trying to
 * recover this state machine in place (see document-lesson-screen.tsx).
 */
export function reduceDocumentViewerEvent(
  state: DocumentViewerState,
  event: ViewerInboundMessage,
): DocumentViewerState {
  if (event.type === 'ready') {
    return { phase: 'loadingDocument' };
  }

  if (event.type === 'rendered') {
    return { phase: 'displayed' };
  }

  return { phase: 'error', errorReason: event.reason };
}

/**
 * One honest copy for every in-viewer failure reason — see the milestone
 * report's "Error Handling" section for why this deliberately doesn't try to
 * further distinguish a fetch failure from a render failure to the student;
 * both mean the same thing to them ("couldn't show this document, try
 * again"), and neither implies a backend entitlement problem.
 */
export function mapViewerErrorReason(_reason: ViewerErrorReason): TranslationKey {
  return 'document.viewerError';
}

/**
 * Defensive against a future vendored pdf.js source containing a literal
 * "</script" sequence, which would prematurely close the inline <script> tag
 * that text is embedded in (see document-viewer-html.ts). A no-op today
 * (verified against the currently vendored build — see pdfjs/README.md) but
 * cheap insurance against a future version bump.
 */
export function escapeForInlineScript(source: string): string {
  return source.replace(/<\/(script)/gi, '<\\/$1');
}
