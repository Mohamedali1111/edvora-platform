import { Prisma } from '../../../../.generated/prisma/client';

export function isKnownUniqueViolation(error: unknown, ...constraints: string[]): boolean {
  if (!isPrismaUniqueViolation(error)) {
    return false;
  }

  const normalizedConstraints = constraints.map(normalize);
  const meta = error.meta;

  const target = meta?.target;
  if (typeof target === 'string' && normalizedConstraints.includes(normalize(target))) {
    return true;
  }

  if (
    Array.isArray(target) &&
    target.some((value) => typeof value === 'string' && normalizedConstraints.includes(normalize(value)))
  ) {
    return true;
  }

  // Prisma 7 with `@prisma/adapter-pg` surfaces unique-violation detail under
  // `meta.driverAdapterError.cause` (constraint name in `originalMessage`, violated columns in
  // `constraint.fields`) instead of the historical `meta.target` shape checked above. Both are
  // checked so this keeps working regardless of which Prisma runtime/driver reports the error.
  const driverCause = (meta?.driverAdapterError as { cause?: unknown } | undefined)?.cause as
    | { originalMessage?: unknown; constraint?: { fields?: unknown } }
    | undefined;

  if (driverCause) {
    const constraintFields = driverCause.constraint?.fields;
    if (
      Array.isArray(constraintFields) &&
      constraintFields.some(
        (field) => typeof field === 'string' && normalizedConstraints.includes(normalize(field)),
      )
    ) {
      return true;
    }

    if (
      typeof driverCause.originalMessage === 'string' &&
      normalizedConstraints.some((constraint) => (driverCause.originalMessage as string).includes(constraint))
    ) {
      return true;
    }
  }

  return false;
}

export function isPrismaUniqueViolation(
  error: unknown,
): error is Prisma.PrismaClientKnownRequestError {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002';
}

function normalize(value: string): string {
  return value.replace(/"/g, '');
}
