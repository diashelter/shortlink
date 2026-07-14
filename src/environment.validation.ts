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
  linkStatsPseudonymSecret: string;
  linkStatsQueue: {
    attempts: number;
    backoffMs: number;
  };
  geoipCountryDbPath: string | undefined;
  frontendResetUrl: string;
  publicShortUrlBase: string;
  linkCodeGenerationMaxAttempts: number;
  linkResolutionCacheTtlSeconds: number;
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

function parsePositiveIntOrDefault(
  value: string | undefined,
  key: string,
  fallback: number,
): number {
  if (value === undefined || value.trim() === '') {
    return fallback;
  }

  return parsePositiveInt(value, key);
}

function parsePublicShortUrlBase(raw: string): string {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new Error(
      'Invalid PUBLIC_SHORT_URL_BASE: must be an absolute HTTPS origin',
    );
  }

  if (url.protocol !== 'https:') {
    throw new Error(
      'Invalid PUBLIC_SHORT_URL_BASE: must use the HTTPS protocol',
    );
  }

  if (url.username || url.password) {
    throw new Error(
      'Invalid PUBLIC_SHORT_URL_BASE: must not include credentials',
    );
  }

  if (url.search || url.hash) {
    throw new Error(
      'Invalid PUBLIC_SHORT_URL_BASE: must not include query string or fragment',
    );
  }

  if (url.pathname !== '/' && url.pathname !== '') {
    throw new Error(
      'Invalid PUBLIC_SHORT_URL_BASE: must not include a path beyond /',
    );
  }

  return url.origin;
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
    linkStatsPseudonymSecret: required(env, 'LINK_STATS_PSEUDONYM_SECRET'),
    linkStatsQueue: {
      attempts: parsePositiveInt(
        required(env, 'LINK_STATS_QUEUE_ATTEMPTS'),
        'LINK_STATS_QUEUE_ATTEMPTS',
      ),
      backoffMs: parsePositiveInt(
        required(env, 'LINK_STATS_QUEUE_BACKOFF_MS'),
        'LINK_STATS_QUEUE_BACKOFF_MS',
      ),
    },
    geoipCountryDbPath: parseOptionalPath(env.GEOIP_COUNTRY_DB_PATH),
    frontendResetUrl: required(env, 'FRONTEND_RESET_URL'),
    publicShortUrlBase: parsePublicShortUrlBase(
      required(env, 'PUBLIC_SHORT_URL_BASE'),
    ),
    linkCodeGenerationMaxAttempts: parsePositiveIntOrDefault(
      env.LINK_CODE_GENERATION_MAX_ATTEMPTS,
      'LINK_CODE_GENERATION_MAX_ATTEMPTS',
      5,
    ),
    linkResolutionCacheTtlSeconds: parsePositiveIntOrDefault(
      env.LINK_RESOLUTION_CACHE_TTL_SECONDS,
      'LINK_RESOLUTION_CACHE_TTL_SECONDS',
      300,
    ),
  };
}

function parseOptionalPath(value: string | undefined): string | undefined {
  if (value === undefined || value.trim() === '') {
    return undefined;
  }

  return value.trim();
}
