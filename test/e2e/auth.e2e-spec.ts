import { INestApplication } from '@nestjs/common';
import * as request from 'supertest';
import { createE2eApp } from './create-e2e-app';
import { createTrustedHttpsAgent, trustedHttpsRequest } from './https-client';

describe('Auth HTTP module (e2e)', () => {
  let app: INestApplication;

  beforeAll(async () => {
    app = await createE2eApp();
  });

  afterAll(async () => {
    await app.close();
  });

  it('rejects register payloads with unknown fields using the 422 envelope', async () => {
    const response = await request(app.getHttpServer())
      .post('/api/v1/auth/register')
      .send({
        email: 'user@example.com',
        password: 'Valid1!pass',
        passwordConfirmation: 'Valid1!pass',
        role: 'ADMIN',
      })
      .expect(422);

    expect(response.body).toEqual(
      expect.objectContaining({
        statusCode: 422,
        code: 'VALIDATION_ERROR',
        message: expect.any(String),
        errors: expect.objectContaining({
          role: expect.any(Array),
        }),
      }),
    );
  });

  it('rejects invalid login payloads using the 422 envelope', async () => {
    const response = await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({
        email: 'not-an-email',
        password: '',
      })
      .expect(422);

    expect(response.body).toEqual(
      expect.objectContaining({
        statusCode: 422,
        code: 'VALIDATION_ERROR',
        message: expect.any(String),
        errors: expect.any(Object),
      }),
    );
    expect(response.body.errors.email).toEqual(expect.any(Array));
    expect(response.body.errors.password).toEqual(expect.any(Array));
  });

  it('rejects the test-only protected route without a JWT using the error envelope', async () => {
    const response = await request(app.getHttpServer())
      .get('/api/v1/auth/test/protected')
      .expect(401);

    expect(response.body).toEqual(
      expect.objectContaining({
        statusCode: 401,
        code: expect.any(String),
        message: expect.any(String),
      }),
    );
    expect(response.body.errors).toBeUndefined();
  });

  it('trusts the local CA for HTTPS without disabling TLS validation', async () => {
    const agent = createTrustedHttpsAgent();
    expect(agent.options.rejectUnauthorized).not.toBe(false);

    const response = await trustedHttpsRequest({
      method: 'GET',
      path: '/api/v1',
    });

    expect(response.statusCode).toBe(200);
    expect(response.body).toBe('Hello World!');
  });

  it('returns the 422 validation envelope over trusted HTTPS', async () => {
    const response = await trustedHttpsRequest({
      method: 'POST',
      path: '/api/v1/auth/register',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        email: 'user@example.com',
        password: 'Valid1!pass',
        passwordConfirmation: 'Valid1!pass',
        unexpected: true,
      }),
    });

    expect(response.statusCode).toBe(422);

    const body = JSON.parse(response.body) as {
      statusCode: number;
      code: string;
      message: string;
      errors?: Record<string, string[]>;
    };

    expect(body).toEqual(
      expect.objectContaining({
        statusCode: 422,
        code: 'VALIDATION_ERROR',
        message: expect.any(String),
        errors: expect.objectContaining({
          unexpected: expect.any(Array),
        }),
      }),
    );
  });
});
