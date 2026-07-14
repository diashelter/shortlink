import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { Response } from 'express';

type ErrorBody = {
  statusCode: number;
  code: string;
  message: string;
  errors?: Record<string, string[]>;
};

@Catch()
export class ApiExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(ApiExceptionFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    const response = host.switchToHttp().getResponse<Response>();
    const body = this.toErrorBody(exception);

    if (body.code === 'ACCOUNT_TEMPORARILY_LOCKED') {
      response.setHeader('Retry-After', '3600');
    }

    response.status(body.statusCode).json(body);
  }

  private toErrorBody(exception: unknown): ErrorBody {
    if (!(exception instanceof HttpException)) {
      this.logger.error('Unhandled exception');
      return {
        statusCode: HttpStatus.INTERNAL_SERVER_ERROR,
        code: 'INTERNAL_SERVER_ERROR',
        message: 'Internal server error.',
      };
    }

    const statusCode = exception.getStatus();
    const exceptionResponse = exception.getResponse();

    if (typeof exceptionResponse === 'string') {
      return {
        statusCode,
        code: this.codeFromStatus(statusCode),
        message: exceptionResponse,
      };
    }

    const payload = exceptionResponse as Record<string, unknown>;
    const code =
      typeof payload.code === 'string'
        ? payload.code
        : this.codeFromStatus(statusCode);
    const message =
      typeof payload.message === 'string'
        ? payload.message
        : Array.isArray(payload.message)
          ? 'Validation failed.'
          : exception.message;

    const body: ErrorBody = {
      statusCode,
      code,
      message,
    };

    if (
      statusCode === HttpStatus.UNPROCESSABLE_ENTITY &&
      this.isFieldErrors(payload.errors)
    ) {
      body.errors = payload.errors;
    }

    return body;
  }

  private codeFromStatus(statusCode: number): string {
    if (statusCode === HttpStatus.UNPROCESSABLE_ENTITY) {
      return 'VALIDATION_ERROR';
    }

    if (statusCode === HttpStatus.INTERNAL_SERVER_ERROR) {
      return 'INTERNAL_SERVER_ERROR';
    }

    return 'HTTP_ERROR';
  }

  private isFieldErrors(
    value: unknown,
  ): value is Record<string, string[]> {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      return false;
    }

    return Object.values(value).every(
      (entry) =>
        Array.isArray(entry) &&
        entry.every((message) => typeof message === 'string'),
    );
  }
}
