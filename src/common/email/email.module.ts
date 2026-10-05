import { Module } from '@nestjs/common';
import { EMAIL_SERVICE } from './email.service.js';
import { ConsoleEmailService } from './console-email.service.js';
import { ResendEmailService } from './resend-email.service.js';

@Module({
  providers: [
    {
      provide: EMAIL_SERVICE,
      useFactory: () => (process.env.RESEND_API_KEY ? new ResendEmailService() : new ConsoleEmailService()),
    },
  ],
  exports: [EMAIL_SERVICE],
})
export class EmailModule {}
