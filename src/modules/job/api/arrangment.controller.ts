import { Controller, Get } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { toHttpException } from 'src/shared/common/app-error.mapper';
import { ArrangementResponseDto } from '../application/dtos/job.response.dto';
import { IArrangementService } from '../application/interfaces/arrangement.service.interface';

@Controller('arrangements')
@ApiTags('arrangements')
export class ArrangementController {
  constructor(private readonly arrangementService: IArrangementService) {}
  @Get()
  @ApiOperation({ summary: 'List job arrangements' })
  async getArrangements(): Promise<ArrangementResponseDto[]> {
    const result = await this.arrangementService.getAllArrangementsAsync();
    return result.match(
      (value) => value,
      (error) => {
        throw toHttpException(error);
      },
    );
  }
}
