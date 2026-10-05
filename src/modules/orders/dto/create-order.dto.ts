import { IsInt, IsNumber, IsOptional, IsPositive, IsString, Min, MinLength } from 'class-validator';

export class CreateOrderDto {
  @IsInt()
  customerId!: number;

  @IsString()
  @MinLength(1)
  pickupAddress!: string;

  @IsString()
  @MinLength(1)
  deliveryAddress!: string;

  @IsOptional()
  @IsString()
  itemDescription?: string;

  @IsOptional()
  @IsNumber()
  @Min(0)
  declaredAmount?: number;

  @IsNumber()
  @IsPositive()
  deliveryFee!: number;
}
