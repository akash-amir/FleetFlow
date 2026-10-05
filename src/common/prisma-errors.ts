import { Prisma } from '@prisma/client';

/** True for a Prisma unique-constraint violation (P2002) — the caller should turn this into a 409, not a 500. */
export function isUniqueConstraintError(err: unknown): boolean {
  return err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002';
}
