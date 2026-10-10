import { Controller, Get } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { toHttpException } from 'src/shared/common/app-error.mapper';
import { ArrangementResponseDto } from '../application/dtos/job.response.dto';
import { ApiStandardResponse } from 'src/shared/common/swagger/api-standard-response.decorator';
import { IArrangementService } from '../application/interfaces/arrangement.service.interface';
import { Auth } from 'src/shared/common/swagger/auth-swagger.decorator';

@Controller('/api/arrangements')
@ApiTags('arrangements')
export class ArrangementController {
  constructor(private readonly arrangementService: IArrangementService) {}
  @Get()
  @Auth()
  @ApiOperation({ summary: 'List job arrangements' })
  @ApiStandardResponse(ArrangementResponseDto, { isArray: true })
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
