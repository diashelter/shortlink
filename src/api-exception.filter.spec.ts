import { ArgumentsHost, HttpException, HttpStatus } from '@nestjs/common';
import { ApiExceptionFilter } from './api-exception.filter';

describe('ApiExceptionFilter', () => {
  let filter: ApiExceptionFilter;
  let status: jest.Mock;
  let json: jest.Mock;
  let host: ArgumentsHost;

  beforeEach(() => {
    filter = new ApiExceptionFilter();
    status = jest.fn().mockReturnThis();
    json = jest.fn();
    host = {
      switchToHttp: () => ({
        getResponse: () => ({ status, json }),
        getRequest: () => ({}),
      }),
    } as ArgumentsHost;
  });

  it('maps structured HttpException to the AUTH-009 envelope', () => {
    filter.catch(
      new HttpException(
        {
          code: 'INVALID_CREDENTIALS',
          message: 'Invalid credentials.',
        },
        HttpStatus.UNAUTHORIZED,
      ),
      host,
    );

    expect(status).toHaveBeenCalledWith(401);
    expect(json).toHaveBeenCalledWith({
      statusCode: 401,
      code: 'INVALID_CREDENTIALS',
      message: 'Invalid credentials.',
    });
  });

  it('includes errors only for 422 validation failures', () => {
    filter.catch(
      new HttpException(
        {
          code: 'VALIDATION_ERROR',
          message: 'Validation failed.',
          errors: { email: ['email must be an email'] },
        },
        HttpStatus.UNPROCESSABLE_ENTITY,
      ),
      host,
    );

    expect(status).toHaveBeenCalledWith(422);
    expect(json).toHaveBeenCalledWith({
      statusCode: 422,
      code: 'VALIDATION_ERROR',
      message: 'Validation failed.',
      errors: { email: ['email must be an email'] },
    });
  });

  it('omits errors for non-422 responses even when present on the exception', () => {
    filter.catch(
      new HttpException(
        {
          code: 'RATE_LIMITED',
          message: 'Too many requests.',
          errors: { any: ['ignored'] },
        },
        HttpStatus.TOO_MANY_REQUESTS,
      ),
      host,
    );

    expect(json).toHaveBeenCalledWith({
      statusCode: 429,
      code: 'RATE_LIMITED',
      message: 'Too many requests.',
    });
  });

  it('returns a generic 500 envelope for unexpected errors without leaking details', () => {
    filter.catch(new Error('secret database password=super-secret'), host);

    expect(status).toHaveBeenCalledWith(500);
    expect(json).toHaveBeenCalledWith({
      statusCode: 500,
      code: 'INTERNAL_SERVER_ERROR',
      message: 'Internal server error.',
    });
    const body = json.mock.calls[0][0] as Record<string, unknown>;
    expect(JSON.stringify(body)).not.toContain('super-secret');
  });
});
