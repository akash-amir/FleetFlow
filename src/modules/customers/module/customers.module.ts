import { Module } from '@nestjs/common';
import { EmailModule } from '../../../common/email/email.module.js';
import { CustomersController } from '../controller/customers.controller.js';
import { CustomersService } from '../service/customers.service.js';
import { CustomerUsersService } from '../service/customer-users.service.js';

@Module({
  imports: [EmailModule],
  controllers: [CustomersController],
  providers: [CustomersService, CustomerUsersService],
})
export class CustomersModule {}
