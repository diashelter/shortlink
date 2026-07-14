import { execFileSync } from 'child_process';
import { DataSource, QueryFailedError } from 'typeorm';
import { buildDataSourceOptions } from '../../src/data-source';
import { AccountEntity } from '../../src/modules/auth/account.entity';
import { AccountRole } from '../../src/modules/auth/account-role.enum';
import { AccountStatus } from '../../src/modules/auth/account-status.enum';
import { LinkEntity } from '../../src/modules/links/link.entity';
import { LinkStatus } from '../../src/modules/links/link-status.enum';

const BCRYPT_HASH =
  '$2b$10$N9qo8uLOickgx2ZMRZoMyeIjZAgcfl7p92ldGxad68LJZdL17lhWy';

describe('Link entities and migration (integration)', () => {
  let dataSource: DataSource;

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

  it('persists a link with public id, owner, code, destination, status and timestamps', async () => {
    const user = await createUser('owner@example.com');
    const links = dataSource.getRepository(LinkEntity);

    const saved = await links.save(
      links.create({
        userId: user.id,
        shortCode: 'ABC123',
        destinationUrl: 'https://example.com/path',
        status: LinkStatus.ACTIVE,
      }),
    );

    const loaded = await links.findOneByOrFail({ id: saved.id });

    expect(loaded.id).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
    );
    expect(loaded.userId).toBe(user.id);
    expect(loaded.shortCode).toBe('ABC123');
    expect(loaded.destinationUrl).toBe('https://example.com/path');
    expect(loaded.status).toBe(LinkStatus.ACTIVE);
    expect(loaded.createdAt).toBeInstanceOf(Date);
    expect(loaded.updatedAt).toBeInstanceOf(Date);
  });

  it('enforces globally unique shortCode', async () => {
    const firstOwner = await createUser('first@example.com');
    const secondOwner = await createUser('second@example.com');
    const links = dataSource.getRepository(LinkEntity);

    await links.save(
      links.create({
        userId: firstOwner.id,
        shortCode: 'DUP001',
        destinationUrl: 'https://example.com/a',
        status: LinkStatus.ACTIVE,
      }),
    );

    await expect(
      links.save(
        links.create({
          userId: secondOwner.id,
          shortCode: 'DUP001',
          destinationUrl: 'https://example.com/b',
          status: LinkStatus.ACTIVE,
        }),
      ),
    ).rejects.toBeInstanceOf(QueryFailedError);
  });

  it('enforces unique destinationUrl per user', async () => {
    const user = await createUser('same-user@example.com');
    const links = dataSource.getRepository(LinkEntity);

    await links.save(
      links.create({
        userId: user.id,
        shortCode: 'ONE001',
        destinationUrl: 'https://example.com/same',
        status: LinkStatus.ACTIVE,
      }),
    );

    await expect(
      links.save(
        links.create({
          userId: user.id,
          shortCode: 'TWO002',
          destinationUrl: 'https://example.com/same',
          status: LinkStatus.DEACTIVATED,
        }),
      ),
    ).rejects.toBeInstanceOf(QueryFailedError);
  });

  it('rejects links that reference a missing user', async () => {
    const links = dataSource.getRepository(LinkEntity);

    await expect(
      links.save(
        links.create({
          userId: '00000000-0000-4000-8000-000000000000',
          shortCode: 'FK0001',
          destinationUrl: 'https://example.com/fk',
          status: LinkStatus.ACTIVE,
        }),
      ),
    ).rejects.toBeInstanceOf(QueryFailedError);
  });

  it('creates listing and active-count indexes', async () => {
    const indexes = (await dataSource.query(
      `SELECT indexname FROM pg_indexes WHERE tablename = 'links' ORDER BY indexname`,
    )) as Array<{ indexname: string }>;

    const names = indexes.map((row) => row.indexname);
    expect(names).toEqual(
      expect.arrayContaining([
        'IDX_links_user_created_at_id',
        'IDX_links_user_active',
        'IDX_links_user_destination',
      ]),
    );
  });

  it('applies and reverts the links migration through the TypeORM CLI', () => {
    const revertOutput = execFileSync('npm', ['run', 'migration:revert'], {
      cwd: process.cwd(),
      env: process.env,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    expect(revertOutput).toMatch(/Migration.*has been reverted|reverted/i);

    const runOutput = execFileSync('npm', ['run', 'migration:run'], {
      cwd: process.cwd(),
      env: process.env,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    expect(runOutput).toMatch(/Migration.*has been executed|executed/i);
  });
});
