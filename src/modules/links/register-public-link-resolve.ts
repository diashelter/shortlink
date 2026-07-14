import { INestApplication, NotFoundException } from '@nestjs/common';
import { NextFunction, Request, Response } from 'express';
import { LinksService } from './links.service';

const SHORT_CODE_PATTERN = /^[A-Z0-9]{6}$/;
const ROOT_SEGMENT_PATTERN = /^\/[A-Za-z0-9]+$/;

/**
 * SPEC_DEVIATION: public GET /{code} is registered as early Express middleware
 * instead of `setGlobalPrefix(..., { exclude: [{ path: ':code' }] })`.
 * Reason: Nest treats exclude path `:code` as any single segment, which also
 * strips the global prefix from `GET /links` and breaks `/api/v1/links`.
 * Nest middleware `forRoutes('*')` also skips paths with no Nest route.
 */
export function registerPublicLinkResolve(app: INestApplication): void {
  const linksService = app.get(LinksService, { strict: false });
  if (!linksService) {
    return;
  }

  const expressApp = app.getHttpAdapter().getInstance() as {
    use: (
      handler: (req: Request, res: Response, next: NextFunction) => void,
    ) => void;
  };

  expressApp.use((request: Request, response: Response, next: NextFunction) => {
    void handlePublicLinkResolve(request, response, next, linksService);
  });
}

async function handlePublicLinkResolve(
  request: Request,
  response: Response,
  next: NextFunction,
  linksService: LinksService,
): Promise<void> {
  const path = (request.originalUrl ?? request.url).split('?')[0] ?? '';

  if (request.method !== 'GET' || !ROOT_SEGMENT_PATTERN.test(path)) {
    next();
    return;
  }

  const code = path.slice(1);

  if (!SHORT_CODE_PATTERN.test(code)) {
    response.status(404).json({
      statusCode: 404,
      code: 'LINK_NOT_FOUND',
      message: 'Link not found.',
    });
    return;
  }

  try {
    const destinationUrl = await linksService.resolve(code);
    response.redirect(302, destinationUrl);
  } catch (error) {
    if (error instanceof NotFoundException) {
      response.status(404).json({
        statusCode: 404,
        code: 'LINK_NOT_FOUND',
        message: 'Link not found.',
      });
      return;
    }

    next(error);
  }
}
