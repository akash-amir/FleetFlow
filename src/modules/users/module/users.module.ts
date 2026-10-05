import { Module } from '@nestjs/common';
import { AuthModule } from '../../auth/module/auth.module.js';
import { UsersController } from '../controller/users.controller.js';
import { UsersService } from '../service/users.service.js';

@Module({
  imports: [AuthModule],
  controllers: [UsersController],
  providers: [UsersService],
})
export class UsersModule {}
