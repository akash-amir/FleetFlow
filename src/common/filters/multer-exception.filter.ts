import { ArgumentsHost, BadRequestException, Catch, ExceptionFilter, PayloadTooLargeException } from '@nestjs/common';
import { MulterError } from 'multer';
import type { Response } from 'express';

/**
 * Multer's own errors (file too large, unexpected field, ...) don't go
 * through Nest's normal exception handling and would otherwise surface as a
 * raw 500. This maps them to proper HTTP responses — 413 for a size-limit
 * violation, 400 for anything else multer itself rejects.
 */
@Catch(MulterError)
export class MulterExceptionFilter implements ExceptionFilter {
  catch(exception: MulterError, host: ArgumentsHost) {
    const mapped =
      exception.code === 'LIMIT_FILE_SIZE'
        ? new PayloadTooLargeException(`File too large${exception.field ? ` (${exception.field})` : ''} — max 5 MB`)
        : new BadRequestException(exception.message);

    const response = host.switchToHttp().getResponse<Response>();
    response.status(mapped.getStatus()).json(mapped.getResponse());
  }
}
