export type AppEnvironment = {
  nodeEnv: string;
  port: number;
  corsAllowedOrigins: string[];
  trustProxy: boolean;
  authHmacSecret: string;
  authTokenHashSecret: string;
  jwtAccessSecret: string;
  postgres: {
    db: string;
    user: string;
    password: string;
    host: string;
    port: number;
  };
  redis: {
    host: string;
    port: number;
  };
  mailpit: {
    host: string;
    smtpPort: number;
  };
  mail: {
    from: string;
  };
  emailQueue: {
    attempts: number;
    backoffMs: number;
  };
};

function required(env: NodeJS.Dict<string>, key: string): string {
  const value = env[key]?.trim();
  if (!value) {
    throw new Error(`Missing required environment variable: ${key}`);
  }

  return value;
}

function parsePort(value: string, key: string): number {
  const port = Number(value);
  if (!Number.isInteger(port) || port <= 0 || port > 65535) {
    throw new Error(`Invalid port for ${key}: ${value}`);
  }

  return port;
}

function parseBoolean(value: string | undefined, fallback: boolean): boolean {
  if (value === undefined || value.trim() === '') {
    return fallback;
  }

  const normalized = value.trim().toLowerCase();
  if (['1', 'true', 'yes', 'on'].includes(normalized)) {
    return true;
  }

  if (['0', 'false', 'no', 'off'].includes(normalized)) {
    return false;
  }

  throw new Error(`Invalid boolean value: ${value}`);
}

function parseCorsOrigins(raw: string): string[] {
  const origins = raw
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean);

  if (origins.length === 0) {
    throw new Error('CORS_ALLOWED_ORIGINS must contain at least one origin');
  }

  if (origins.includes('*')) {
    throw new Error(
      'CORS_ALLOWED_ORIGINS cannot include wildcard (*) when credentials are enabled',
    );
  }

  return origins;
}

function parsePositiveInt(value: string, key: string): number {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(`Invalid positive integer for ${key}: ${value}`);
  }

  return parsed;
}

export function validateEnvironment(
  env: NodeJS.Dict<string> = process.env,
): AppEnvironment {
  const portRaw = env.PORT?.trim() || env.API_CONTAINER_PORT?.trim();
  if (!portRaw) {
    throw new Error('Missing required environment variable: PORT');
  }

  return {
    nodeEnv: required(env, 'NODE_ENV'),
    port: parsePort(portRaw, 'PORT'),
    corsAllowedOrigins: parseCorsOrigins(required(env, 'CORS_ALLOWED_ORIGINS')),
    trustProxy: parseBoolean(env.TRUST_PROXY, false),
    authHmacSecret: required(env, 'AUTH_HMAC_SECRET'),
    authTokenHashSecret: required(env, 'AUTH_TOKEN_HASH_SECRET'),
    jwtAccessSecret: required(env, 'JWT_ACCESS_SECRET'),
    postgres: {
      db: required(env, 'POSTGRES_DB'),
      user: required(env, 'POSTGRES_USER'),
      password: required(env, 'POSTGRES_PASSWORD'),
      host: required(env, 'POSTGRES_HOST'),
      port: parsePort(required(env, 'POSTGRES_PORT'), 'POSTGRES_PORT'),
    },
    redis: {
      host: required(env, 'REDIS_HOST'),
      port: parsePort(required(env, 'REDIS_PORT'), 'REDIS_PORT'),
    },
    mailpit: {
      host: required(env, 'MAILPIT_HOST'),
      smtpPort: parsePort(
        required(env, 'MAILPIT_SMTP_PORT'),
        'MAILPIT_SMTP_PORT',
      ),
    },
    mail: {
      from: required(env, 'MAIL_FROM'),
    },
    emailQueue: {
      attempts: parsePositiveInt(
        required(env, 'EMAIL_QUEUE_ATTEMPTS'),
        'EMAIL_QUEUE_ATTEMPTS',
      ),
      backoffMs: parsePositiveInt(
        required(env, 'EMAIL_QUEUE_BACKOFF_MS'),
        'EMAIL_QUEUE_BACKOFF_MS',
      ),
    },
  };
}
