import {
  Body,
  Controller,
  INestApplication,
  Post,
  Module,
} from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { IsEmail, IsString } from 'class-validator';
import * as request from 'supertest';
import { ApiExceptionFilter } from './api-exception.filter';
import { createValidationPipe } from './main';

class SampleDto {
  @IsEmail()
  email!: string;

  @IsString()
  name!: string;
}

@Controller('sample')
class SampleController {
  @Post()
  create(@Body() body: SampleDto) {
    return body;
  }
}

@Module({ controllers: [SampleController] })
class SampleModule {}

describe('HTTP bootstrap validation', () => {
  let app: INestApplication;

  beforeEach(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [SampleModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    app.useGlobalPipes(createValidationPipe());
    app.useGlobalFilters(new ApiExceptionFilter());
    await app.init();
  });

  afterEach(async () => {
    await app.close();
  });

  it('returns 422 VALIDATION_ERROR with per-field errors for unknown properties', async () => {
    const response = await request(app.getHttpServer())
      .post('/sample')
      .send({
        email: 'user@example.com',
        name: 'Ada',
        unexpected: 'value',
      })
      .expect(422);

    expect(response.body).toEqual({
      statusCode: 422,
      code: 'VALIDATION_ERROR',
      message: 'Validation failed.',
      errors: expect.objectContaining({
        unexpected: expect.any(Array),
      }),
    });
  });

  it('returns 422 VALIDATION_ERROR for invalid DTO fields', async () => {
    const response = await request(app.getHttpServer())
      .post('/sample')
      .send({
        email: 'not-an-email',
        name: 'Ada',
      })
      .expect(422);

    expect(response.body.statusCode).toBe(422);
    expect(response.body.code).toBe('VALIDATION_ERROR');
    expect(response.body.errors.email).toEqual(expect.any(Array));
    expect(response.body).not.toHaveProperty('errors', undefined);
  });
});
