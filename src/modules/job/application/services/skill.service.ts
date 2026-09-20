import { Injectable, Logger } from '@nestjs/common';
import { err, ok, Result } from 'neverthrow';
import { IApplicationCache } from 'src/shared/application/cache/application-cache.interface';
import { AppError, ErrorCode } from 'src/shared/common/errorCode';
import { ISkillRepository } from '../../domain/repositories/skill.repo.interface';
import {
  REFERENCE_DATA_CACHE_TTL_MS,
  ReferenceDataCacheKey,
} from '../constants/reference-data-cache.constants';
import { SkillResponseDto } from '../dtos/job.response.dto';
import { ISkillService } from '../interfaces/skill.service.interface';

@Injectable()
export class SkillService implements ISkillService {
  private readonly logger = new Logger(SkillService.name);

  constructor(
    private readonly skillRepository: ISkillRepository,
    private readonly cache: IApplicationCache,
  ) {}

  async getAllSkillsAsync(): Promise<Result<SkillResponseDto[], AppError>> {
    try {
      const cached = await this.cache.get<SkillResponseDto[]>(
        ReferenceDataCacheKey.Skills,
      );
      if (cached !== undefined) {
        return ok(cached);
      }
    } catch (error) {
      this.logger.error(`Failed to read skills cache: ${String(error)}`);
    }

    const result = await this.skillRepository.getAllSkills();
    if (result.isErr()) {
      return err(
        new AppError(ErrorCode.InternalServerError, result.error.message),
      );
    }

    try {
      await this.cache.set(
        ReferenceDataCacheKey.Skills,
        result.value,
        REFERENCE_DATA_CACHE_TTL_MS,
      );
    } catch (error) {
      this.logger.error(`Failed to write skills cache: ${String(error)}`);
    }

    return ok(result.value);
  }
}
