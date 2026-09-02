import { useCallback, useEffect, useRef, useState } from 'react';

export type AsyncDataState<T> =
  | { status: 'loading' }
  | { status: 'success'; data: T }
  | { status: 'error'; error: unknown };

/**
 * Shared fetch-with-loading/error/stale-response-safety pattern for a single
 * screen-scoped read (course detail, a single lesson lookup, ...) — the "My
 * Courses" list has its own bespoke pagination state instead (see
 * my-courses-screen.tsx) since accumulating pages doesn't fit this single-value
 * shape. Not exported for reuse outside a component: this is a hook, not testable
 * under the plain-Node harness, and deliberately kept generic/RN-agnostic (no
 * network/auth code of its own) so it carries no security-relevant logic itself —
 * callers still route their own `error` through the same mapping/recovery helpers
 * every other screen uses.
 *
 * The caller must pass a `useCallback`-memoized `fetcher` (stable identity except
 * when its own real inputs change, e.g. `useCallback(() => fetchX(id), [id])`) —
 * this hook reloads whenever `fetcher`'s identity changes, nothing else. It takes
 * a single callback rather than a caller-supplied dependency array on purpose:
 * the project's lint rules require every dependency array to be a literal written
 * at the call site, which rules out forwarding an arbitrary `deps` array through
 * to an internal `useCallback`/`useEffect`.
 *
 * `requestId` guards against a stale, slow response from a superseded fetch (a
 * fast `reload()`/param change while a previous call is still in flight)
 * overwriting a newer one's result — "abort/stale-response safety where
 * practical" without needing AbortController wiring into ApiClient itself.
 */
export function useAsyncData<T>(fetcher: () => Promise<T>): AsyncDataState<T> & { reload: () => void } {
  const [state, setState] = useState<AsyncDataState<T>>({ status: 'loading' });
  const requestId = useRef(0);

  const load = useCallback(() => {
    const id = ++requestId.current;
    setState({ status: 'loading' });

    fetcher()
      .then((data) => {
        if (requestId.current === id) {
          setState({ status: 'success', data });
        }
      })
      .catch((error: unknown) => {
        if (requestId.current === id) {
          setState({ status: 'error', error });
        }
      });
  }, [fetcher]);

  useEffect(() => {
    // Fetch-on-mount/on-fetcher-change effect — load()'s own setState calls
    // happen after fetcher()'s promise settles, not synchronously within this
    // effect body; see the identical, already-established pattern/rationale in
    // features/auth/auth-context.tsx and features/device/device-context.tsx.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    load();
  }, [load]);

  return { ...state, reload: load };
}
