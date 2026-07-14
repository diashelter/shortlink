import { HttpException, HttpStatus } from '@nestjs/common';
import { LinkCodeGenerator } from './link-code-generator.service';
import { LinkResolutionCache } from './link-resolution-cache.service';
import { LinkStatus } from './link-status.enum';
import { LinksRepository } from './links.repository';
import { LinksService } from './links.service';
import { LinkRecord } from './links.types';

describe('LinksService', () => {
  const userId = '11111111-1111-4111-8111-111111111111';
  const otherUserId = '22222222-2222-4222-8222-222222222222';
  const now = new Date('2026-07-14T12:00:00.000Z');

  let repository: jest.Mocked<LinksRepository>;
  let codeGenerator: jest.Mocked<LinkCodeGenerator>;
  let resolutionCache: jest.Mocked<LinkResolutionCache>;
  let service: LinksService;

  function linkRecord(overrides: Partial<LinkRecord> = {}): LinkRecord {
    return {
      id: '33333333-3333-4333-8333-333333333333',
      userId,
      shortCode: 'ABC123',
      destinationUrl: 'https://example.com/path',
      status: LinkStatus.ACTIVE,
      createdAt: now,
      updatedAt: now,
      ...overrides,
    };
  }

  beforeEach(() => {
    repository = {
      createOrRestore: jest.fn(),
      listByUser: jest.fn(),
      changeStatus: jest.fn(),
      findActiveByShortCode: jest.fn(),
      findById: jest.fn(),
    } as unknown as jest.Mocked<LinksRepository>;

    codeGenerator = {
      generate: jest.fn(),
    } as unknown as jest.Mocked<LinkCodeGenerator>;

    resolutionCache = {
      get: jest.fn(),
      set: jest.fn(),
      invalidate: jest.fn(),
    } as unknown as jest.Mocked<LinkResolutionCache>;

    service = new LinksService(
      repository,
      codeGenerator,
      resolutionCache,
      'https://localhost:8443',
      3,
    );
  });

  it('creates a link and composes the short URL from the validated base', async () => {
    const record = linkRecord();
    codeGenerator.generate.mockReturnValue('ABC123');
    repository.createOrRestore.mockResolvedValue({
      outcome: 'created',
      link: record,
    });

    const result = await service.create(userId, 'https://example.com/path');

    expect(result.created).toBe(true);
    expect(result.link.shortUrl).toBe('https://localhost:8443/ABC123');
    expect(repository.createOrRestore).toHaveBeenCalledWith(
      userId,
      'https://example.com/path',
      'ABC123',
    );
  });

  it('retries the full create transaction only on short code collisions', async () => {
    codeGenerator.generate
      .mockReturnValueOnce('AAAAAA')
      .mockReturnValueOnce('BBBBBB');
    repository.createOrRestore
      .mockResolvedValueOnce({ outcome: 'short_code_collision' })
      .mockResolvedValueOnce({
        outcome: 'created',
        link: linkRecord({ shortCode: 'BBBBBB' }),
      });

    const result = await service.create(userId, 'https://example.com/retry');

    expect(result.link.shortCode).toBe('BBBBBB');
    expect(repository.createOrRestore).toHaveBeenCalledTimes(2);
  });

  it('fails with SHORT_CODE_GENERATION_UNAVAILABLE when attempts are exhausted', async () => {
    codeGenerator.generate.mockReturnValue('DUP001');
    repository.createOrRestore.mockResolvedValue({
      outcome: 'short_code_collision',
    });

    try {
      await service.create(userId, 'https://example.com/exhausted');
      fail('expected create to throw');
    } catch (error) {
      expect(error).toBeInstanceOf(HttpException);
      expect((error as HttpException).getStatus()).toBe(
        HttpStatus.SERVICE_UNAVAILABLE,
      );
      expect((error as HttpException).getResponse()).toEqual(
        expect.objectContaining({
          code: 'SHORT_CODE_GENERATION_UNAVAILABLE',
        }),
      );
    }
    expect(repository.createOrRestore).toHaveBeenCalledTimes(3);
  });

  it('maps limit reached and invalid destination URL to HTTP errors', async () => {
    codeGenerator.generate.mockReturnValue('LIM001');
    repository.createOrRestore.mockResolvedValue({ outcome: 'limit_reached' });

    try {
      await service.create(userId, 'https://example.com/limit');
      fail('expected create to throw');
    } catch (error) {
      expect(error).toBeInstanceOf(HttpException);
      expect((error as HttpException).getStatus()).toBe(HttpStatus.CONFLICT);
      expect((error as HttpException).getResponse()).toEqual(
        expect.objectContaining({ code: 'LINK_LIMIT_REACHED' }),
      );
    }

    try {
      await service.create(userId, 'not-a-url');
      fail('expected create to throw');
    } catch (error) {
      expect(error).toBeInstanceOf(HttpException);
      expect((error as HttpException).getStatus()).toBe(
        HttpStatus.UNPROCESSABLE_ENTITY,
      );
      expect((error as HttpException).getResponse()).toEqual(
        expect.objectContaining({ code: 'VALIDATION_ERROR' }),
      );
    }
    expect(repository.createOrRestore).toHaveBeenCalledTimes(1);
  });

  it('resolves from cache hit without querying PostgreSQL', async () => {
    resolutionCache.get.mockResolvedValue('https://example.com/cached');

    await expect(service.resolve('ABC123')).resolves.toBe(
      'https://example.com/cached',
    );
    expect(repository.findActiveByShortCode).not.toHaveBeenCalled();
  });

  it('falls back to PostgreSQL on cache miss or cache failure and warms the cache', async () => {
    const record = linkRecord();
    resolutionCache.get.mockResolvedValue(null);
    repository.findActiveByShortCode.mockResolvedValue(record);
    resolutionCache.set.mockResolvedValue(undefined);

    await expect(service.resolve('ABC123')).resolves.toBe(record.destinationUrl);
    expect(resolutionCache.set).toHaveBeenCalledWith(
      'ABC123',
      record.destinationUrl,
    );

    resolutionCache.get.mockRejectedValue(new Error('redis down'));
    repository.findActiveByShortCode.mockResolvedValue(record);

    await expect(service.resolve('ABC123')).resolves.toBe(record.destinationUrl);
  });

  it('invalidates cache before status mutation and skips the repository on invalidate failure', async () => {
    const record = linkRecord();
    repository.findById.mockResolvedValue(record);
    resolutionCache.invalidate.mockRejectedValue(new Error('redis down'));

    try {
      await service.deactivate(userId, record.id);
      fail('expected deactivate to throw');
    } catch (error) {
      expect(error).toBeInstanceOf(HttpException);
      expect((error as HttpException).getStatus()).toBe(
        HttpStatus.SERVICE_UNAVAILABLE,
      );
      expect((error as HttpException).getResponse()).toEqual(
        expect.objectContaining({ code: 'LINK_CACHE_UNAVAILABLE' }),
      );
    }

    expect(resolutionCache.invalidate).toHaveBeenCalledWith('ABC123');
    expect(repository.changeStatus).not.toHaveBeenCalled();
  });

  it('maps ownership and missing links before mutation', async () => {
    repository.findById.mockResolvedValueOnce(null);
    try {
      await service.deactivate(
        userId,
        '00000000-0000-4000-8000-000000000000',
      );
      fail('expected deactivate to throw');
    } catch (error) {
      expect((error as HttpException).getResponse()).toEqual(
        expect.objectContaining({ code: 'LINK_NOT_FOUND' }),
      );
    }

    repository.findById.mockResolvedValueOnce(
      linkRecord({ userId: otherUserId }),
    );
    try {
      await service.deactivate(userId, linkRecord().id);
      fail('expected deactivate to throw');
    } catch (error) {
      expect((error as HttpException).getResponse()).toEqual(
        expect.objectContaining({ code: 'FORBIDDEN' }),
      );
    }

    expect(resolutionCache.invalidate).not.toHaveBeenCalled();
    expect(repository.changeStatus).not.toHaveBeenCalled();
  });

  it('reactivates after successful invalidation and maps limit reached', async () => {
    const record = linkRecord({ status: LinkStatus.DEACTIVATED });
    repository.findById.mockResolvedValue(record);
    resolutionCache.invalidate.mockResolvedValue(undefined);
    repository.changeStatus.mockResolvedValue({ outcome: 'limit_reached' });

    try {
      await service.reactivate(userId, record.id);
      fail('expected reactivate to throw');
    } catch (error) {
      expect(error).toBeInstanceOf(HttpException);
      expect((error as HttpException).getStatus()).toBe(HttpStatus.CONFLICT);
      expect((error as HttpException).getResponse()).toEqual(
        expect.objectContaining({ code: 'LINK_LIMIT_REACHED' }),
      );
    }

    expect(repository.changeStatus).toHaveBeenCalledWith(
      userId,
      record.id,
      LinkStatus.ACTIVE,
    );
  });
});
