import { validateEnvironment } from './environment.validation';

function omitEnvKey(
  env: Record<string, string>,
  key: string,
): Record<string, string> {
  const next = { ...env };
  delete next[key];
  return next;
}

const validEnv = {
  NODE_ENV: 'development',
  PORT: '3000',
  CORS_ALLOWED_ORIGINS: 'https://localhost:8443,https://app.example.com',
  TRUST_PROXY: 'true',
  AUTH_HMAC_SECRET: 'change-me-auth-hmac-secret-dev-only',
  AUTH_TOKEN_HASH_SECRET: 'change-me-auth-token-hash-secret-dev-only',
  JWT_ACCESS_SECRET: 'change-me-jwt-access-secret-dev-only',
  POSTGRES_DB: 'shortlink',
  POSTGRES_USER: 'shortlink',
  POSTGRES_PASSWORD: 'shortlink_dev_password',
  POSTGRES_HOST: 'postgres',
  POSTGRES_PORT: '5432',
  REDIS_HOST: 'redis',
  REDIS_PORT: '6379',
  MAILPIT_HOST: 'mailpit',
  MAILPIT_SMTP_PORT: '1025',
  MAIL_FROM: 'noreply@shortlink.local',
  EMAIL_QUEUE_ATTEMPTS: '5',
  EMAIL_QUEUE_BACKOFF_MS: '2000',
  FRONTEND_RESET_URL: 'https://localhost:8443/reset-password',
  PUBLIC_SHORT_URL_BASE: 'https://localhost:8443',
  LINK_CODE_GENERATION_MAX_ATTEMPTS: '5',
  LINK_RESOLUTION_CACHE_TTL_SECONDS: '300',
};

describe('validateEnvironment', () => {
  it('parses required bootstrap and infrastructure variables', () => {
    const config = validateEnvironment(validEnv);

    expect(config.port).toBe(3000);
    expect(config.corsAllowedOrigins).toEqual([
      'https://localhost:8443',
      'https://app.example.com',
    ]);
    expect(config.trustProxy).toBe(true);
    expect(config.authHmacSecret).toBe('change-me-auth-hmac-secret-dev-only');
    expect(config.authTokenHashSecret).toBe(
      'change-me-auth-token-hash-secret-dev-only',
    );
    expect(config.jwtAccessSecret).toBe('change-me-jwt-access-secret-dev-only');
    expect(config.postgres.host).toBe('postgres');
    expect(config.redis.host).toBe('redis');
    expect(config.mailpit.host).toBe('mailpit');
    expect(config.mail.from).toBe('noreply@shortlink.local');
    expect(config.emailQueue).toEqual({ attempts: 5, backoffMs: 2000 });
    expect(config.frontendResetUrl).toBe(
      'https://localhost:8443/reset-password',
    );
    expect(config.publicShortUrlBase).toBe('https://localhost:8443');
    expect(config.linkCodeGenerationMaxAttempts).toBe(5);
    expect(config.linkResolutionCacheTtlSeconds).toBe(300);
  });

  it('normalizes PUBLIC_SHORT_URL_BASE trailing slash to origin', () => {
    const config = validateEnvironment({
      ...validEnv,
      PUBLIC_SHORT_URL_BASE: 'https://localhost:8443/',
    });

    expect(config.publicShortUrlBase).toBe('https://localhost:8443');
  });

  it('defaults link code attempts and cache TTL when omitted', () => {
    const withoutOptionalLinks = omitEnvKey(
      omitEnvKey(validEnv, 'LINK_CODE_GENERATION_MAX_ATTEMPTS'),
      'LINK_RESOLUTION_CACHE_TTL_SECONDS',
    );

    const config = validateEnvironment(withoutOptionalLinks);

    expect(config.linkCodeGenerationMaxAttempts).toBe(5);
    expect(config.linkResolutionCacheTtlSeconds).toBe(300);
  });

  it('fails when PUBLIC_SHORT_URL_BASE is missing', () => {
    const withoutBase = omitEnvKey(validEnv, 'PUBLIC_SHORT_URL_BASE');

    expect(() => validateEnvironment(withoutBase)).toThrow(
      /PUBLIC_SHORT_URL_BASE/,
    );
  });

  it('rejects non-HTTPS PUBLIC_SHORT_URL_BASE', () => {
    expect(() =>
      validateEnvironment({
        ...validEnv,
        PUBLIC_SHORT_URL_BASE: 'http://localhost:8443',
      }),
    ).toThrow(/PUBLIC_SHORT_URL_BASE/);
  });

  it('rejects PUBLIC_SHORT_URL_BASE with path, query, fragment, or credentials', () => {
    expect(() =>
      validateEnvironment({
        ...validEnv,
        PUBLIC_SHORT_URL_BASE: 'https://localhost:8443/short',
      }),
    ).toThrow(/PUBLIC_SHORT_URL_BASE/);

    expect(() =>
      validateEnvironment({
        ...validEnv,
        PUBLIC_SHORT_URL_BASE: 'https://localhost:8443?x=1',
      }),
    ).toThrow(/PUBLIC_SHORT_URL_BASE/);

    expect(() =>
      validateEnvironment({
        ...validEnv,
        PUBLIC_SHORT_URL_BASE: 'https://localhost:8443#frag',
      }),
    ).toThrow(/PUBLIC_SHORT_URL_BASE/);

    expect(() =>
      validateEnvironment({
        ...validEnv,
        PUBLIC_SHORT_URL_BASE: 'https://user:pass@localhost:8443',
      }),
    ).toThrow(/PUBLIC_SHORT_URL_BASE/);
  });

  it('rejects non-positive link code attempts and cache TTL', () => {
    expect(() =>
      validateEnvironment({
        ...validEnv,
        LINK_CODE_GENERATION_MAX_ATTEMPTS: '0',
      }),
    ).toThrow(/LINK_CODE_GENERATION_MAX_ATTEMPTS/);

    expect(() =>
      validateEnvironment({
        ...validEnv,
        LINK_RESOLUTION_CACHE_TTL_SECONDS: '-1',
      }),
    ).toThrow(/LINK_RESOLUTION_CACHE_TTL_SECONDS/);
  });

  it('fails when AUTH_HMAC_SECRET is missing', () => {
    const withoutHmac = omitEnvKey(validEnv, 'AUTH_HMAC_SECRET');

    expect(() => validateEnvironment(withoutHmac)).toThrow(/AUTH_HMAC_SECRET/);
  });

  it('fails when AUTH_TOKEN_HASH_SECRET is missing', () => {
    const withoutTokenHash = omitEnvKey(validEnv, 'AUTH_TOKEN_HASH_SECRET');

    expect(() => validateEnvironment(withoutTokenHash)).toThrow(
      /AUTH_TOKEN_HASH_SECRET/,
    );
  });

  it('fails when JWT_ACCESS_SECRET is missing', () => {
    const withoutJwt = omitEnvKey(validEnv, 'JWT_ACCESS_SECRET');

    expect(() => validateEnvironment(withoutJwt)).toThrow(/JWT_ACCESS_SECRET/);
  });

  it('falls back to API_CONTAINER_PORT when PORT is absent', () => {
    const withoutPort = omitEnvKey(validEnv, 'PORT');

    const config = validateEnvironment({
      ...withoutPort,
      API_CONTAINER_PORT: '4000',
    });

    expect(config.port).toBe(4000);
  });

  it('defaults TRUST_PROXY to false when omitted', () => {
    const withoutTrustProxy = omitEnvKey(validEnv, 'TRUST_PROXY');

    expect(validateEnvironment(withoutTrustProxy).trustProxy).toBe(false);
  });

  it('fails when CORS_ALLOWED_ORIGINS is missing', () => {
    const withoutCors = omitEnvKey(validEnv, 'CORS_ALLOWED_ORIGINS');

    expect(() => validateEnvironment(withoutCors)).toThrow(
      /CORS_ALLOWED_ORIGINS/,
    );
  });

  it('rejects wildcard CORS origins when credentials are enabled', () => {
    expect(() =>
      validateEnvironment({
        ...validEnv,
        CORS_ALLOWED_ORIGINS: '*',
      }),
    ).toThrow(/wildcard|\*/i);
  });

  it('fails when a required infrastructure variable is missing', () => {
    const withoutPostgresHost = omitEnvKey(validEnv, 'POSTGRES_HOST');

    expect(() => validateEnvironment(withoutPostgresHost)).toThrow(
      /POSTGRES_HOST/,
    );
  });
});
