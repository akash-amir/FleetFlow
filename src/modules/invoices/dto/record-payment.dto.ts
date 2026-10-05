import { IsIn, IsNumber, IsOptional, IsPositive, IsString } from 'class-validator';

// Stripe payments are NOT created through this endpoint — method is
// deliberately restricted to the two manual methods.
export class RecordPaymentDto {
  @IsNumber()
  @IsPositive()
  amountPaid!: number;

  @IsIn(['cash', 'bank_transfer'])
  method!: 'cash' | 'bank_transfer';

  @IsOptional()
  @IsString()
  reference?: string;
}
