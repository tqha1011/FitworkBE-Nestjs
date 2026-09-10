import { ApiProperty } from '@nestjs/swagger';

export class UserResponseDto {
  @ApiProperty({ example: 'b3f2c9e0-df76-4a5a-9d0c-6e2f7a1e2b3c' })
  id!: string;

  @ApiProperty({ example: 'jane.doe@example.com' })
  email!: string;

  @ApiProperty({ example: 'Jane Doe' })
  name!: string;

  @ApiProperty({ example: '2026-09-10T08:00:00.000Z' })
  createdAt!: string;
}
