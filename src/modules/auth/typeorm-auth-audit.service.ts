import { Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { AuthAuditEventEntity } from './auth-audit-event.entity';
import { AuthAuditService } from './auth-audit.service';
import {
  AuthAuditEventRecord,
  AuthAuditMetadata,
  RecordAuthAuditEventInput,
} from './auth.types';

const SENSITIVE_METADATA_KEYS = new Set([
  'password',
  'passwordconfirmation',
  'passwordhash',
  'code',
  'verificationcode',
  'refreshtoken',
  'resettoken',
  'accesstoken',
  'csrftoken',
  'token',
  'email',
  'rawemail',
  'authorization',
  'cookie',
  'cookies',
  'header',
  'headers',
]);

const EMAIL_VALUE_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

@Injectable()
export class TypeormAuthAuditService extends AuthAuditService {
  constructor(private readonly dataSource: DataSource) {
    super();
  }

  async record(input: RecordAuthAuditEventInput): Promise<AuthAuditEventRecord> {
    const events = this.dataSource.getRepository(AuthAuditEventEntity);
    const saved = await events.save(
      events.create({
        userId: input.userId ?? null,
        type: input.type,
        sessionId: input.sessionId ?? null,
        ipHash: input.ipHash ?? null,
        metadata: sanitizeAuthAuditMetadata(input.metadata),
      }),
    );

    return this.toRecord(saved);
  }

  private toRecord(entity: AuthAuditEventEntity): AuthAuditEventRecord {
    return {
      id: entity.id,
      userId: entity.userId,
      type: entity.type,
      sessionId: entity.sessionId,
      ipHash: entity.ipHash,
      createdAt: entity.createdAt,
      metadata: entity.metadata,
    };
  }
}

export function sanitizeAuthAuditMetadata(
  metadata: AuthAuditMetadata | null | undefined,
): AuthAuditMetadata | null {
  if (metadata == null) {
    return null;
  }

  const sanitized: AuthAuditMetadata = {};

  for (const [key, value] of Object.entries(metadata)) {
    if (isSensitiveMetadataKey(key)) {
      continue;
    }

    if (typeof value === 'string' && looksLikeRawEmail(value)) {
      continue;
    }

    sanitized[key] = value;
  }

  return Object.keys(sanitized).length > 0 ? sanitized : null;
}

function isSensitiveMetadataKey(key: string): boolean {
  const normalized = key.toLowerCase().replace(/[^a-z0-9]/g, '');
  return SENSITIVE_METADATA_KEYS.has(normalized);
}

function looksLikeRawEmail(value: string): boolean {
  return EMAIL_VALUE_PATTERN.test(value.trim());
}
