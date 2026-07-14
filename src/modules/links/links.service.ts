import {
  ForbiddenException,
  HttpException,
  HttpStatus,
  Injectable,
  Logger,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { validateEnvironment } from '../../environment.validation';
import { DestinationUrl } from './destination-url.value-object';
import { LinkCodeGenerator } from './link-code-generator.service';
import { LinkResolutionCache } from './link-resolution-cache.service';
import { LinkStatus } from './link-status.enum';
import { LinksRepository } from './links.repository';
import { LinkRecord, ListLinksQuery, PaginatedLinks } from './links.types';

export type LinkResponse = {
  id: string;
  shortCode: string;
  destinationUrl: string;
  shortUrl: string;
  status: LinkStatus;
  createdAt: Date;
  updatedAt: Date;
};

export type CreateLinkResult = {
  link: LinkResponse;
  created: boolean;
};

@Injectable()
export class LinksService {
  private readonly logger = new Logger(LinksService.name);
  private readonly publicShortUrlBase: string;
  private readonly maxCodeAttempts: number;

  constructor(
    private readonly linksRepository: LinksRepository,
    private readonly codeGenerator: LinkCodeGenerator,
    private readonly resolutionCache: LinkResolutionCache,
    publicShortUrlBase?: string,
    maxCodeAttempts?: number,
  ) {
    if (publicShortUrlBase !== undefined && maxCodeAttempts !== undefined) {
      this.publicShortUrlBase = publicShortUrlBase;
      this.maxCodeAttempts = maxCodeAttempts;
    } else {
      const env = validateEnvironment();
      this.publicShortUrlBase = publicShortUrlBase ?? env.publicShortUrlBase;
      this.maxCodeAttempts =
        maxCodeAttempts ?? env.linkCodeGenerationMaxAttempts;
    }
  }

  async create(
    userId: string,
    destinationUrlRaw: string,
  ): Promise<CreateLinkResult> {
    const destinationUrl = this.parseDestinationUrl(destinationUrlRaw);

    for (let attempt = 1; attempt <= this.maxCodeAttempts; attempt += 1) {
      const shortCode = this.codeGenerator.generate();
      const result = await this.linksRepository.createOrRestore(
        userId,
        destinationUrl.value,
        shortCode,
      );

      switch (result.outcome) {
        case 'created':
          return { link: this.toResponse(result.link), created: true };
        case 'existing':
        case 'reactivated':
          return { link: this.toResponse(result.link), created: false };
        case 'limit_reached':
          throw this.linkLimitReachedException();
        case 'short_code_collision':
          break;
        default: {
          const exhaustive: never = result;
          throw exhaustive;
        }
      }
    }

    throw this.shortCodeGenerationUnavailableException();
  }

  async list(
    userId: string,
    query: ListLinksQuery,
  ): Promise<{
    items: LinkResponse[];
    meta: {
      page: number;
      limit: number;
      total: number;
      totalPages: number;
    };
  }> {
    const page: PaginatedLinks = await this.linksRepository.listByUser(
      userId,
      query,
    );

    return {
      items: page.items.map((item) => this.toResponse(item)),
      meta: {
        page: page.page,
        limit: page.limit,
        total: page.total,
        totalPages: page.totalPages,
      },
    };
  }

  async deactivate(userId: string, linkId: string): Promise<LinkResponse> {
    return this.changeStatus(userId, linkId, LinkStatus.DEACTIVATED);
  }

  async reactivate(userId: string, linkId: string): Promise<LinkResponse> {
    return this.changeStatus(userId, linkId, LinkStatus.ACTIVE);
  }

  async resolve(shortCode: string): Promise<string> {
    try {
      const cached = await this.resolutionCache.get(shortCode);
      if (cached !== null) {
        return cached;
      }
    } catch (error) {
      this.logger.warn(
        `Resolution cache read failed for short code; falling back to PostgreSQL (${this.errorMessage(error)})`,
      );
    }

    const link = await this.linksRepository.findActiveByShortCode(shortCode);
    if (!link) {
      throw this.linkNotFoundException();
    }

    try {
      await this.resolutionCache.set(shortCode, link.destinationUrl);
    } catch (error) {
      this.logger.warn(
        `Resolution cache write failed after authoritative read (${this.errorMessage(error)})`,
      );
    }

    return link.destinationUrl;
  }

  private async changeStatus(
    userId: string,
    linkId: string,
    status: LinkStatus,
  ): Promise<LinkResponse> {
    const existing = await this.linksRepository.findById(linkId);
    if (!existing) {
      throw this.linkNotFoundException();
    }
    if (existing.userId !== userId) {
      throw this.forbiddenException();
    }

    try {
      await this.resolutionCache.invalidate(existing.shortCode);
    } catch (error) {
      this.logger.warn(
        `Resolution cache invalidation failed; refusing status change (${this.errorMessage(error)})`,
      );
      throw this.linkCacheUnavailableException();
    }

    const result = await this.linksRepository.changeStatus(
      userId,
      linkId,
      status,
    );

    switch (result.outcome) {
      case 'changed':
      case 'unchanged':
        return this.toResponse(result.link);
      case 'not_found':
        throw this.linkNotFoundException();
      case 'forbidden':
        throw this.forbiddenException();
      case 'limit_reached':
        throw this.linkLimitReachedException();
      default: {
        const exhaustive: never = result;
        throw exhaustive;
      }
    }
  }

  private parseDestinationUrl(raw: string): DestinationUrl {
    try {
      return DestinationUrl.create(raw);
    } catch {
      throw new UnprocessableEntityException({
        code: 'VALIDATION_ERROR',
        message: 'Validation failed.',
        errors: {
          destinationUrl: [
            'destinationUrl must be a valid absolute HTTP(S) URL',
          ],
        },
      });
    }
  }

  private toResponse(link: LinkRecord): LinkResponse {
    return {
      id: link.id,
      shortCode: link.shortCode,
      destinationUrl: link.destinationUrl,
      shortUrl: `${this.publicShortUrlBase}/${link.shortCode}`,
      status: link.status,
      createdAt: link.createdAt,
      updatedAt: link.updatedAt,
    };
  }

  private linkLimitReachedException(): HttpException {
    return new HttpException(
      {
        code: 'LINK_LIMIT_REACHED',
        message: 'Active link limit reached.',
      },
      HttpStatus.CONFLICT,
    );
  }

  private linkNotFoundException(): NotFoundException {
    return new NotFoundException({
      code: 'LINK_NOT_FOUND',
      message: 'Link not found.',
    });
  }

  private forbiddenException(): ForbiddenException {
    return new ForbiddenException({
      code: 'FORBIDDEN',
      message: 'You do not have access to this link.',
    });
  }

  private linkCacheUnavailableException(): HttpException {
    return new HttpException(
      {
        code: 'LINK_CACHE_UNAVAILABLE',
        message: 'Link resolution cache is unavailable.',
      },
      HttpStatus.SERVICE_UNAVAILABLE,
    );
  }

  private shortCodeGenerationUnavailableException(): HttpException {
    return new HttpException(
      {
        code: 'SHORT_CODE_GENERATION_UNAVAILABLE',
        message: 'Unable to generate a unique short code.',
      },
      HttpStatus.SERVICE_UNAVAILABLE,
    );
  }

  private errorMessage(error: unknown): string {
    return error instanceof Error ? error.message : 'unknown error';
  }
}
