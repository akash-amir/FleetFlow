/** Injection token — tests swap in a fake instead of hitting Resend or the console. */
export const EMAIL_SERVICE = 'EMAIL_SERVICE';

export interface SendEmailInput {
  to: string;
  subject: string;
  html: string;
  text: string;
}

export interface EmailService {
  send(input: SendEmailInput): Promise<void>;
}
