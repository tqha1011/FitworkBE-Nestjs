import { Injectable } from '@nestjs/common';
import { err, ok, Result } from 'neverthrow';
import { AppError, ErrorCode } from 'src/shared/common/errorCode';
import { IArrangementService } from '../interfaces/arrangement.service.interface';
import { IArrangementRepository } from '../../domain/repositories/arrangement.repo.interface';
import { ArrangementResponseDto } from '../dtos/job.response.dto';

@Injectable()
export class ArrangementService implements IArrangementService {
  constructor(private readonly arrangementRepository: IArrangementRepository) {}

  async getAllArrangementsAsync(): Promise<
    Result<ArrangementResponseDto[], AppError>
  > {
    const result = await this.arrangementRepository.getAllArrangements();
    if (result.isErr()) {
      return err(
        new AppError(ErrorCode.InternalServerError, result.error.message),
      );
    }
    return ok(result.value);
  }
}
