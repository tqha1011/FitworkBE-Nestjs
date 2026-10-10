import { Test } from '@nestjs/testing';
import { PrismaService } from 'src/shared/infrastructure/database/prisma.service';
import { SkillRepository } from './skill.repo';
import { CategoryRepository } from './category.repo';
import { ArrangementRepository } from './arrangement.repo';
import { JobRepository } from './job.repo';
import { JobApplicantRepository } from './job-applicant.repo';

jest.mock('src/shared/infrastructure/database/prisma.service', () => ({
  PrismaService: class PrismaService {},
}));

describe('Job repository dependency injection', () => {
  it('resolves PrismaService for every job repository through Nest', async () => {
    const prisma = {
      skill: {
        findMany: () => Promise.resolve([{ id: 1, name: 'TypeScript' }]),
      },
      category: {
        findMany: () => Promise.resolve([{ id: 1, name: 'Engineering' }]),
      },
      arrangement: {
        findMany: () => Promise.resolve([{ id: 1, name: 'Remote' }]),
      },
      job: { findUnique: () => Promise.resolve(null) },
      jobApplicant: { updateMany: () => Promise.resolve({ count: 0 }) },
    };
    const module = await Test.createTestingModule({
      providers: [
        { provide: PrismaService, useValue: prisma },
        SkillRepository,
        CategoryRepository,
        ArrangementRepository,
        JobRepository,
        JobApplicantRepository,
      ],
    }).compile();

    try {
      expect(
        (await module.get(SkillRepository).getAllSkills())._unsafeUnwrap(),
      ).toEqual([{ id: 1, name: 'TypeScript' }]);
      expect(
        (
          await module.get(CategoryRepository).getAllCategories()
        )._unsafeUnwrap(),
      ).toEqual([{ id: 1, name: 'Engineering' }]);
      expect(
        (
          await module.get(ArrangementRepository).getAllArrangements()
        )._unsafeUnwrap(),
      ).toEqual([{ id: 1, name: 'Remote' }]);
      expect(
        (
          await module.get(JobRepository).getJobByPublicId('missing')
        )._unsafeUnwrap(),
      ).toBeNull();
      expect(
        (
          await module.get(JobApplicantRepository).rejectAllApplicants(1)
        ).isOk(),
      ).toBe(true);
    } finally {
      await module.close();
    }
  });
});
