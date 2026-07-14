import { readFileSync } from 'fs';
import { join } from 'path';
import { DataSource } from 'typeorm';
import { buildDataSourceOptions } from '../../src/data-source';
import { AccountEntity } from '../../src/modules/auth/account.entity';
import { AccountRole } from '../../src/modules/auth/account-role.enum';
import { AccountStatus } from '../../src/modules/auth/account-status.enum';
import { LinkStatus } from '../../src/modules/links/link-status.enum';
import { LinksRepository } from '../../src/modules/links/links.repository';
import { MAX_ACTIVE_LINKS_PER_USER } from '../../src/modules/links/links.types';
import { TypeormLinksRepository } from '../../src/modules/links/typeorm-links.repository';

const BCRYPT_HASH =
  '$2b$10$N9qo8uLOickgx2ZMRZoMyeIjZAgcfl7p92ldGxad68LJZdL17lhWy';

describe('TypeormLinksRepository (integration)', () => {
  let dataSource: DataSource;
  let repository: LinksRepository;

  beforeAll(async () => {
    dataSource = new DataSource(buildDataSourceOptions());
    await dataSource.initialize();
    await dataSource.runMigrations({ transaction: 'each' });
  });

  afterAll(async () => {
    if (dataSource?.isInitialized) {
      await dataSource.destroy();
    }
  });

  beforeEach(async () => {
    await dataSource.query(
      'TRUNCATE TABLE "links", "session_refresh_tokens", "auth_sessions", "password_reset_tokens", "auth_audit_events", "users" CASCADE',
    );
    repository = new TypeormLinksRepository(dataSource);
  });

  async function createUser(email: string): Promise<AccountEntity> {
    const accounts = dataSource.getRepository(AccountEntity);
    return accounts.save(
      accounts.create({
        email,
        status: AccountStatus.ACTIVE,
        role: AccountRole.USER,
        passwordHash: BCRYPT_HASH,
      }),
    );
  }

  function code(index: number): string {
    return `C${index.toString().padStart(5, '0')}`;
  }

  it('keeps the repository abstraction free of TypeORM and entity imports', () => {
    const interfaceSource = readFileSync(
      join(__dirname, '../../src/modules/links/links.repository.ts'),
      'utf8',
    );

    expect(interfaceSource).not.toMatch(/from ['"]typeorm['"]/);
    expect(interfaceSource).not.toMatch(/\.entity['"]/);
    expect(interfaceSource).not.toMatch(/Http|express|nestjs/i);
    expect(repository).toBeInstanceOf(TypeormLinksRepository);
    expect(repository).toBeInstanceOf(LinksRepository);
  });

  it('creates, returns existing, and reactivates by destination URL', async () => {
    const user = await createUser('owner@example.com');
    const destinationUrl = 'https://example.com/path';

    const created = await repository.createOrRestore(
      user.id,
      destinationUrl,
      'AAA111',
    );
    expect(created.outcome).toBe('created');
    if (created.outcome !== 'created') {
      return;
    }

    const existing = await repository.createOrRestore(
      user.id,
      destinationUrl,
      'BBB222',
    );
    expect(existing).toEqual({
      outcome: 'existing',
      link: expect.objectContaining({
        id: created.link.id,
        shortCode: 'AAA111',
      }),
    });

    await repository.changeStatus(
      user.id,
      created.link.id,
      LinkStatus.DEACTIVATED,
    );

    const reactivated = await repository.createOrRestore(
      user.id,
      destinationUrl,
      'CCC333',
    );
    expect(reactivated.outcome).toBe('reactivated');
    if (reactivated.outcome !== 'reactivated') {
      return;
    }
    expect(reactivated.link.shortCode).toBe('AAA111');
    expect(reactivated.link.status).toBe(LinkStatus.ACTIVE);
  });

  it('enforces the active link limit and ownership for status changes', async () => {
    const owner = await createUser('limit@example.com');
    const other = await createUser('other@example.com');

    for (let index = 0; index < MAX_ACTIVE_LINKS_PER_USER; index += 1) {
      const result = await repository.createOrRestore(
        owner.id,
        `https://example.com/${index}`,
        code(index),
      );
      expect(result.outcome).toBe('created');
    }

    const overLimit = await repository.createOrRestore(
      owner.id,
      'https://example.com/over',
      'OVER01',
    );
    expect(overLimit).toEqual({ outcome: 'limit_reached' });

    const first = await repository.listByUser(owner.id, {
      page: 1,
      limit: 1,
      status: 'active',
    });
    const linkId = first.items[0].id;

    await repository.changeStatus(owner.id, linkId, LinkStatus.DEACTIVATED);

    const forbidden = await repository.changeStatus(
      other.id,
      linkId,
      LinkStatus.ACTIVE,
    );
    expect(forbidden).toEqual({ outcome: 'forbidden' });

    const missing = await repository.changeStatus(
      owner.id,
      '00000000-0000-4000-8000-000000000000',
      LinkStatus.DEACTIVATED,
    );
    expect(missing).toEqual({ outcome: 'not_found' });

    const reactivated = await repository.changeStatus(
      owner.id,
      linkId,
      LinkStatus.ACTIVE,
    );
    expect(reactivated.outcome).toBe('changed');

    const stillLimited = await repository.createOrRestore(
      owner.id,
      'https://example.com/still-over',
      'OVER02',
    );
    expect(stillLimited).toEqual({ outcome: 'limit_reached' });
  });

  it('lists only owned links with pagination and deterministic order', async () => {
    const owner = await createUser('list@example.com');
    const stranger = await createUser('stranger@example.com');

    await repository.createOrRestore(
      stranger.id,
      'https://example.com/stranger',
      'STR001',
    );

    const first = await repository.createOrRestore(
      owner.id,
      'https://example.com/a',
      'LST001',
    );
    const second = await repository.createOrRestore(
      owner.id,
      'https://example.com/b',
      'LST002',
    );
    const third = await repository.createOrRestore(
      owner.id,
      'https://example.com/c',
      'LST003',
    );

    expect(first.outcome).toBe('created');
    expect(second.outcome).toBe('created');
    expect(third.outcome).toBe('created');
    if (
      first.outcome !== 'created' ||
      second.outcome !== 'created' ||
      third.outcome !== 'created'
    ) {
      return;
    }

    await repository.changeStatus(
      owner.id,
      second.link.id,
      LinkStatus.DEACTIVATED,
    );

    const page = await repository.listByUser(owner.id, {
      page: 1,
      limit: 2,
      status: 'all',
    });

    expect(page.total).toBe(3);
    expect(page.totalPages).toBe(2);
    expect(page.items).toHaveLength(2);
    expect(page.items.every((item) => item.userId === owner.id)).toBe(true);

    const ordered = [first.link, second.link, third.link].sort((left, right) => {
      const byCreated =
        right.createdAt.getTime() - left.createdAt.getTime();
      if (byCreated !== 0) {
        return byCreated;
      }
      return right.id.localeCompare(left.id);
    });

    expect(page.items.map((item) => item.id)).toEqual([
      ordered[0].id,
      ordered[1].id,
    ]);

    const activeOnly = await repository.listByUser(owner.id, {
      page: 1,
      limit: 20,
      status: 'active',
    });
    expect(activeOnly.items.map((item) => item.id).sort()).toEqual(
      [first.link.id, third.link.id].sort(),
    );
    expect(
      activeOnly.items.every((item) => item.status === LinkStatus.ACTIVE),
    ).toBe(true);
  });

  it('returns short_code_collision when the global code is already taken', async () => {
    const firstOwner = await createUser('code-a@example.com');
    const secondOwner = await createUser('code-b@example.com');

    const created = await repository.createOrRestore(
      firstOwner.id,
      'https://example.com/a',
      'SAME01',
    );
    expect(created.outcome).toBe('created');

    const collision = await repository.createOrRestore(
      secondOwner.id,
      'https://example.com/b',
      'SAME01',
    );
    expect(collision).toEqual({ outcome: 'short_code_collision' });
  });

  it('finds only active links by short code', async () => {
    const user = await createUser('resolve@example.com');
    const created = await repository.createOrRestore(
      user.id,
      'https://example.com/resolve',
      'RES001',
    );
    expect(created.outcome).toBe('created');
    if (created.outcome !== 'created') {
      return;
    }

    expect(await repository.findActiveByShortCode('RES001')).toEqual(
      expect.objectContaining({
        id: created.link.id,
        destinationUrl: 'https://example.com/resolve',
      }),
    );

    await repository.changeStatus(
      user.id,
      created.link.id,
      LinkStatus.DEACTIVATED,
    );

    expect(await repository.findActiveByShortCode('RES001')).toBeNull();
  });

  it('keeps at most ten active links under concurrent createOrRestore', async () => {
    const user = await createUser('race@example.com');

    for (let index = 0; index < MAX_ACTIVE_LINKS_PER_USER - 1; index += 1) {
      const result = await repository.createOrRestore(
        user.id,
        `https://example.com/seed-${index}`,
        code(index),
      );
      expect(result.outcome).toBe('created');
    }

    const results = await Promise.all(
      Array.from({ length: 8 }, (_, index) =>
        repository.createOrRestore(
          user.id,
          `https://example.com/race-${index}`,
          code(100 + index),
        ),
      ),
    );

    const createdCount = results.filter(
      (result) => result.outcome === 'created',
    ).length;
    const limitedCount = results.filter(
      (result) => result.outcome === 'limit_reached',
    ).length;

    expect(createdCount).toBe(1);
    expect(limitedCount).toBe(7);

    const active = await repository.listByUser(user.id, {
      page: 1,
      limit: 100,
      status: 'active',
    });
    expect(active.total).toBe(MAX_ACTIVE_LINKS_PER_USER);
  });
});
