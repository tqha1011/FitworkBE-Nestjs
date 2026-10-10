import { PrismaClient } from '../../generated/prisma/client';

export async function findPerfSentinel(prisma: PrismaClient, ids: string[]) {
  // One array parameter avoids the PostgreSQL/Prisma bind limit at 50k IDs.
  const rows = await prisma.$queryRaw<{ publicId: string; title: string }[]>`
    SELECT public_id AS "publicId", title FROM job
    WHERE public_id = ANY(${ids}::text[]) AND status = 'OPEN'
    ORDER BY public_id LIMIT 1
  `;
  if (!rows[0]) throw new Error('Performance dataset has no OPEN sentinel job');
  return rows[0];
}
