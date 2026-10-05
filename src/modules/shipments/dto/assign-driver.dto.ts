import { IsInt } from 'class-validator';

export class AssignDriverDto {
  @IsInt()
  driverId!: number;
}
