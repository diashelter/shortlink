import { validateEnvironment } from './environment.validation';

const validEnv = {
  NODE_ENV: 'development',
  PORT: '3000',
  CORS_ALLOWED_ORIGINS: 'https://localhost:8443,https://app.example.com',
  TRUST_PROXY: 'true',
  POSTGRES_DB: 'shortlink',
  POSTGRES_USER: 'shortlink',
  POSTGRES_PASSWORD: 'shortlink_dev_password',
  POSTGRES_HOST: 'postgres',
  POSTGRES_PORT: '5432',
  REDIS_HOST: 'redis',
  REDIS_PORT: '6379',
  MAILPIT_HOST: 'mailpit',
  MAILPIT_SMTP_PORT: '1025',
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
    expect(config.postgres.host).toBe('postgres');
    expect(config.redis.host).toBe('redis');
    expect(config.mailpit.host).toBe('mailpit');
  });

  it('falls back to API_CONTAINER_PORT when PORT is absent', () => {
    const { PORT: _port, ...withoutPort } = validEnv;

    const config = validateEnvironment({
      ...withoutPort,
      API_CONTAINER_PORT: '4000',
    });

    expect(config.port).toBe(4000);
  });

  it('defaults TRUST_PROXY to false when omitted', () => {
    const { TRUST_PROXY: _trustProxy, ...withoutTrustProxy } = validEnv;

    expect(validateEnvironment(withoutTrustProxy).trustProxy).toBe(false);
  });

  it('fails when CORS_ALLOWED_ORIGINS is missing', () => {
    const { CORS_ALLOWED_ORIGINS: _cors, ...withoutCors } = validEnv;

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
    const { POSTGRES_HOST: _host, ...withoutPostgresHost } = validEnv;

    expect(() => validateEnvironment(withoutPostgresHost)).toThrow(
      /POSTGRES_HOST/,
    );
  });
});
