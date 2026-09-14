import { Result } from 'neverthrow';
import { AppError } from 'src/shared/common/errorCode';
import { ArrangementResponseDto } from '../dtos/job.response.dto';

export abstract class IArrangementService {
  abstract getAllArrangementsAsync(): Promise<
    Result<ArrangementResponseDto[], AppError>
  >;
}
