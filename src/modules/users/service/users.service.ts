import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import * as bcrypt from 'bcrypt';
import { PrismaService } from '../../../prisma/prisma.service.js';
import { AuthService } from '../../auth/service/auth.service.js';
import type { PaginatedResult } from '../../../common/pagination.js';
import { isUniqueConstraintError } from '../../../common/prisma-errors.js';
import { CreateUserDto } from '../dto/create-user.dto.js';
import { UpdateUserDto } from '../dto/update-user.dto.js';
import { ListUsersQueryDto } from '../dto/list-users.query.dto.js';
import { UserResponseDto } from '../dto/user-response.dto.js';

const BCRYPT_ROUNDS = 10;

@Injectable()
export class UsersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly authService: AuthService,
  ) {}

  async create(dto: CreateUserDto): Promise<UserResponseDto> {
    const passwordHash = await bcrypt.hash(dto.password, BCRYPT_ROUNDS);

    try {
      const user = await this.prisma.$transaction(async (tx) => {
        const created = await tx.user.create({
          data: { fullName: dto.fullName, email: dto.email, passwordHash, role: dto.role },
        });
        if (dto.role === 'driver') {
          await tx.driverProfile.create({
            data: { driverId: created.id, licenseNumber: dto.licenseNumber },
          });
        }
        return created;
      });
      return this.findOne(user.id);
    } catch (err) {
      if (isUniqueConstraintError(err)) {
        throw new ConflictException('A user with this email already exists');
      }
      throw err;
    }
  }

  async findAll(query: ListUsersQueryDto): Promise<PaginatedResult<UserResponseDto>> {
    const where: Prisma.UserWhereInput = {
      ...(query.role ? { role: query.role } : {}),
      ...(query.isActive !== undefined ? { isActive: query.isActive } : {}),
    };
    const [users, total] = await Promise.all([
      this.prisma.user.findMany({
        where,
        include: { driverProfile: true },
        skip: (query.page - 1) * query.limit,
        take: query.limit,
        orderBy: { id: 'asc' },
      }),
      this.prisma.user.count({ where }),
    ]);

    return {
      data: users.map((user) => UserResponseDto.fromEntity(user)),
      meta: { page: query.page, limit: query.limit, total },
    };
  }

  async findOne(id: number): Promise<UserResponseDto> {
    const user = await this.prisma.user.findUnique({ where: { id }, include: { driverProfile: true } });
    if (!user) throw new NotFoundException('User not found');
    return UserResponseDto.fromEntity(user);
  }

  async update(id: number, dto: UpdateUserDto): Promise<UserResponseDto> {
    const user = await this.prisma.user.findUnique({ where: { id } });
    if (!user) throw new NotFoundException('User not found');
    if (dto.licenseNumber !== undefined && user.role !== 'driver') {
      throw new BadRequestException('Only drivers have a license number');
    }

    try {
      await this.prisma.$transaction(async (tx) => {
        await tx.user.update({ where: { id }, data: { fullName: dto.fullName, email: dto.email } });
        if (dto.licenseNumber !== undefined) {
          await tx.driverProfile.update({ where: { driverId: id }, data: { licenseNumber: dto.licenseNumber } });
        }
      });
    } catch (err) {
      if (isUniqueConstraintError(err)) {
        throw new ConflictException('A user with this email already exists');
      }
      throw err;
    }

    return this.findOne(id);
  }

  async setActive(id: number, isActive: boolean, currentUserId: number): Promise<UserResponseDto> {
    if (!isActive && id === currentUserId) {
      throw new ForbiddenException('You cannot deactivate your own account');
    }
    const user = await this.prisma.user.findUnique({ where: { id } });
    if (!user) throw new NotFoundException('User not found');

    await this.prisma.user.update({ where: { id }, data: { isActive } });

    if (!isActive) {
      // Accepted MVP trade-off: this revokes refresh tokens (blocks new
      // sessions), but an access token already handed out stays valid
      // until it naturally expires (15 min) — there's no access-token
      // blocklist. Worst case, a just-deactivated user keeps API access
      // for up to 15 more minutes.
      await this.authService.revokeAllTokensForUser(id);
    }

    return this.findOne(id);
  }

  async resetPassword(id: number, newPassword: string): Promise<void> {
    const user = await this.prisma.user.findUnique({ where: { id } });
    if (!user) throw new NotFoundException('User not found');

    const passwordHash = await bcrypt.hash(newPassword, BCRYPT_ROUNDS);
    await this.prisma.user.update({ where: { id }, data: { passwordHash } });
    await this.authService.revokeAllTokensForUser(id);
  }
}
