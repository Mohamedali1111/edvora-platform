"use client";

import { AuthService } from "./auth";

let authService: AuthService | null = null;

export function getAuthService(): AuthService {
  authService ??= new AuthService();
  return authService;
}
