import { Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcrypt';
import { randomBytes, randomUUID, createHash } from 'node:crypto';
import type { Prisma, User } from '@prisma/client';
import { PrismaService } from '../../../prisma/prisma.service.js';
import { REFRESH_TOKEN_TTL_MS } from './auth.constants.js';

export type SafeUser = Omit<User, 'passwordHash'>;

function toSafeUser(user: User): SafeUser {
  const { passwordHash: _passwordHash, ...safe } = user;
  return safe;
}

export interface AuthResult {
  accessToken: string;
  refreshToken: string;
  user: SafeUser;
}

/** Internal signal only: thrown to roll back a losing rotation race (see refresh() below). */
class RefreshTokenConflictError extends Error {}

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
  ) {}

  private hashRefreshToken(raw: string): string {
    return createHash('sha256').update(raw).digest('hex');
  }

  private signAccessToken(user: Pick<User, 'id' | 'email' | 'role'>): Promise<string> {
    return this.jwt.signAsync({ sub: user.id, email: user.email, role: user.role, type: 'staff' });
  }

  /** Creates a new refresh token row and returns the raw (unhashed) token to hand to the client. */
  private async issueRefreshToken(
    db: Pick<Prisma.TransactionClient, 'refreshToken'>,
    userId: number,
    familyId: string,
  ) {
    const raw = randomBytes(32).toString('hex');
    const record = await db.refreshToken.create({
      data: {
        userId,
        familyId,
        tokenHash: this.hashRefreshToken(raw),
        expiresAt: new Date(Date.now() + REFRESH_TOKEN_TTL_MS),
      },
    });
    return { raw, record };
  }

  async login(email: string, password: string): Promise<AuthResult> {
    const user = await this.prisma.user.findUnique({ where: { email } });
    if (!user || !user.isActive) {
      throw new UnauthorizedException('Invalid credentials');
    }
    const passwordMatches = await bcrypt.compare(password, user.passwordHash);
    if (!passwordMatches) {
      throw new UnauthorizedException('Invalid credentials');
    }

    const accessToken = await this.signAccessToken(user);
    const { raw: refreshToken } = await this.issueRefreshToken(this.prisma, user.id, randomUUID());
    return { accessToken, refreshToken, user: toSafeUser(user) };
  }

  /**
   * Rotates a refresh token. If the presented token was already revoked
   * (i.e. it was already used once before — a sign the token was stolen
   * and replayed), the entire token family is revoked and the caller is
   * logged out everywhere, rather than just rejecting this one request.
   */
  async refresh(rawRefreshToken: string): Promise<AuthResult> {
    const tokenHash = this.hashRefreshToken(rawRefreshToken);
    const existing = await this.prisma.refreshToken.findUnique({
      where: { tokenHash },
      include: { user: true },
    });
    if (!existing) {
      throw new UnauthorizedException('Invalid refresh token');
    }

    if (existing.revokedAt) {
      // This exact token was already rotated away once. Someone presenting
      // it again means either a replay of a stolen token, or a legitimate
      // caller retrying after a race they lost below — both are treated
      // the same way: assume compromise and kill the whole family.
      await this.revokeFamily(existing.familyId);
      throw new UnauthorizedException('Refresh token reuse detected');
    }
    if (existing.expiresAt < new Date()) {
      throw new UnauthorizedException('Refresh token expired');
    }
    if (!existing.user.isActive) {
      throw new UnauthorizedException('Invalid credentials');
    }

    const user = existing.user;
    const accessToken = await this.signAccessToken(user);

    try {
      // Rotate atomically: the new token must exist before the old one is
      // marked replaced, so a crash mid-way never leaves the user locked out.
      const refreshToken = await this.prisma.$transaction(async (tx) => {
        const { raw, record } = await this.issueRefreshToken(tx, user.id, existing.familyId);

        // Concurrent double-refresh: if two requests both read `existing`
        // as not-yet-revoked (e.g. the client fired /refresh twice, or an
        // attacker replayed a stolen token at the same moment as the real
        // user), both reach this point and both try to revoke the SAME
        // parent row. The `revokedAt: null` guard makes this a
        // compare-and-swap: only the first write actually matches a row,
        // so only one request gets `count === 1` and a valid child token.
        // The loser gets `count === 0`, throws, and Prisma rolls back this
        // whole transaction — including the child row it just created —
        // so the race never leaks a second usable token out of one parent.
        const { count } = await tx.refreshToken.updateMany({
          where: { id: existing.id, revokedAt: null },
          data: { revokedAt: new Date(), replacedByTokenId: record.id },
        });
        if (count === 0) throw new RefreshTokenConflictError();

        return raw;
      });

      return { accessToken, refreshToken, user: toSafeUser(user) };
    } catch (err) {
      if (err instanceof RefreshTokenConflictError) {
        await this.revokeFamily(existing.familyId);
        throw new UnauthorizedException('Refresh token reuse detected');
      }
      throw err;
    }
  }

  /** Revokes the whole token family so every device sharing it is logged out. */
  async logout(rawRefreshToken: string | undefined): Promise<void> {
    if (!rawRefreshToken) return;
    const tokenHash = this.hashRefreshToken(rawRefreshToken);
    const existing = await this.prisma.refreshToken.findUnique({ where: { tokenHash } });
    if (!existing) return;

    await this.revokeFamily(existing.familyId);
  }

  private async revokeFamily(familyId: string): Promise<void> {
    await this.prisma.refreshToken.updateMany({
      where: { familyId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
  }

  /** Revokes every currently-valid refresh token for a user, across every family/device. Used by UsersService on deactivate/reset-password. */
  async revokeAllTokensForUser(userId: number): Promise<void> {
    await this.prisma.refreshToken.updateMany({
      where: { userId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
  }

  async getSafeUserById(id: number): Promise<SafeUser> {
    const user = await this.prisma.user.findUnique({ where: { id } });
    if (!user || !user.isActive) {
      throw new UnauthorizedException();
    }
    return toSafeUser(user);
  }
}
