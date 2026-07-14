import { DataSource, DataSourceOptions } from 'typeorm';
import { validateEnvironment } from './environment.validation';

export function buildDataSourceOptions(
  env: NodeJS.Dict<string> = process.env,
): DataSourceOptions {
  const config = validateEnvironment(env);

  return {
    type: 'postgres',
    host: config.postgres.host,
    port: config.postgres.port,
    username: config.postgres.user,
    password: config.postgres.password,
    database: config.postgres.db,
    synchronize: false,
    entities: [__dirname + '/**/*.entity{.ts,.js}'],
    migrations: [__dirname + '/migrations/*{.ts,.js}'],
  };
}

export default new DataSource(buildDataSourceOptions());
