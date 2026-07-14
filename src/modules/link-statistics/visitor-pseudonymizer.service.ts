import { createHmac } from 'crypto';
import { Injectable } from '@nestjs/common';
import { validateEnvironment } from '../../environment.validation';

@Injectable()
export class VisitorPseudonymizer {
  private readonly secret: string;

  constructor(secret?: string) {
    this.secret = secret ?? validateEnvironment().linkStatsPseudonymSecret;
  }

  create(
    linkId: string,
    occurredOn: string,
    ip: string,
    userAgent: string,
  ): string {
    const material = `${linkId}|${occurredOn}|${ip}|${userAgent}`;
    return createHmac('sha256', this.secret).update(material).digest('hex');
  }
}
