import { Injectable, OnModuleDestroy } from '@nestjs/common';
import { createTransport, type SentMessageInfo, type Transporter } from 'nodemailer';
import { validateEnvironment } from './environment.validation';

export type SmtpSendMailInput = {
  to: string;
  subject: string;
  text: string;
  html?: string;
};

@Injectable()
export class SmtpMailService implements OnModuleDestroy {
  private readonly transporter: Transporter;
  private readonly mailFrom: string;

  constructor() {
    const env = validateEnvironment();
    this.mailFrom = env.mail.from;
    this.transporter = createTransport({
      host: env.mailpit.host,
      port: env.mailpit.smtpPort,
      secure: false,
    });
  }

  verify(): Promise<true> {
    return this.transporter.verify();
  }

  sendMail(input: SmtpSendMailInput): Promise<SentMessageInfo> {
    return this.transporter.sendMail({
      from: this.mailFrom,
      to: input.to,
      subject: input.subject,
      text: input.text,
      html: input.html,
    });
  }

  async onModuleDestroy(): Promise<void> {
    this.transporter.close();
  }
}
