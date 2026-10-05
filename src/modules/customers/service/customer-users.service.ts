import { ConflictException, Inject, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { randomBytes, createHash } from 'node:crypto';
import { PrismaService } from '../../../prisma/prisma.service.js';
import { isUniqueConstraintError } from '../../../common/prisma-errors.js';
import type { PaginatedResult } from '../../../common/pagination.js';
import { EMAIL_SERVICE, type EmailService } from '../../../common/email/email.service.js';
import { InviteCustomerUserDto } from '../dto/invite-customer-user.dto.js';
import { CustomerUserResponseDto } from '../dto/customer-user-response.dto.js';
import { ListCustomerUsersQueryDto } from '../dto/list-customer-users.query.dto.js';

const INVITE_TTL_HOURS_DEFAULT = 72;

function hashToken(raw: string): string {
  return createHash('sha256').update(raw).digest('hex');
}

function resolveInviteTtlMs(): number {
  const hours = Number(process.env.INVITE_TTL_HOURS);
  const validHours = Number.isFinite(hours) && hours > 0 ? hours : INVITE_TTL_HOURS_DEFAULT;
  return validHours * 60 * 60 * 1000;
}

@Injectable()
export class CustomerUsersService {
  private readonly logger = new Logger(CustomerUsersService.name);

  constructor(
    private readonly prisma: PrismaService,
    @Inject(EMAIL_SERVICE) private readonly email: EmailService,
  ) {}

  async invite(customerId: number, dto: InviteCustomerUserDto): Promise<CustomerUserResponseDto> {
    const customer = await this.prisma.customer.findUnique({ where: { id: customerId } });
    if (!customer) throw new NotFoundException('Customer not found');

    let created;
    let rawToken: string;
    try {
      const result = await this.prisma.$transaction(async (tx) => {
        const user = await tx.customerUser.create({
          data: { customerId, fullName: dto.fullName, email: dto.email },
        });
        const raw = randomBytes(32).toString('hex');
        await tx.customerUserToken.create({
          data: {
            customerUserId: user.id,
            tokenHash: hashToken(raw),
            purpose: 'invite',
            expiresAt: new Date(Date.now() + resolveInviteTtlMs()),
          },
        });
        return { user, raw };
      });
      created = result.user;
      rawToken = result.raw;
    } catch (err) {
      if (isUniqueConstraintError(err)) throw new ConflictException('A customer user with this email already exists');
      throw err;
    }

    await this.sendInviteEmail(created.email, created.fullName, rawToken);
    return CustomerUserResponseDto.fromEntity(created);
  }

  async findAllForCustomer(
    customerId: number,
    query: ListCustomerUsersQueryDto,
  ): Promise<PaginatedResult<CustomerUserResponseDto>> {
    const customer = await this.prisma.customer.findUnique({ where: { id: customerId } });
    if (!customer) throw new NotFoundException('Customer not found');

    const where = { customerId };
    const [users, total] = await Promise.all([
      this.prisma.customerUser.findMany({
        where,
        orderBy: { id: 'asc' },
        skip: (query.page - 1) * query.limit,
        take: query.limit,
      }),
      this.prisma.customerUser.count({ where }),
    ]);

    return {
      data: users.map((user) => CustomerUserResponseDto.fromEntity(user)),
      meta: { page: query.page, limit: query.limit, total },
    };
  }

  async resendInvite(customerId: number, userId: number): Promise<void> {
    const user = await this.findOwnedUser(customerId, userId);
    if (user.passwordHash) {
      throw new ConflictException('This user has already accepted their invite');
    }

    const raw = randomBytes(32).toString('hex');
    await this.prisma.$transaction(async (tx) => {
      // Invalidate previous unused invites (distinct from usedAt, which only
      // means the link was actually redeemed) — accept-invite rejects any
      // token with invalidatedAt set.
      await tx.customerUserToken.updateMany({
        where: { customerUserId: userId, purpose: 'invite', usedAt: null, invalidatedAt: null },
        data: { invalidatedAt: new Date() },
      });
      await tx.customerUserToken.create({
        data: {
          customerUserId: userId,
          tokenHash: hashToken(raw),
          purpose: 'invite',
          expiresAt: new Date(Date.now() + resolveInviteTtlMs()),
        },
      });
    });

    await this.sendInviteEmail(user.email, user.fullName, raw);
  }

  async setActive(customerId: number, userId: number, isActive: boolean): Promise<CustomerUserResponseDto> {
    const user = await this.findOwnedUser(customerId, userId);
    const updated = await this.prisma.customerUser.update({ where: { id: user.id }, data: { isActive } });

    if (!isActive) {
      await this.prisma.customerRefreshToken.updateMany({
        where: { customerUserId: user.id, revokedAt: null },
        data: { revokedAt: new Date() },
      });
    }

    return CustomerUserResponseDto.fromEntity(updated);
  }

  private async findOwnedUser(customerId: number, userId: number) {
    const user = await this.prisma.customerUser.findUnique({ where: { id: userId } });
    if (!user || user.customerId !== customerId) throw new NotFoundException('Customer user not found');
    return user;
  }

  private async sendInviteEmail(to: string, fullName: string, rawToken: string): Promise<void> {
    const link = `${process.env.FRONTEND_ORIGIN}/portal/accept-invite?token=${rawToken}`;
    try {
      await this.email.send({
        to,
        subject: 'You have been invited to the FleetFlow customer portal',
        html: `<p>Hi ${fullName},</p><p>You have been invited to the FleetFlow customer portal.</p><p><a href="${link}">Accept your invite</a></p>`,
        text: `Hi ${fullName},\n\nYou have been invited to the FleetFlow customer portal.\nAccept your invite: ${link}`,
      });
    } catch (err) {
      // Never let a failed email block the invite itself — the row (and a
      // valid, unexpired token) already exists; resend-invite exists
      // specifically to recover from exactly this.
      this.logger.error(`Failed to send invite email to ${to}`, err as Error);
    }
  }
}
