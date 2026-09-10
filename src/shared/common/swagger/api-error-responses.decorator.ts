import { applyDecorators } from '@nestjs/common';
import { ApiResponse } from '@nestjs/swagger';

/**
 * Error envelope shape produced by AllExceptionsFilter, mirrored here so
 * Swagger shows the real response instead of the library's default shape.
 */
class ErrorResponseSchema {
  statusCode!: number;
  timestamp!: string;
  path!: string;
  message!: string;
}

function apiError(status: number, description: string) {
  return ApiResponse({ status, description, type: ErrorResponseSchema });
}

export const ApiBadRequestErrorResponse = () =>
  apiError(400, 'Validation failed or malformed request');

export const ApiUnauthorizedErrorResponse = () =>
  apiError(401, 'Missing or invalid authentication token');

export const ApiForbiddenErrorResponse = () =>
  apiError(403, 'Caller lacks permission for this resource');

export const ApiNotFoundErrorResponse = () =>
  apiError(404, 'Resource not found');

export const ApiInternalErrorResponse = () =>
  apiError(500, 'Unexpected server error');

/** Common 400/401/404/500 set for a typical protected CRUD endpoint. */
export function ApiCommonErrorResponses() {
  return applyDecorators(
    ApiBadRequestErrorResponse(),
    ApiUnauthorizedErrorResponse(),
    ApiNotFoundErrorResponse(),
    ApiInternalErrorResponse(),
  );
}
