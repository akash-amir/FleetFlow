import { Body, Controller, Get, HttpCode, Param, ParseIntPipe, Patch, Post, Query } from '@nestjs/common';
import { Permissions } from '../../../common/decorators/permissions.decorator.js';
import { CustomersService } from '../service/customers.service.js';
import { CustomerUsersService } from '../service/customer-users.service.js';
import { CreateCustomerDto } from '../dto/create-customer.dto.js';
import { UpdateCustomerDto } from '../dto/update-customer.dto.js';
import { ListCustomersQueryDto } from '../dto/list-customers.query.dto.js';
import { InviteCustomerUserDto } from '../dto/invite-customer-user.dto.js';
import { ListCustomerUsersQueryDto } from '../dto/list-customer-users.query.dto.js';

@Controller('customers')
export class CustomersController {
  constructor(
    private readonly customersService: CustomersService,
    private readonly customerUsersService: CustomerUsersService,
  ) {}

  @Post()
  @Permissions('customer:create')
  create(@Body() dto: CreateCustomerDto) {
    return this.customersService.create(dto);
  }

  @Get()
  @Permissions('customer:read')
  findAll(@Query() query: ListCustomersQueryDto) {
    return this.customersService.findAll(query);
  }

  @Get(':id')
  @Permissions('customer:read')
  findOne(@Param('id', ParseIntPipe) id: number) {
    return this.customersService.findOne(id);
  }

  @Patch(':id')
  @Permissions('customer:create')
  update(@Param('id', ParseIntPipe) id: number, @Body() dto: UpdateCustomerDto) {
    return this.customersService.update(id, dto);
  }

  // Portal-user management reuses 'customer:create' rather than a new
  // permission string — inviting/deactivating a customer's own portal
  // contacts is part of managing that customer record, not a distinct
  // permission surface (same reasoning as Orders' PATCH endpoints).
  @Post(':id/users')
  @Permissions('customer:create')
  inviteUser(@Param('id', ParseIntPipe) id: number, @Body() dto: InviteCustomerUserDto) {
    return this.customerUsersService.invite(id, dto);
  }

  @Get(':id/users')
  @Permissions('customer:read')
  listUsers(@Param('id', ParseIntPipe) id: number, @Query() query: ListCustomerUsersQueryDto) {
    return this.customerUsersService.findAllForCustomer(id, query);
  }

  @Post(':id/users/:userId/resend-invite')
  @Permissions('customer:create')
  @HttpCode(200)
  async resendInvite(@Param('id', ParseIntPipe) id: number, @Param('userId', ParseIntPipe) userId: number) {
    await this.customerUsersService.resendInvite(id, userId);
    return { success: true };
  }

  @Patch(':id/users/:userId/deactivate')
  @Permissions('customer:create')
  deactivateUser(@Param('id', ParseIntPipe) id: number, @Param('userId', ParseIntPipe) userId: number) {
    return this.customerUsersService.setActive(id, userId, false);
  }

  @Patch(':id/users/:userId/activate')
  @Permissions('customer:create')
  activateUser(@Param('id', ParseIntPipe) id: number, @Param('userId', ParseIntPipe) userId: number) {
    return this.customerUsersService.setActive(id, userId, true);
  }
}
