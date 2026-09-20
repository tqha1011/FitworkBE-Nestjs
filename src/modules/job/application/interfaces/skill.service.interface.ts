import { Result } from 'neverthrow';
import { AppError } from 'src/shared/common/errorCode';
import { SkillResponseDto } from '../dtos/job.response.dto';

export abstract class ISkillService {
  abstract getAllSkillsAsync(): Promise<Result<SkillResponseDto[], AppError>>;
}
