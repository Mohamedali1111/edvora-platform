import { ApiClient, ApiError } from "./client";
import type { CurrentUser, LoginResponse, TenantContext, TenantListResponse } from "./types";

export type SessionSnapshot = {
  accessToken: string | null;
  user: CurrentUser | null;
  tenant: TenantContext | null;
  status: "anonymous" | "authenticated" | "forbidden" | "expired" | "api-unavailable";
};

/**
 * Holds the access token in JavaScript runtime memory only. It must never be
 * written to sessionStorage, localStorage, or a client-readable cookie: a
 * full page reload or new tab always starts with an empty store, and the
 * session is restored by calling /auth/refresh against the backend's
 * HttpOnly refresh cookie (see AuthService.bootstrap).
 */
export class AccessTokenStore {
  private token: string | null = null;

  get(): string | null {
    return this.token;
  }

  set(token: string | null): void {
    this.token = token;
  }
}

export type AuthServiceOptions = {
  api?: ApiClient;
  tokenStore?: AccessTokenStore;
};

export class AuthService {
  private readonly tokenStore: AccessTokenStore;
  private readonly api: ApiClient;
  private refreshPromise: Promise<string | null> | null = null;

  constructor(options: AuthServiceOptions = {}) {
    this.tokenStore = options.tokenStore ?? new AccessTokenStore();
    this.api =
      options.api ??
      new ApiClient({
        getAccessToken: () => this.tokenStore.get(),
        setAccessToken: (token) => this.tokenStore.set(token),
        refresh: () => this.refreshAccessToken(),
      });
  }

  /**
   * The shared, authenticated ApiClient instance - same token store, same
   * coalesced-refresh behavior. Feature areas (e.g. the instructor overview
   * data layer) should reuse this rather than constructing their own client.
   */
  getClient(): ApiClient {
    return this.api;
  }

  async login(email: string, password: string): Promise<SessionSnapshot> {
    const session = await this.api.request<LoginResponse>("/auth/login", {
      method: "POST",
      auth: false,
      body: { email, password, channel: "WEB" },
    });
    this.tokenStore.set(session.accessToken);
    return this.bootstrap();
  }

  async bootstrap(): Promise<SessionSnapshot> {
    if (!this.tokenStore.get()) {
      const refreshed = await this.refreshAccessToken();

      if (!refreshed) {
        return emptySession("anonymous");
      }
    }

    try {
      const user = await this.api.request<CurrentUser>("/auth/me");

      if (user.role !== "INSTRUCTOR") {
        await this.logout();
        return { ...emptySession("forbidden"), user };
      }

      const tenants = await this.api.request<TenantListResponse>("/instructor/tenants");
      const firstTenant = tenants.items[0] ?? null;

      if (!firstTenant) {
        return { accessToken: this.tokenStore.get(), user, tenant: null, status: "forbidden" };
      }

      const tenant = await this.api.request<TenantContext>(`/instructor/tenants/${firstTenant.tenantId}/context`);

      return { accessToken: this.tokenStore.get(), user, tenant, status: "authenticated" };
    } catch (error) {
      if (error instanceof ApiError && error.kind === "network") {
        return emptySession("api-unavailable");
      }

      if (error instanceof ApiError && (error.status === 401 || error.code === "INVALID_REFRESH_SESSION")) {
        this.tokenStore.set(null);
        return emptySession("expired");
      }

      if (error instanceof ApiError && error.status === 403) {
        await this.logout();
        return emptySession("forbidden");
      }

      throw error;
    }
  }

  /**
   * Platform Admin's own login entry point - kept fully separate from
   * `login()`/`bootstrap()` above (which are hard-coded to the INSTRUCTOR
   * role and an instructor tenant fetch, and are exercised by tests that
   * pin that exact behavior) rather than adding a role parameter to either.
   * Shares the same token store, ApiClient, and refresh coalescing - only
   * the expected role and the absence of a tenant context differ.
   */
  async loginAdmin(email: string, password: string): Promise<SessionSnapshot> {
    const session = await this.api.request<LoginResponse>("/auth/login", {
      method: "POST",
      auth: false,
      body: { email, password, channel: "WEB" },
    });
    this.tokenStore.set(session.accessToken);
    return this.bootstrapAdmin();
  }

  async bootstrapAdmin(): Promise<SessionSnapshot> {
    if (!this.tokenStore.get()) {
      const refreshed = await this.refreshAccessToken();

      if (!refreshed) {
        return emptySession("anonymous");
      }
    }

    try {
      const user = await this.api.request<CurrentUser>("/auth/me");

      if (user.role !== "PLATFORM_ADMIN") {
        await this.logout();
        return { ...emptySession("forbidden"), user };
      }

      return { accessToken: this.tokenStore.get(), user, tenant: null, status: "authenticated" };
    } catch (error) {
      if (error instanceof ApiError && error.kind === "network") {
        return emptySession("api-unavailable");
      }

      if (error instanceof ApiError && (error.status === 401 || error.code === "INVALID_REFRESH_SESSION")) {
        this.tokenStore.set(null);
        return emptySession("expired");
      }

      if (error instanceof ApiError && error.status === 403) {
        await this.logout();
        return emptySession("forbidden");
      }

      throw error;
    }
  }

  async logout(): Promise<void> {
    try {
      if (this.tokenStore.get()) {
        await this.api.request<void>("/auth/logout", { method: "POST", retryOnUnauthorized: false });
      }
    } finally {
      this.tokenStore.set(null);
    }
  }

  async refreshAccessToken(): Promise<string | null> {
    if (!this.refreshPromise) {
      this.refreshPromise = this.api
        .request<LoginResponse>("/auth/refresh", {
          method: "POST",
          auth: false,
          retryOnUnauthorized: false,
          body: { channel: "WEB" },
        })
        .then((session) => {
          this.tokenStore.set(session.accessToken);
          return session.accessToken;
        })
        .catch((error: unknown) => {
          if (error instanceof ApiError && error.kind === "network") {
            throw error;
          }

          this.tokenStore.set(null);
          return null;
        })
        .finally(() => {
          this.refreshPromise = null;
        });
    }

    return this.refreshPromise;
  }
}

export function validateLoginInput(email: string, password: string): { email?: string; password?: string } {
  const errors: { email?: string; password?: string } = {};
  const trimmedEmail = email.trim();

  if (!trimmedEmail) {
    errors.email = "required";
  } else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmedEmail)) {
    errors.email = "invalid";
  }

  if (!password) {
    errors.password = "required";
  }

  return errors;
}

function emptySession(status: SessionSnapshot["status"]): SessionSnapshot {
  return { accessToken: null, user: null, tenant: null, status };
}
