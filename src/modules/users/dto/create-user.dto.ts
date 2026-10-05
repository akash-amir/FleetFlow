import { IsEmail, IsEnum, IsOptional, IsString, MinLength } from 'class-validator';

/** Deliberately excludes 'admin' — an admin cannot create other admins via the API. */
export enum CreatableRole {
  dispatcher = 'dispatcher',
  driver = 'driver',
}

export class CreateUserDto {
  @IsString()
  @MinLength(1)
  fullName!: string;

  @IsEmail()
  email!: string;

  @IsString()
  @MinLength(8)
  password!: string;

  @IsEnum(CreatableRole)
  role!: CreatableRole;

  @IsOptional()
  @IsString()
  licenseNumber?: string;
}
