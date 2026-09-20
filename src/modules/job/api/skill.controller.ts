import { Controller, Get } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { toHttpException } from 'src/shared/common/app-error.mapper';
import { SkillResponseDto } from '../application/dtos/job.response.dto';
import { ISkillService } from '../application/interfaces/skill.service.interface';

@Controller('skills')
@ApiTags('skills')
export class SkillController {
  constructor(private readonly skillService: ISkillService) {}

  @Get()
  @ApiOperation({ summary: 'List job skills' })
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
