import { IsNumber, IsOptional, IsPositive, IsString, Min, MinLength } from 'class-validator';

// Only allowed while the order is still `pending` (enforced in the service, 409 otherwise).
// No `customerId` or `status` here on purpose — those aren't editable via this endpoint.
export class UpdateOrderDto {
  @IsOptional()
  @IsString()
  @MinLength(1)
  pickupAddress?: string;

  @IsOptional()
  @IsString()
  @MinLength(1)
  deliveryAddress?: string;

  @IsOptional()
  @IsString()
  itemDescription?: string;

  @IsOptional()
  @IsNumber()
  @Min(0)
  declaredAmount?: number;

  @IsOptional()
  @IsNumber()
  @IsPositive()
  deliveryFee?: number;
}
