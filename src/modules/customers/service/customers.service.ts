import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import type { Customer, Prisma } from '@prisma/client';
import { PrismaService } from '../../../prisma/prisma.service.js';
import type { PaginatedResult } from '../../../common/pagination.js';
import { isUniqueConstraintError } from '../../../common/prisma-errors.js';
import { CreateCustomerDto } from '../dto/create-customer.dto.js';
import { UpdateCustomerDto } from '../dto/update-customer.dto.js';
import { ListCustomersQueryDto } from '../dto/list-customers.query.dto.js';

@Injectable()
export class CustomersService {
  constructor(private readonly prisma: PrismaService) {}

  async create(dto: CreateCustomerDto): Promise<Customer> {
    try {
      return await this.prisma.customer.create({ data: dto });
    } catch (err) {
      if (isUniqueConstraintError(err)) {
        throw new ConflictException('A customer with this email already exists');
      }
      throw err;
    }
  }

  async findAll(query: ListCustomersQueryDto): Promise<PaginatedResult<Customer>> {
    const where: Prisma.CustomerWhereInput = query.search
      ? {
          OR: [
            { companyName: { contains: query.search, mode: 'insensitive' } },
            { email: { contains: query.search, mode: 'insensitive' } },
          ],
        }
      : {};

    const [data, total] = await Promise.all([
      this.prisma.customer.findMany({
        where,
        skip: (query.page - 1) * query.limit,
        take: query.limit,
        orderBy: { id: 'asc' },
      }),
      this.prisma.customer.count({ where }),
    ]);

    return { data, meta: { page: query.page, limit: query.limit, total } };
  }

  async findOne(id: number): Promise<Customer> {
    const customer = await this.prisma.customer.findUnique({ where: { id } });
    if (!customer) throw new NotFoundException('Customer not found');
    return customer;
  }

  async update(id: number, dto: UpdateCustomerDto): Promise<Customer> {
    await this.findOne(id); // 404 if missing
    try {
      return await this.prisma.customer.update({ where: { id }, data: dto });
    } catch (err) {
      if (isUniqueConstraintError(err)) {
        throw new ConflictException('A customer with this email already exists');
      }
      throw err;
    }
  }

  // No delete: customers with orders must never disappear (PROJECT.md).
}
