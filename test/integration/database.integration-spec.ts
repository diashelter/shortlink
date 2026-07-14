import { execFileSync } from 'child_process';
import { DataSource, EntitySchema } from 'typeorm';
import { buildDataSourceOptions } from '../../src/data-source';

describe('TypeORM PostgreSQL (integration)', () => {
  let dataSource: DataSource;

  afterEach(async () => {
    if (dataSource?.isInitialized) {
      await dataSource.destroy();
    }
  });

  it('keeps synchronize disabled and configures entity/migration globs', () => {
    const options = buildDataSourceOptions();

    expect(options.synchronize).toBe(false);
    expect(options.type).toBe('postgres');
    expect(options.entities).toEqual([
      expect.stringMatching(/\.entity\{\.ts,\.js\}$/),
    ]);
    expect(options.migrations).toEqual([
      expect.stringMatching(/migrations\/\*\{\.ts,\.js\}$/),
    ]);
  });

  it('connects to Compose PostgreSQL, runs migrations, and answers queries', async () => {
    dataSource = new DataSource(buildDataSourceOptions());
    await dataSource.initialize();

    expect(dataSource.options.synchronize).toBe(false);

    const rows = await dataSource.query('SELECT 1 AS ok');
    expect(rows).toEqual([{ ok: 1 }]);

    const executed = await dataSource.runMigrations({ transaction: 'each' });
    expect(Array.isArray(executed)).toBe(true);
  });

  it('applies migrations through the TypeORM CLI DataSource', () => {
    const output = execFileSync(
      'npm',
      ['run', 'migration:run'],
      {
        cwd: process.cwd(),
        env: process.env,
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'pipe'],
      },
    );

    expect(output).toMatch(/Migration|No migrations are pending|migrations/i);
  });

  it('can derive migration SQL from entities when they exist', async () => {
    const proofEntity = new EntitySchema({
      name: 'MigrationGenerateProof',
      tableName: '__migration_generate_proof',
      columns: {
        id: {
          type: Number,
          primary: true,
          generated: true,
        },
        label: {
          type: String,
          length: 32,
        },
      },
    });

    dataSource = new DataSource({
      ...buildDataSourceOptions(),
      entities: [proofEntity],
      migrations: [],
      synchronize: false,
    });
    await dataSource.initialize();

    const sqlInMemory = await dataSource.driver.createSchemaBuilder().log();
    const upSql = sqlInMemory.upQueries.map((query) => query.query).join('\n');

    expect(sqlInMemory.upQueries.length).toBeGreaterThan(0);
    expect(upSql).toContain('__migration_generate_proof');
  });
});
