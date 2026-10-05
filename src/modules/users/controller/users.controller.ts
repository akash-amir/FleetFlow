import { Body, Controller, Get, HttpCode, Param, ParseIntPipe, Patch, Post, Query } from '@nestjs/common';
import { Permissions } from '../../../common/decorators/permissions.decorator.js';
import { CurrentUser, type AuthUser } from '../../../common/decorators/current-user.decorator.js';
import { UsersService } from '../service/users.service.js';
import { CreateUserDto } from '../dto/create-user.dto.js';
import { UpdateUserDto } from '../dto/update-user.dto.js';
import { ResetPasswordDto } from '../dto/reset-password.dto.js';
import { ListUsersQueryDto } from '../dto/list-users.query.dto.js';

@Controller('users')
export class UsersController {
  constructor(private readonly usersService: UsersService) {}

  @Post()
  @Permissions('user:create')
  create(@Body() dto: CreateUserDto) {
    return this.usersService.create(dto);
  }

  @Get()
  @Permissions('user:read')
  findAll(@Query() query: ListUsersQueryDto) {
    return this.usersService.findAll(query);
  }

  @Get(':id')
  @Permissions('user:read')
  findOne(@Param('id', ParseIntPipe) id: number) {
    return this.usersService.findOne(id);
  }

  @Patch(':id')
  @Permissions('user:update')
  update(@Param('id', ParseIntPipe) id: number, @Body() dto: UpdateUserDto) {
    return this.usersService.update(id, dto);
  }

  @Patch(':id/deactivate')
  @Permissions('user:deactivate')
  deactivate(@Param('id', ParseIntPipe) id: number, @CurrentUser() currentUser: AuthUser) {
    return this.usersService.setActive(id, false, currentUser.sub);
  }

  @Patch(':id/activate')
  @Permissions('user:activate')
  activate(@Param('id', ParseIntPipe) id: number, @CurrentUser() currentUser: AuthUser) {
    return this.usersService.setActive(id, true, currentUser.sub);
  }

  @Patch(':id/reset-password')
  @Permissions('user:resetPassword')
  @HttpCode(200)
  async resetPassword(@Param('id', ParseIntPipe) id: number, @Body() dto: ResetPasswordDto) {
    await this.usersService.resetPassword(id, dto.newPassword);
    return { success: true };
  }
}
