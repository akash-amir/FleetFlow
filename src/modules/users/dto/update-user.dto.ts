import { IsEmail, IsOptional, IsString, MinLength } from 'class-validator';

// No `role` field on purpose: combined with the global ValidationPipe's
// forbidNonWhitelisted, sending `role` in the body is rejected with 400
// rather than silently ignored — role changes aren't supported by this endpoint.
export class UpdateUserDto {
  @IsOptional()
  @IsString()
  @MinLength(1)
  fullName?: string;

  @IsOptional()
  @IsEmail()
  email?: string;

  @IsOptional()
  @IsString()
  licenseNumber?: string;
}
