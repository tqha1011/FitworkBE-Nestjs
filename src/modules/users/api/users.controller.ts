import { Body, Controller, Get, HttpStatus, Param, Post } from '@nestjs/common';
import { ApiOperation, ApiParam, ApiTags } from '@nestjs/swagger';
import {
  ApiBadRequestErrorResponse,
  ApiNotFoundErrorResponse,
} from '../../../shared/common/swagger/api-error-responses.decorator';
import { ApiStandardResponse } from '../../../shared/common/swagger/api-standard-response.decorator';
import { CreateUserDto } from '../application/dtos/create-user.dto';
import { UserResponseDto } from '../application/dtos/user.response';
import { UsersService } from '../application/services/users.service';

@ApiTags('users')
@Controller('users')
export class UsersController {
  constructor(private readonly usersService: UsersService) {}

  @Post()
  @ApiOperation({ summary: 'Create a user' })
  @ApiStandardResponse(UserResponseDto, { status: HttpStatus.CREATED })
  @ApiBadRequestErrorResponse()
  create(@Body() dto: CreateUserDto): UserResponseDto {
    return this.usersService.create(dto);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get a user by id' })
  @ApiParam({ name: 'id', description: 'User id' })
  @ApiStandardResponse(UserResponseDto)
  @ApiNotFoundErrorResponse()
  findById(@Param('id') id: string): UserResponseDto {
    return this.usersService.findById(id);
  }
}
