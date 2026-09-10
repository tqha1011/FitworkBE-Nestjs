import { applyDecorators, UseGuards } from '@nestjs/common';
import { ApiBearerAuth } from '@nestjs/swagger';
import { JwtAuthGuard } from '../jwt.guard';
import { ApiUnauthorizedErrorResponse } from './api-error-responses.decorator';

/**
 * Marks a route as JWT-protected: applies JwtAuthGuard, documents the
 * bearer scheme, and adds the 401 response in Swagger.
 *
 * Requires JwtModule to be registered wherever JwtAuthGuard is used —
 * this template does not wire JwtModule into AppModule by default.
 */
export function Auth() {
  return applyDecorators(
    UseGuards(JwtAuthGuard),
    ApiBearerAuth(),
    ApiUnauthorizedErrorResponse(),
  );
}
