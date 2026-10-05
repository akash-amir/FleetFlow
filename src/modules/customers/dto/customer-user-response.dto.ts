import type { CustomerUser } from '@prisma/client';

/** Response mapper — never exposes passwordHash or any token data. */
export class CustomerUserResponseDto {
  id!: number;
  customerId!: number;
  fullName!: string;
  email!: string;
  isActive!: boolean;
  createdAt!: Date;
  /** Derived from passwordHash !== null — whether the invite has been accepted yet. */
  accepted!: boolean;

  static fromEntity(user: CustomerUser): CustomerUserResponseDto {
    return {
      id: user.id,
      customerId: user.customerId,
      fullName: user.fullName,
      email: user.email,
      isActive: user.isActive,
      createdAt: user.createdAt,
      accepted: user.passwordHash !== null,
    };
  }
}
