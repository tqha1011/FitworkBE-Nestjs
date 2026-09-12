import {
  Body,
  Controller,
  HttpCode,
  HttpStatus,
  Post,
  Req,
  Res,
  UnauthorizedException,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Request, Response } from 'express';
import { toHttpException } from 'src/shared/common/app-error.mapper';
import {
  LoginRequestDto,
  RegisterRequestDto,
} from '../application/dtos/auth.request.dto';
import {
  LoginResponseDto,
  RegisterResponseDto,
} from '../application/dtos/auth.response.dto';
import { IAuthService } from '../application/interfaces/auth.service.interface';

const REFRESH_TOKEN_COOKIE = 'refresh_token';
const REFRESH_TOKEN_COOKIE_PATH = '/auth/refresh';

@ApiTags('auth')
@Controller('auth')
export class AuthController {
  constructor(private readonly authService: IAuthService) {}

  @Post('register')
  @ApiOperation({ summary: 'Register a new user' })
  async register(
    @Body() dto: RegisterRequestDto,
  ): Promise<RegisterResponseDto> {
    const result = await this.authService.registerAsync(dto);
    return result.match(
      (value) => value,
      (error) => {
        throw toHttpException(error);
      },
    );
  }

  @Post('login')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Log in with email and password' })
  async login(
    @Body() dto: LoginRequestDto,
    @Res({ passthrough: true }) res: Response,
  ): Promise<LoginResponseDto> {
    const result = await this.authService.loginAsync(dto.email, dto.password);
    return result.match(
      (tokens) => {
        this.setRefreshTokenCookie(
          res,
          tokens.refreshToken,
          tokens.refreshTokenExpiresAt,
        );
        return {
          accessToken: tokens.accessToken,
          expiresIn: tokens.accessTokenExpiresIn,
        };
      },
      (error) => {
        throw toHttpException(error);
      },
    );
  }

  @Post('refresh')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Rotate the refresh token and issue a new access token',
  })
  async refresh(
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<LoginResponseDto> {
    const rawRefreshToken = this.extractRefreshTokenCookie(req);
    if (!rawRefreshToken) {
      throw new UnauthorizedException('Missing refresh token');
    }

    const result = await this.authService.refreshTokensAsync(rawRefreshToken);
    return result.match(
      (tokens) => {
        this.setRefreshTokenCookie(
          res,
          tokens.refreshToken,
          tokens.refreshTokenExpiresAt,
        );
        return {
          accessToken: tokens.accessToken,
          expiresIn: tokens.accessTokenExpiresIn,
        };
      },
      (error) => {
        throw toHttpException(error);
      },
    );
  }

  @Post('logout')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Revoke the current refresh token' })
  async logout(
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<void> {
    const rawRefreshToken = this.extractRefreshTokenCookie(req);
    if (rawRefreshToken) {
      const result = await this.authService.logoutAsync(rawRefreshToken);
      if (result.isErr()) {
        throw toHttpException(result.error);
      }
    }
    res.clearCookie(REFRESH_TOKEN_COOKIE, { path: REFRESH_TOKEN_COOKIE_PATH });
  }

  private extractRefreshTokenCookie(req: Request): string | undefined {
    const cookies = req.cookies as Record<string, string> | undefined;
    return cookies?.[REFRESH_TOKEN_COOKIE];
  }

  private setRefreshTokenCookie(
    res: Response,
    rawRefreshToken: string,
    expiresAt: Date,
  ): void {
    res.cookie(REFRESH_TOKEN_COOKIE, rawRefreshToken, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      path: REFRESH_TOKEN_COOKIE_PATH,
      expires: expiresAt,
    });
  }
}
