import type { PlatformRole } from '../../../../.generated/prisma/client';

export type AuthenticatedPrincipal = {
  userId: string;
  sessionId: string;
  platformRole: PlatformRole;
};
