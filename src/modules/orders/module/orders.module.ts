import { Module } from '@nestjs/common';
import { OrdersController } from '../controller/orders.controller.js';
import { OrdersService } from '../service/orders.service.js';

@Module({
  controllers: [OrdersController],
  providers: [OrdersService],
})
export class OrdersModule {}
