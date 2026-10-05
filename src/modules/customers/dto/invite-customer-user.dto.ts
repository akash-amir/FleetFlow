import { IsEmail, IsString, MinLength } from 'class-validator';

export class InviteCustomerUserDto {
  @IsString()
  @MinLength(1)
  fullName!: string;

  @IsEmail()
  email!: string;
}
