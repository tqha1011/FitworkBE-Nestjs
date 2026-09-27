import { Controller, Get } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { toHttpException } from 'src/shared/common/app-error.mapper';
import { SkillResponseDto } from '../application/dtos/job.response.dto';
import { ApiStandardResponse } from 'src/shared/common/swagger/api-standard-response.decorator';
import { ISkillService } from '../application/interfaces/skill.service.interface';

@Controller('skills')
@ApiTags('skills')
export class SkillController {
  constructor(private readonly skillService: ISkillService) {}

  @Get()
  @ApiOperation({ summary: 'List job skills' })
  @ApiStandardResponse(SkillResponseDto, { isArray: true })
  async getSkills(): Promise<SkillResponseDto[]> {
    const result = await this.skillService.getAllSkillsAsync();
    return result.match(
      (value) => value,
      (error) => {
        throw toHttpException(error);
      },
    );
  }
}
