import { Prisma } from '../../../../.generated/prisma/client';

export function isKnownUniqueViolation(error: unknown, ...constraints: string[]): boolean {
  if (!isPrismaUniqueViolation(error)) {
    return false;
  }

  const target = error.meta?.target;
  if (typeof target === 'string') {
    return constraints.includes(target);
  }

  if (!Array.isArray(target)) {
    return false;
  }

  return constraints.some((constraint) => target.includes(constraint));
}

export function isPrismaUniqueViolation(
  error: unknown,
): error is Prisma.PrismaClientKnownRequestError {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002';
}
