import { Injectable, Logger } from '@nestjs/common';
import { err, ok, Result } from 'neverthrow';
import { IApplicationCache } from 'src/shared/application/cache/application-cache.interface';
import { AppError, ErrorCode } from 'src/shared/common/errorCode';
import {
  REFERENCE_DATA_CACHE_TTL_MS,
  ReferenceDataCacheKey,
} from '../constants/reference-data-cache.constants';
import { IArrangementService } from '../interfaces/arrangement.service.interface';
import { IArrangementRepository } from '../../domain/repositories/arrangement.repo.interface';
import { ArrangementResponseDto } from '../dtos/job.response.dto';

@Injectable()
export class ArrangementService implements IArrangementService {
  private readonly logger = new Logger(ArrangementService.name);

  constructor(
    private readonly arrangementRepository: IArrangementRepository,
    private readonly cache: IApplicationCache,
  ) {}

  async getAllArrangementsAsync(): Promise<
    Result<ArrangementResponseDto[], AppError>
  > {
    try {
      const cached = await this.cache.get<ArrangementResponseDto[]>(
        ReferenceDataCacheKey.Arrangements,
      );
      if (cached !== undefined) {
        return ok(cached);
      }
    } catch (error) {
      this.logger.error(`Failed to read arrangements cache: ${String(error)}`);
    }

    const result = await this.arrangementRepository.getAllArrangements();
    if (result.isErr()) {
      return err(
        new AppError(
          ErrorCode.InternalServerError,
          'Failed to get all arrangements',
          { cause: result.error },
        ),
      );
    }

    try {
      await this.cache.set(
        ReferenceDataCacheKey.Arrangements,
        result.value,
        REFERENCE_DATA_CACHE_TTL_MS,
      );
    } catch (error) {
      this.logger.error(`Failed to write arrangements cache: ${String(error)}`);
    }

    return ok(result.value);
  }
}
