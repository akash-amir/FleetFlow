import { IsInt } from 'class-validator';

export class CreateShipmentDto {
  @IsInt()
  orderId!: number;
}
