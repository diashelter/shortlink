import { NestFactory } from '@nestjs/core';
import {
  INestApplication,
  UnprocessableEntityException,
  ValidationError,
  ValidationPipe,
} from '@nestjs/common';
import { NestExpressApplication } from '@nestjs/platform-express';
import * as cookieParser from 'cookie-parser';
import { AppModule } from './app.module';
import { ApiExceptionFilter } from './api-exception.filter';
import { AppEnvironment, validateEnvironment } from './environment.validation';

const JSON_PAYLOAD_LIMIT = '100kb';

function formatValidationErrors(
  errors: ValidationError[],
  parentPath = '',
): Record<string, string[]> {
  const formatted: Record<string, string[]> = {};

  for (const error of errors) {
    const path = parentPath
      ? `${parentPath}.${error.property}`
      : error.property;

    if (error.constraints) {
      formatted[path] = Object.values(error.constraints);
    }

    if (error.children?.length) {
      Object.assign(formatted, formatValidationErrors(error.children, path));
    }
  }

  return formatted;
}

export function createValidationPipe(): ValidationPipe {
  return new ValidationPipe({
    whitelist: true,
    forbidNonWhitelisted: true,
    transform: true,
    exceptionFactory: (errors: ValidationError[]) =>
      new UnprocessableEntityException({
        code: 'VALIDATION_ERROR',
        message: 'Validation failed.',
        errors: formatValidationErrors(errors),
      }),
  });
}

export function configureApp(app: INestApplication, env: AppEnvironment): void {
  const expressApp = app as NestExpressApplication;

  expressApp.setGlobalPrefix('api/v1');
  expressApp.use(cookieParser());
  expressApp.useGlobalPipes(createValidationPipe());
  expressApp.useGlobalFilters(new ApiExceptionFilter());
  expressApp.useBodyParser('json', { limit: JSON_PAYLOAD_LIMIT });
  expressApp.enableCors({
    origin: env.corsAllowedOrigins,
    credentials: true,
  });

  if (env.trustProxy) {
    expressApp.set('trust proxy', 1);
  }
}

async function bootstrap(): Promise<void> {
  // Load local .env for vars not yet injected by Compose (e.g. CORS allowlist).
  // eslint-disable-next-line @typescript-eslint/no-require-imports, @typescript-eslint/no-var-requires
  require('dotenv').config({ quiet: true });

  const env = validateEnvironment(process.env);
  const app = await NestFactory.create<NestExpressApplication>(AppModule);

  configureApp(app, env);
  await app.listen(env.port);
}

if (require.main === module) {
  void bootstrap();
}
