export enum SessionRevocationReason {
  LOGOUT = 'LOGOUT',
  NEW_LOGIN = 'NEW_LOGIN',
  PASSWORD_RESET = 'PASSWORD_RESET',
  REFRESH_REUSE = 'REFRESH_REUSE',
}

export enum AuthAuditEventType {
  SESSION_CREATED = 'SESSION_CREATED',
  SESSION_REVOKED = 'SESSION_REVOKED',
  LOGIN_LOCKED = 'LOGIN_LOCKED',
  PASSWORD_RESET = 'PASSWORD_RESET',
}

/** Sanitized audit payload — never include passwords, codes, tokens, raw emails, or headers. */
export type AuthAuditMetadata = Record<string, string | number | boolean | null>;
