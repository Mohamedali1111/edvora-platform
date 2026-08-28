import type { Request } from 'express';
import type { AuthenticatedPrincipal } from './authenticated-principal';

export type AuthenticatedRequest = Request & {
  auth?: AuthenticatedPrincipal;
};
