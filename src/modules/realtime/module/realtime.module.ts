import { Module } from '@nestjs/common';
import { AuthModule } from '../../auth/module/auth.module.js';
import { CustomerJwtModule } from '../../../common/jwt/customer-jwt.module.js';
import { RealtimeGateway } from '../gateway/realtime.gateway.js';
import { RealtimeService } from '../service/realtime.service.js';

@Module({
  imports: [AuthModule, CustomerJwtModule], // staff + customer JwtServices — same secrets/rules as HTTP auth
  providers: [RealtimeGateway, RealtimeService],
})
export class RealtimeModule {}
