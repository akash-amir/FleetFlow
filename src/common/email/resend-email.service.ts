import { Injectable } from '@nestjs/common';
import type { EmailService, SendEmailInput } from './email.service.js';

const RESEND_API_URL = 'https://api.resend.com/emails';

/** Uses Node's built-in fetch — a single POST request doesn't need the `resend` SDK as a dependency. */
@Injectable()
export class ResendEmailService implements EmailService {
  async send(input: SendEmailInput): Promise<void> {
    const response = await fetch(RESEND_API_URL, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${process.env.RESEND_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: process.env.EMAIL_FROM,
        to: input.to,
        subject: input.subject,
        html: input.html,
        text: input.text,
      }),
    });

    if (!response.ok) {
      throw new Error(`Resend API error: ${response.status} ${await response.text()}`);
    }
  }
}
