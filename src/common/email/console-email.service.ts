import { Injectable, Logger } from '@nestjs/common';
import type { EmailService, SendEmailInput } from './email.service.js';

/** Used whenever RESEND_API_KEY is empty — logs the full email (including any link) instead of sending it, so local dev/tests never need a real provider. */
@Injectable()
export class ConsoleEmailService implements EmailService {
  private readonly logger = new Logger('Email');

  async send(input: SendEmailInput): Promise<void> {
    this.logger.log(`To: ${input.to}\nSubject: ${input.subject}\n\n${input.text}`);
  }
}
