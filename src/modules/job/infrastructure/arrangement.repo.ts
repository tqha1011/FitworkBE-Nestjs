import { Result, ok, err } from 'neverthrow';
import {
  ArrangementData,
  IArrangementRepository,
} from '../domain/repositories/arrangement.repo.interface';
import { PrismaService } from 'src/shared/infrastructure/database/prisma.service';

export class ArrangementRepository implements IArrangementRepository {
  constructor(private readonly prismaService: PrismaService) {}

  async getAllArrangements(): Promise<Result<ArrangementData[], Error>> {
    try {
      const arrangements = await this.prismaService.arrangement.findMany({
        select: {
          id: true,
          name: true,
        },
      });
      return ok(arrangements);
    } catch (error) {
      return err(new Error('Failed to get all arrangements', { cause: error }));
    }
  }

  async arrangementExists(
    arrangementId: number,
  ): Promise<Result<boolean, Error>> {
    try {
      const count = await this.prismaService.arrangement.count({
        where: { id: arrangementId },
      });
      return ok(count > 0);
    } catch (error) {
      return err(
        new Error('Failed to check arrangement exists', { cause: error }),
      );
    }
  }
}
