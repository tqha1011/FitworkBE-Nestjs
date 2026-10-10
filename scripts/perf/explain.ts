import { Pool } from 'pg';
import { Prisma, PrismaClient } from '../../generated/prisma/client';
import { JobRepository } from '../../src/modules/job/infrastructure/job.repo';
import { PrismaService } from '../../src/shared/infrastructure/database/prisma.service';
import { Scenario } from './scenarios';

export type PlanNode = {
  'Node Type': string;
  'Relation Name'?: string;
  'Index Name'?: string;
  'Sort Method'?: string;
  'Sort Space Type'?: string;
  'Sort Space Used'?: number;
  'Plan Rows': number;
  'Actual Rows': number;
  'Actual Loops': number;
  'Shared Hit Blocks'?: number;
  'Shared Read Blocks'?: number;
  'Temp Read Blocks'?: number;
  'Temp Written Blocks'?: number;
  Plans?: PlanNode[];
};
export function summarizePlan(plan: PlanNode): Omit<PlanNode, 'Plans'>[] {
  const { Plans = [], ...node } = plan;
  return [node, ...Plans.flatMap(summarizePlan)];
}

// Capture events from the actual repository; never maintain a parallel SQL template.
export async function captureAndExplain(
  prisma: PrismaClient<'query'>,
  pool: Pool,
  cases: Scenario[],
  pageSize: number,
) {
  let captured: Prisma.QueryEvent[] = [];
  prisma.$on('query', (event) => captured.push(event));
  const repo = new JobRepository(prisma as PrismaService);
  const results = [];
  for (const scenario of cases) {
    captured = [];
    const result = await repo.getListJobs(
      scenario.pageNumber,
      pageSize,
      scenario.filter,
    );
    if (result.isErr()) throw result.error;
    const statements = captured.filter((event) =>
      /^\s*SELECT\b/i.test(event.query),
    );
    if (!statements.length)
      throw new Error(
        'Prisma SQL query events missing; create client with event query logging.',
      );
    const queries = [];
    for (const statement of statements) {
      const parameters = JSON.parse(statement.params) as unknown[];
      const explained = await pool.query<{
        'QUERY PLAN': {
          Plan: PlanNode;
          'Planning Time': number;
          'Execution Time': number;
        }[];
      }>(
        `EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON) ${statement.query}`,
        parameters,
      );
      const plan = explained.rows[0]['QUERY PLAN'][0];
      queries.push({
        sql: statement.query,
        parameters,
        captureDurationMs: statement.duration,
        plan,
        nodes: summarizePlan(plan.Plan),
      });
    }
    results.push({
      name: scenario.name,
      items: result.value.items.map((x) => x.publicId),
      totalPages: result.value.totalPages,
      queries,
    });
  }
  return results;
}
