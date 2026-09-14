import { Result } from 'neverthrow';

export type SkillData = {
  id: number;
  name: string;
};
export abstract class ISkillRepository {
  abstract getAllSkills(): Promise<Result<SkillData[], Error>>;
  abstract findExistingSkillIds(
    skillIds: number[],
  ): Promise<Result<number[], Error>>;
}
