import type { DriverProfile, Role, User } from '@prisma/client';

/** Response mapper — the one place a User entity is turned into API output, so passwordHash can never leak. */
export class UserResponseDto {
  id!: number;
  fullName!: string;
  email!: string;
  role!: Role;
  isActive!: boolean;
  createdAt!: Date;
  licenseNumber?: string | null;

  static fromEntity(user: User & { driverProfile?: DriverProfile | null }): UserResponseDto {
    return {
      id: user.id,
      fullName: user.fullName,
      email: user.email,
      role: user.role,
      isActive: user.isActive,
      createdAt: user.createdAt,
      licenseNumber: user.driverProfile?.licenseNumber,
    };
  }
}
