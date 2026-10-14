import {
  Body,
  CanActivate,
  Controller,
  Get,
  HttpCode,
  Injectable,
  NotFoundException,
  Optional,
  Post,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import { ApiOperation, ApiProperty, ApiTags } from '@nestjs/swagger';
import { IsEnum, IsOptional } from 'class-validator';
import { UserType } from 'generated/prisma/enums';
import type { Request, Response } from 'express';
import { DemoService } from '../application/demo.service';
import { Auth } from 'src/shared/common/swagger/auth-swagger.decorator';
import { User } from 'src/shared/common/user.decorator';
import type { JwtPayload } from 'src/shared/common/jwt.payload.interface';
import { toHttpException } from 'src/shared/common/app-error.mapper';
import { DemoAccessService } from '../application/demo-access.service';

export class CreateDemoDto {
  @ApiProperty({ enum: UserType, default: 'COMPANY', required: false })
  @IsOptional()
  @IsEnum(UserType)
  userType: UserType = 'COMPANY';
}
export class SwitchDemoDto {
  @ApiProperty({ enum: UserType })
  @IsEnum(UserType)
  userType!: UserType;
}

@Injectable()
export class DemoOrdinaryAuthGuard implements CanActivate {
  constructor(@Optional() private readonly access?: DemoAccessService) {}
  canActivate() {
    if (this.access?.limits.only)
      throw new NotFoundException(
        'Ordinary authentication is disabled in the demo',
      );
    return true;
  }
}
@Injectable()
export class DemoEnabledGuard implements CanActivate {
  constructor(private readonly access: DemoAccessService) {}
  canActivate() {
    if (!this.access.limits.enabled)
      throw new NotFoundException('Demo is disabled');
    return true;
  }
}

@ApiTags('demo')
@Controller('/api/demo')
@UseGuards(DemoEnabledGuard)
export class DemoController {
  constructor(private readonly demo: DemoService) {}
  @Get('session')
  @Auth()
  @ApiOperation({
    summary: 'Read demo workspace, role, quotas and sample/live evaluation IDs',
  })
  async session(@User() user: JwtPayload) {
    const result = await this.demo.view(user);
    if (result.isErr()) throw toHttpException(result.error);
    return result.value;
  }
}

// Defined in a separate controller to preserve existing auth routes and cookie contract.
@ApiTags('demo')
@Controller('/api/auth/demo')
@UseGuards(DemoEnabledGuard)
export class DemoAuthController {
  constructor(private readonly demo: DemoService) {}
  @Post()
  @ApiOperation({ summary: 'Start a private demo (COMPANY by default)' })
  async create(
    @Body() dto: CreateDemoDto,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    const result = await this.demo.create(
      req.ip ?? req.socket.remoteAddress ?? 'unknown',
      dto.userType,
    );
    if (result.isErr()) throw toHttpException(result.error);
    return this.respond(result.value, res);
  }
  @Post('switch')
  @HttpCode(200)
  @Auth()
  @ApiOperation({
    summary: 'Switch primary demo role and invalidate old tokens/sockets',
  })
  async switch(
    @User() user: JwtPayload,
    @Body() dto: SwitchDemoDto,
    @Res({ passthrough: true }) res: Response,
  ) {
    const result = await this.demo.switchRole(user, dto.userType);
    if (result.isErr()) throw toHttpException(result.error);
    return this.respond(result.value, res);
  }
  private respond(
    tokens: {
      accessToken: string;
      accessTokenExpiresIn: number;
      refreshToken: string;
      refreshTokenExpiresAt: Date;
    },
    res: Response,
  ) {
    res.cookie('refresh_token', tokens.refreshToken, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      path: '/api/auth/refresh',
      expires: tokens.refreshTokenExpiresAt,
    });
    return {
      accessToken: tokens.accessToken,
      expiresIn: tokens.accessTokenExpiresIn,
    };
  }
}
