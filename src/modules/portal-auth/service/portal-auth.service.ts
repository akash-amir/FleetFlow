import { BadRequestException, Inject, Injectable, Logger, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcrypt';
import { randomBytes, randomUUID, createHash } from 'node:crypto';
import type { CustomerUser, Prisma } from '@prisma/client';
import { PrismaService } from '../../../prisma/prisma.service.js';
import { CUSTOMER_JWT_SERVICE } from '../../../common/jwt/customer-jwt.provider.js';
import { EMAIL_SERVICE, type EmailService } from '../../../common/email/email.service.js';
import { PASSWORD_RESET_TTL_MS, PORTAL_REFRESH_TOKEN_TTL_MS } from './portal-auth.constants.js';

const BCRYPT_ROUNDS = 10;
// Precomputed once at module load — used as the compare target when no real
// user/passwordHash exists, so login() always spends real bcrypt time
// regardless of *why* it's about to reject (see login() below).
const DUMMY_BCRYPT_HASH = bcrypt.hashSync('not-a-real-password-used-only-for-timing', BCRYPT_ROUNDS);

export type SafePortalUser = Omit<CustomerUser, 'passwordHash'>;

function toSafePortalUser(user: CustomerUser): SafePortalUser {
  const { passwordHash: _passwordHash, ...safe } = user;
  return safe;
}

export interface PortalAuthResult {
  accessToken: string;
  refreshToken: string;
  user: SafePortalUser;
}

/** Internal signal only: thrown to roll back a losing rotation race (see refresh() below) — mirrors AuthService's RefreshTokenConflictError. */
class PortalRefreshConflictError extends Error {}

@Injectable()
export class PortalAuthService {
  private readonly logger = new Logger(PortalAuthService.name);

  constructor(
    private readonly prisma: PrismaService,
    @Inject(CUSTOMER_JWT_SERVICE) private readonly customerJwt: JwtService,
    @Inject(EMAIL_SERVICE) private readonly email: EmailService,
  ) {}

  private hashToken(raw: string): string {
    return createHash('sha256').update(raw).digest('hex');
  }

  private signAccessToken(user: Pick<CustomerUser, 'id' | 'customerId'>): Promise<string> {
    return this.customerJwt.signAsync({ sub: user.id, customerId: user.customerId, type: 'customer' });
  }

  /** Creates a new customer refresh token row and returns the raw (unhashed) token. Mirrors AuthService.issueRefreshToken. */
  private async issueRefreshToken(
    db: Pick<Prisma.TransactionClient, 'customerRefreshToken'>,
    customerUserId: number,
    familyId: string,
  ) {
    const raw = randomBytes(32).toString('hex');
    const record = await db.customerRefreshToken.create({
      data: {
        customerUserId,
        familyId,
        tokenHash: this.hashToken(raw),
        expiresAt: new Date(Date.now() + PORTAL_REFRESH_TOKEN_TTL_MS),
      },
    });
    return { raw, record };
  }

  async login(email: string, password: string): Promise<PortalAuthResult> {
    const user = await this.prisma.customerUser.findUnique({ where: { email } });

    // Always run a real bcrypt compare, even with nothing real to compare
    // against — this keeps response time roughly constant regardless of
    // WHICH condition below is the actual failure reason (unknown email,
    // wrong password, inactive account, or an invite that was never
    // accepted), so none of those are distinguishable by timing.
    const passwordMatches = await bcrypt.compare(password, user?.passwordHash ?? DUMMY_BCRYPT_HASH);
    if (!user || !user.isActive || !user.passwordHash || !passwordMatches) {
      throw new UnauthorizedException('Invalid credentials');
    }

    const accessToken = await this.signAccessToken(user);
    const { raw: refreshToken } = await this.issueRefreshToken(this.prisma, user.id, randomUUID());
    return { accessToken, refreshToken, user: toSafePortalUser(user) };
  }

  /** Rotation + family reuse detection — identical shape to AuthService.refresh(). */
  async refresh(rawRefreshToken: string): Promise<PortalAuthResult> {
    const tokenHash = this.hashToken(rawRefreshToken);
    const existing = await this.prisma.customerRefreshToken.findUnique({
      where: { tokenHash },
      include: { customerUser: true },
    });
    if (!existing) {
      throw new UnauthorizedException('Invalid refresh token');
    }

    if (existing.revokedAt) {
      await this.revokeFamily(existing.familyId);
      throw new UnauthorizedException('Refresh token reuse detected');
    }
    if (existing.expiresAt < new Date()) {
      throw new UnauthorizedException('Refresh token expired');
    }
    if (!existing.customerUser.isActive) {
      throw new UnauthorizedException('Invalid credentials');
    }

    const user = existing.customerUser;
    const accessToken = await this.signAccessToken(user);

    try {
      const refreshToken = await this.prisma.$transaction(async (tx) => {
        const { raw, record } = await this.issueRefreshToken(tx, user.id, existing.familyId);
        // Same compare-and-swap as staff refresh — see AuthService.refresh
        // for the full race-condition reasoning.
        const { count } = await tx.customerRefreshToken.updateMany({
          where: { id: existing.id, revokedAt: null },
          data: { revokedAt: new Date(), replacedByTokenId: record.id },
        });
        if (count === 0) throw new PortalRefreshConflictError();
        return raw;
      });

      return { accessToken, refreshToken, user: toSafePortalUser(user) };
    } catch (err) {
      if (err instanceof PortalRefreshConflictError) {
        await this.revokeFamily(existing.familyId);
        throw new UnauthorizedException('Refresh token reuse detected');
      }
      throw err;
    }
  }

  async logout(rawRefreshToken: string | undefined): Promise<void> {
    if (!rawRefreshToken) return;
    const tokenHash = this.hashToken(rawRefreshToken);
    const existing = await this.prisma.customerRefreshToken.findUnique({ where: { tokenHash } });
    if (!existing) return;
    await this.revokeFamily(existing.familyId);
  }

  private async revokeFamily(familyId: string): Promise<void> {
    await this.prisma.customerRefreshToken.updateMany({
      where: { familyId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
  }

  async acceptInvite(rawToken: string, password: string): Promise<void> {
    const tokenHash = this.hashToken(rawToken);
    const record = await this.prisma.customerUserToken.findUnique({
      where: { tokenHash },
      include: { customerUser: true },
    });

    // Generic message no matter WHY it's invalid (doesn't exist, wrong
    // purpose, already used, expired, or the account got deactivated in
    // the meantime) — distinguishing these would let someone probe the
    // state of a guessed or leaked token, or confirm whether a specific
    // invite was ever issued for an email address.
    if (
      !record ||
      record.purpose !== 'invite' ||
      record.usedAt ||
      record.invalidatedAt ||
      record.expiresAt <= new Date() ||
      !record.customerUser.isActive
    ) {
      throw new BadRequestException('This invite link is invalid or has expired');
    }

    const passwordHash = await bcrypt.hash(password, BCRYPT_ROUNDS);
    await this.prisma.$transaction(async (tx) => {
      await tx.customerUser.update({ where: { id: record.customerUserId }, data: { passwordHash } });
      await tx.customerUserToken.update({ where: { id: record.id }, data: { usedAt: new Date() } });
    });
  }

  async forgotPassword(email: string): Promise<void> {
    const user = await this.prisma.customerUser.findUnique({ where: { email } });
    // No branch here returns anything different, and the controller sends
    // an identical response either way — this must never reveal whether
    // the email matched an account.
    if (!user || !user.isActive) return;

    const raw = randomBytes(32).toString('hex');
    await this.prisma.customerUserToken.create({
      data: {
        customerUserId: user.id,
        tokenHash: this.hashToken(raw),
        purpose: 'password_reset',
        expiresAt: new Date(Date.now() + PASSWORD_RESET_TTL_MS),
      },
    });

    const link = `${process.env.FRONTEND_ORIGIN}/portal/reset-password?token=${raw}`;
    try {
      await this.email.send({
        to: user.email,
        subject: 'Reset your FleetFlow customer portal password',
        html: `<p>Hi ${user.fullName},</p><p><a href="${link}">Reset your password</a>. This link expires in 1 hour.</p>`,
        text: `Hi ${user.fullName},\n\nReset your password: ${link}\nThis link expires in 1 hour.`,
      });
    } catch (err) {
      this.logger.error(`Failed to send password reset email to ${user.email}`, err as Error);
    }
  }

  async resetPassword(rawToken: string, newPassword: string): Promise<void> {
    const tokenHash = this.hashToken(rawToken);
    const record = await this.prisma.customerUserToken.findUnique({ where: { tokenHash } });

    if (!record || record.purpose !== 'password_reset' || record.usedAt || record.expiresAt <= new Date()) {
      throw new BadRequestException('This reset link is invalid or has expired');
    }

    const passwordHash = await bcrypt.hash(newPassword, BCRYPT_ROUNDS);
    await this.prisma.$transaction(async (tx) => {
      await tx.customerUser.update({ where: { id: record.customerUserId }, data: { passwordHash } });
      await tx.customerUserToken.update({ where: { id: record.id }, data: { usedAt: new Date() } });
      // Single use AND revokes every existing session — a password reset
      // means "assume the old password was compromised," so anything
      // logged in under it should be forced to log in again.
      await tx.customerRefreshToken.updateMany({
        where: { customerUserId: record.customerUserId, revokedAt: null },
        data: { revokedAt: new Date() },
      });
    });
  }

  async getMe(customerUserId: number) {
    const user = await this.prisma.customerUser.findUnique({
      where: { id: customerUserId },
      include: { customer: { select: { id: true, companyName: true } } },
    });
    if (!user || !user.isActive) throw new UnauthorizedException();
    const { passwordHash: _passwordHash, ...safe } = user;
    return safe;
  }
}
