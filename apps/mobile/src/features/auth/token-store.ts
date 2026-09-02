/**
 * Access token: runtime-memory only, for the lifetime of the JS process. It must
 * never be written to AsyncStorage, SecureStore, or any other persisted location —
 * a cold start always begins with no access token and re-derives one from the
 * persisted refresh session (see session-storage.ts + AuthProvider.bootstrap).
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
