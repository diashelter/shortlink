import { AuthAuditEventRecord, RecordAuthAuditEventInput } from './auth.types';

export abstract class AuthAuditService {
  abstract record(
    input: RecordAuthAuditEventInput,
  ): Promise<AuthAuditEventRecord>;
}
