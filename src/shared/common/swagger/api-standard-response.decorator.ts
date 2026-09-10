import { applyDecorators, HttpStatus, Type } from '@nestjs/common';
import { ApiExtraModels, ApiResponse, getSchemaPath } from '@nestjs/swagger';

interface ApiStandardResponseOptions {
  status?: HttpStatus;
  description?: string;
  isArray?: boolean;
}

/**
 * Documents a success response backed by a DTO class in Swagger.
 * Use on controller handlers alongside the DTO returned by the service.
 */
export function ApiStandardResponse<TModel extends Type<unknown>>(
  model: TModel,
  options: ApiStandardResponseOptions = {},
) {
  const { status = HttpStatus.OK, description, isArray = false } = options;

  return applyDecorators(
    ApiExtraModels(model),
    ApiResponse({
      status,
      description,
      schema: isArray
        ? { type: 'array', items: { $ref: getSchemaPath(model) } }
        : { $ref: getSchemaPath(model) },
    }),
  );
}
