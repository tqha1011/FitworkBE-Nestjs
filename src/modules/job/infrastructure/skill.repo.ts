import { Result, ok, err } from 'neverthrow';
import {
  ISkillRepository,
  SkillData,
} from '../domain/repositories/job-skill.repo.interface';
import { PrismaService } from 'src/shared/infrastructure/database/prisma.service';

export class SkillRepository implements ISkillRepository {
  constructor(private readonly prismaService: PrismaService) {}
  async getAllSkills(): Promise<Result<SkillData[], Error>> {
    try {
      const skills = await this.prismaService.skill.findMany({
        select: {
          id: true,
          name: true,
        },
      });
      return ok(
        skills.map((skill) => ({
          id: skill.id,
          name: skill.name,
        })),
      );
    } catch (error) {
      return err(new Error(`Failed to get all skills: ${error}`));
    }
  }
}
