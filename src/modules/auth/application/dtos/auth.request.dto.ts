import { ApiProperty } from '@nestjs/swagger';
import {
  IsEmail,
  IsEnum,
  IsString,
  IsStrongPassword,
  MinLength,
} from 'class-validator';
import { UserType } from 'generated/prisma/enums';

export class RegisterRequestDto {
  @ApiProperty()
  @IsEmail()
  email!: string;

  @ApiProperty()
  @IsString()
  @MinLength(3)
  username!: string;

  @ApiProperty()
  @IsString()
  @MinLength(1)
  fullName!: string;

  @ApiProperty()
  @IsString()
  @MinLength(8)
  @IsStrongPassword()
  password!: string;

  @ApiProperty({ enum: UserType })
  @IsEnum(UserType)
  userType!: UserType;
}

export class LoginRequestDto {
  @ApiProperty()
  @IsEmail()
  email!: string;

  @ApiProperty()
  @IsString()
  password!: string;
}
