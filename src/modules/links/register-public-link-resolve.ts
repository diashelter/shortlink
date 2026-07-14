import { INestApplication, Logger, NotFoundException } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { NextFunction, Request, Response } from 'express';
import { AutomatedTrafficDetector } from '../link-statistics/automated-traffic-detector.service';
import { CountryResolver } from '../link-statistics/country-resolver.service';
import { LinkAccessCollector } from '../link-statistics/link-access-collector.service';
import { VisitorPseudonymizer } from '../link-statistics/visitor-pseudonymizer.service';
import { LinksService } from './links.service';
import { ResolvedLink } from './links.types';

const SHORT_CODE_PATTERN = /^[A-Z0-9]{6}$/;
const ROOT_SEGMENT_PATTERN = /^\/[A-Za-z0-9]+$/;
const logger = new Logger('PublicLinkResolve');

type AccessCollectionDeps = {
  collector: LinkAccessCollector;
  automatedTrafficDetector: AutomatedTrafficDetector;
  visitorPseudonymizer: VisitorPseudonymizer;
  countryResolver: CountryResolver;
};

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

  const accessCollection = resolveAccessCollectionDeps(app);

  const expressApp = app.getHttpAdapter().getInstance() as {
    use: (
      handler: (req: Request, res: Response, next: NextFunction) => void,
    ) => void;
  };

  expressApp.use((request: Request, response: Response, next: NextFunction) => {
    void handlePublicLinkResolve(
      request,
      response,
      next,
      linksService,
      accessCollection,
    );
  });
}

function resolveAccessCollectionDeps(
  app: INestApplication,
): AccessCollectionDeps | null {
  const collector = app.get(LinkAccessCollector, { strict: false });
  const automatedTrafficDetector = app.get(AutomatedTrafficDetector, {
    strict: false,
  });
  const visitorPseudonymizer = app.get(VisitorPseudonymizer, { strict: false });
  const countryResolver = app.get(CountryResolver, { strict: false });

  if (
    !collector ||
    !automatedTrafficDetector ||
    !visitorPseudonymizer ||
    !countryResolver
  ) {
    return null;
  }

  return {
    collector,
    automatedTrafficDetector,
    visitorPseudonymizer,
    countryResolver,
  };
}

async function handlePublicLinkResolve(
  request: Request,
  response: Response,
  next: NextFunction,
  linksService: LinksService,
  accessCollection: AccessCollectionDeps | null,
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
    const resolved = await linksService.resolve(code);
    response.redirect(302, resolved.destinationUrl);
    scheduleAccessCollection(request, resolved, accessCollection);
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

function scheduleAccessCollection(
  request: Request,
  resolved: ResolvedLink,
  accessCollection: AccessCollectionDeps | null,
): void {
  if (!accessCollection) {
    return;
  }

  void collectEligibleAccess(request, resolved, accessCollection).catch(
    (error: unknown) => {
      const reason =
        error instanceof Error ? error.name || 'Error' : 'unknown';
      logger.warn(`Link access collection failed (${reason})`);
    },
  );
}

async function collectEligibleAccess(
  request: Request,
  resolved: ResolvedLink,
  accessCollection: AccessCollectionDeps,
): Promise<void> {
  const userAgent = request.get('user-agent') ?? '';
  if (accessCollection.automatedTrafficDetector.isAutomated(userAgent)) {
    return;
  }

  const occurredAt = new Date();
  const occurredOn = occurredAt.toISOString().slice(0, 10);
  const ip = request.ip ?? '';

  await accessCollection.collector.collect({
    eventId: randomUUID(),
    linkId: resolved.linkId,
    occurredAt: occurredAt.toISOString(),
    occurredOn,
    country: accessCollection.countryResolver.resolve(ip),
    visitorPseudonym: accessCollection.visitorPseudonymizer.create(
      resolved.linkId,
      occurredOn,
      ip,
      userAgent,
    ),
  });
}
