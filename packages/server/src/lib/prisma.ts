import { PrismaClient } from '@prisma/client';

/**
 * Shared Prisma client (the DB handle). Import this everywhere instead of
 * constructing new clients, so we reuse a single connection pool.
 *
 * Uncomment usage once `npm run db:generate` has produced the client and a
 * DATABASE_URL is configured.
 */
export const prisma = new PrismaClient();
