import assert from "node:assert/strict";
import test from "node:test";
import { AuthService, AccessTokenStore, validateLoginInput } from "./auth";
import { ApiClient } from "./client";

test("validates instructor login input before submitting", () => {
  assert.deepEqual(validateLoginInput("", ""), { email: "required", password: "required" });
  assert.deepEqual(validateLoginInput("bad-email", "password"), { email: "invalid" });
  assert.deepEqual(validateLoginInput("instructor@example.test", "password"), {});
});

test("bootstraps a successful instructor session through auth/me and tenant context", async () => {
  const tokenStore = new AccessTokenStore();
  const calls: string[] = [];
  const authHeaders: Array<string | null> = [];
  const api = new ApiClient({
    baseUrl: "http://api.test",
    getAccessToken: () => tokenStore.get(),
    setAccessToken: (token) => tokenStore.set(token),
    fetchFn: async (input, init) => {
      const url = String(input);
      calls.push(url);
      authHeaders.push(new Headers(init?.headers).get("authorization"));

      if (url.endsWith("/auth/refresh")) {
        return json({ accessToken: "access", accessTokenExpiresAt: "2026-08-31T08:10:00.000Z", sessionId: "s1", user: { id: "u1", role: "INSTRUCTOR" } });
      }

      if (url.endsWith("/auth/me")) {
        return json({ userId: "u1", role: "INSTRUCTOR", email: "teach@example.test", displayName: "Teacher", preferredLanguage: "EN" });
      }

      if (url.endsWith("/instructor/tenants")) {
        return json({ items: [{ tenantId: "t1", name: "Academy", slug: "academy", status: "ACTIVE", membershipRole: "OWNER" }] });
      }

      return json({ tenantId: "t1", name: "Academy", slug: "academy", status: "ACTIVE", membershipRole: "OWNER" });
    },
  });
  const auth = new AuthService({ api, tokenStore });

  const session = await auth.bootstrap();

  assert.equal(session.status, "authenticated");
  assert.equal(session.user?.role, "INSTRUCTOR");
  assert.equal(session.tenant?.tenantId, "t1");
  assert.deepEqual(calls, [
    "http://api.test/auth/refresh",
    "http://api.test/auth/me",
    "http://api.test/instructor/tenants",
    "http://api.test/instructor/tenants/t1/context",
  ]);
  // The token minted by /auth/refresh must be the one used for /auth/me and later calls.
  assert.deepEqual(authHeaders, [null, "Bearer access", "Bearer access", "Bearer access"]);
});

test("reload-style bootstrap with no memory token calls /auth/refresh with credentials included", async () => {
  const tokenStore = new AccessTokenStore();
  let refreshRequest: RequestInit | undefined;
  const api = new ApiClient({
    baseUrl: "http://api.test",
    getAccessToken: () => tokenStore.get(),
    setAccessToken: (token) => tokenStore.set(token),
    fetchFn: async (input, init) => {
      const url = String(input);

      if (url.endsWith("/auth/refresh")) {
        refreshRequest = init;
        return json({ accessToken: "restored", accessTokenExpiresAt: "2026-08-31T08:10:00.000Z", sessionId: "s1", user: { id: "u1", role: "INSTRUCTOR" } });
      }

      if (url.endsWith("/auth/me")) {
        return json({ userId: "u1", role: "INSTRUCTOR", email: "teach@example.test", displayName: "Teacher", preferredLanguage: "EN" });
      }

      if (url.endsWith("/instructor/tenants")) {
        return json({ items: [] });
      }

      throw new Error(`Unexpected request ${url}`);
    },
  });
  const auth = new AuthService({ api, tokenStore });

  const session = await auth.bootstrap();

  assert.equal(tokenStore.get(), "restored");
  assert.equal(session.status, "forbidden"); // no tenants for this instructor, but auth succeeded
  assert.equal(refreshRequest?.credentials, "include");
});

test("clears the memory token and reports anonymous when the backend refresh fails", async () => {
  const tokenStore = new AccessTokenStore();
  const api = new ApiClient({
    baseUrl: "http://api.test",
    getAccessToken: () => tokenStore.get(),
    setAccessToken: (token) => tokenStore.set(token),
    fetchFn: async (input) => {
      if (String(input).endsWith("/auth/refresh")) {
        return new Response(JSON.stringify({ error: { code: "INVALID_REFRESH_SESSION", message: "Session expired." } }), {
          status: 401,
          headers: { "Content-Type": "application/json" },
        });
      }

      throw new Error("Unexpected request: only /auth/refresh should be called when there is no memory token");
    },
  });
  const auth = new AuthService({ api, tokenStore });

  const session = await auth.bootstrap();

  assert.equal(session.status, "anonymous");
  assert.equal(session.accessToken, null);
  assert.equal(tokenStore.get(), null);
});

test("keeps the access token in memory only and never reads or writes browser storage", async () => {
  const storageCalls: string[] = [];
  const watchedStorage = (label: string): Storage =>
    ({
      getItem: () => {
        storageCalls.push(`${label}.getItem`);
        return null;
      },
      setItem: () => {
        storageCalls.push(`${label}.setItem`);
      },
      removeItem: () => {
        storageCalls.push(`${label}.removeItem`);
      },
      clear: () => storageCalls.push(`${label}.clear`),
      key: () => null,
      length: 0,
    }) as Storage;

  const globalWithWindow = globalThis as Record<string, unknown>;
  const hadWindow = "window" in globalWithWindow;
  const previousWindow = globalWithWindow.window;
  globalWithWindow.window = {
    sessionStorage: watchedStorage("sessionStorage"),
    localStorage: watchedStorage("localStorage"),
  };

  try {
    const tokenStore = new AccessTokenStore();
    const api = new ApiClient({
      baseUrl: "http://api.test",
      getAccessToken: () => tokenStore.get(),
      setAccessToken: (token) => tokenStore.set(token),
      fetchFn: async (input) => {
        const url = String(input);

        if (url.endsWith("/auth/login")) {
          return json({ accessToken: "secret-access", accessTokenExpiresAt: "2026-08-31T08:10:00.000Z", sessionId: "s1", user: { id: "u1", role: "INSTRUCTOR" } });
        }

        if (url.endsWith("/auth/me")) {
          return json({ userId: "u1", role: "INSTRUCTOR", email: "teach@example.test", displayName: "Teacher", preferredLanguage: "EN" });
        }

        if (url.endsWith("/instructor/tenants")) {
          return json({ items: [{ tenantId: "t1", name: "Academy", slug: "academy", status: "ACTIVE", membershipRole: "OWNER" }] });
        }

        return json({ tenantId: "t1", name: "Academy", slug: "academy", status: "ACTIVE", membershipRole: "OWNER" });
      },
    });
    const auth = new AuthService({ api, tokenStore });

    const session = await auth.login("teach@example.test", "correct-password");

    assert.equal(session.accessToken, "secret-access");
    assert.equal(tokenStore.get(), "secret-access");
    assert.deepEqual(storageCalls, []);
  } finally {
    if (hadWindow) {
      globalWithWindow.window = previousWindow;
    } else {
      delete globalWithWindow.window;
    }
  }
});

test("rejects non-instructor identities and clears the session", async () => {
  const tokenStore = new AccessTokenStore();
  tokenStore.set("student-access");
  let logoutCalled = false;
  const api = new ApiClient({
    baseUrl: "http://api.test",
    getAccessToken: () => tokenStore.get(),
    setAccessToken: (token) => tokenStore.set(token),
    fetchFn: async (input) => {
      const url = String(input);

      if (url.endsWith("/auth/me")) {
        return json({ userId: "u1", role: "STUDENT", email: "student@example.test", displayName: null, preferredLanguage: "EN" });
      }

      if (url.endsWith("/auth/logout")) {
        logoutCalled = true;
        return new Response(null, { status: 204 });
      }

      throw new Error(`Unexpected request ${url}`);
    },
  });

  const session = await new AuthService({ api, tokenStore }).bootstrap();

  assert.equal(session.status, "forbidden");
  assert.equal(logoutCalled, true);
  assert.equal(tokenStore.get(), null);
});

test("coalesces concurrent web refresh attempts", async () => {
  const tokenStore = new AccessTokenStore();
  let refreshCount = 0;
  const api = new ApiClient({
    baseUrl: "http://api.test",
    getAccessToken: () => tokenStore.get(),
    setAccessToken: (token) => tokenStore.set(token),
    fetchFn: async (input) => {
      if (String(input).endsWith("/auth/refresh")) {
        refreshCount += 1;
        await new Promise((resolve) => setTimeout(resolve, 10));
        return json({ accessToken: "access", accessTokenExpiresAt: "2026-08-31T08:10:00.000Z", sessionId: "s1", user: { id: "u1", role: "INSTRUCTOR" } });
      }

      throw new Error("Unexpected request");
    },
  });
  const auth = new AuthService({ api, tokenStore });
  const [first, second] = await Promise.all([auth.refreshAccessToken(), auth.refreshAccessToken()]);

  assert.equal(first, "access");
  assert.equal(second, "access");
  assert.equal(refreshCount, 1);
});

test("logout calls the backend and clears the browser token", async () => {
  const tokenStore = new AccessTokenStore();
  tokenStore.set("access");
  let method = "";
  const api = new ApiClient({
    baseUrl: "http://api.test",
    getAccessToken: () => tokenStore.get(),
    setAccessToken: (token) => tokenStore.set(token),
    fetchFn: async (_input, init) => {
      method = init?.method ?? "";
      return new Response(null, { status: 204 });
    },
  });

  await new AuthService({ api, tokenStore }).logout();

  assert.equal(method, "POST");
  assert.equal(tokenStore.get(), null);
});

function json(body: unknown, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "Content-Type": "application/json" },
    ...init,
  });
}
