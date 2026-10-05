import { IsNumber, IsOptional, IsPositive, IsString, MinLength } from 'class-validator';

// No deliveryFee: that's staff-set once the order is accepted. No
// customerId: the customer is always the verified token's own customer
// (forbidNonWhitelisted rejects anyone who tries to send one anyway).
export class CreatePortalOrderDto {
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
  @IsPositive()
  declaredAmount?: number;
}
