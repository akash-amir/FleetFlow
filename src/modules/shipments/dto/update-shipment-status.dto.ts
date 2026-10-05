import { IsEnum } from 'class-validator';
import { ShipmentStatus } from '@prisma/client';

// The DTO only checks this is a real enum member — whether THIS transition
// from the shipment's current status is legal is the state machine's job
// (service layer), not this validator's.
export class UpdateShipmentStatusDto {
  @IsEnum(ShipmentStatus)
  status!: ShipmentStatus;
}
