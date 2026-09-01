import assert from "node:assert/strict";
import test from "node:test";
import { ApiClient, ApiError, normalizeBaseUrl } from "./client";

test("normalizes API base URLs", () => {
  assert.equal(normalizeBaseUrl("http://localhost:3001/"), "http://localhost:3001");
});

test("the default fetchFn (no fetchFn option given) is called with a valid receiver - regression for a real-browser-only bug every other test's injected fetchFn masked", async () => {
  // Every other test in this file passes its own `fetchFn`, so none of them exercise the
  // `options.fetchFn ?? fetch...` default this test targets. A real browser's native `fetch`
  // enforces (via WebIDL) that it's invoked with `this === window` (or another Window-like
  // receiver); storing the bare global reference and later calling it as `this.fetchFn(...)`
  // (`this` bound to the ApiClient instance) throws "Illegal invocation" there - caught by
  // ApiClient's own try/catch and silently rewrapped as a generic network ApiError, so every
  // request in the app would fail this way outside of tests. This test stands in a receiver-
  // sensitive `fetch` (mimicking that browser behavior) as `globalThis.fetch` and constructs an
  // ApiClient with no `fetchFn` override, so it exercises the exact default-binding code path a
  // real browser does.
  const originalFetch = globalThis.fetch;
  let sawReceiver: unknown;

  globalThis.fetch = function receiverSensitiveFetch(this: unknown, ...args: unknown[]) {
    // Deliberately capturing the call-site receiver to assert on, mirroring the WebIDL branding
    // check a real browser's native `fetch` performs (and that this whole test exists to guard
    // against regressing).
    // eslint-disable-next-line @typescript-eslint/no-this-alias
    const receiver: unknown = this;
    sawReceiver = receiver;
    if (receiver !== globalThis) {
      throw new TypeError("Failed to execute 'fetch' on 'Window': Illegal invocation");
    }
    return originalFetch.call(globalThis, ...(args as Parameters<typeof fetch>));
  } as typeof fetch;

  try {
    const api = new ApiClient({ baseUrl: "http://api.test" });
    // Any request exercises `this.fetchFn(...)` - the network error this throws on a real offline
    // "http://api.test" host is expected and irrelevant; what matters is *how* it fails.
    await assert.rejects(api.request("/auth/me"), (error) => {
      assert.equal(error instanceof ApiError, true);
      assert.equal((error as ApiError).kind, "network");
      return true;
    });
    assert.equal(sawReceiver, globalThis, "fetch must be invoked with a valid Window-like receiver, not the ApiClient instance");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("maps backend error envelopes without exposing raw response bodies", async () => {
  const api = new ApiClient({
    baseUrl: "http://api.test",
    fetchFn: async () =>
      new Response(JSON.stringify({ error: { code: "INVALID_CREDENTIALS", message: "Invalid credentials." } }), {
        status: 401,
        headers: { "Content-Type": "application/json" },
      }),
  });

  await assert.rejects(api.request("/auth/login", { method: "POST", auth: false }), (error) => {
    assert.equal(error instanceof ApiError, true);
    assert.equal((error as ApiError).kind, "backend");
    assert.equal((error as ApiError).code, "INVALID_CREDENTIALS");
    assert.equal((error as ApiError).status, 401);
    return true;
  });
});

test("distinguishes network failures from backend failures", async () => {
  const api = new ApiClient({
    baseUrl: "http://api.test",
    fetchFn: async () => {
      throw new Error("offline");
    },
  });

  await assert.rejects(api.request("/auth/me"), (error) => {
    assert.equal(error instanceof ApiError, true);
    assert.equal((error as ApiError).kind, "network");
    assert.equal((error as ApiError).code, "NETWORK_UNAVAILABLE");
    return true;
  });
});

test("shares one refresh across concurrent 401s and retries each request exactly once", async () => {
  let refreshCalls = 0;
  let currentToken = "expired";
  let pendingRefresh: Promise<string | null> | null = null;

  function coalescedRefresh(): Promise<string | null> {
    pendingRefresh ??= (async () => {
      refreshCalls += 1;
      await new Promise((resolve) => setTimeout(resolve, 10));
      return "fresh-token";
    })().finally(() => {
      pendingRefresh = null;
    });

    return pendingRefresh;
  }

  const attempts: Record<string, number> = { "/auth/me": 0, "/instructor/tenants": 0 };

  const api = new ApiClient({
    baseUrl: "http://api.test",
    getAccessToken: () => currentToken,
    setAccessToken: (token) => {
      currentToken = token ?? "";
    },
    refresh: coalescedRefresh,
    fetchFn: async (input, init) => {
      const url = String(input);
      const path = url.replace("http://api.test", "");
      attempts[path] = (attempts[path] ?? 0) + 1;

      const authHeader = new Headers(init?.headers).get("authorization");

      if (authHeader !== "Bearer fresh-token") {
        return new Response(JSON.stringify({ error: { code: "TOKEN_EXPIRED", message: "Access token expired." } }), {
          status: 401,
          headers: { "Content-Type": "application/json" },
        });
      }

      return new Response(JSON.stringify({ ok: true }), { status: 200, headers: { "Content-Type": "application/json" } });
    },
  });

  const [me, tenants] = await Promise.all([api.request("/auth/me"), api.request("/instructor/tenants")]);

  assert.deepEqual(me, { ok: true });
  assert.deepEqual(tenants, { ok: true });
  // Exactly one refresh call: no refresh storm from concurrent 401s.
  assert.equal(refreshCalls, 1);
  // Exactly one retry per request after the shared refresh resolves: no infinite retry loop.
  assert.equal(attempts["/auth/me"], 2);
  assert.equal(attempts["/instructor/tenants"], 2);
});
