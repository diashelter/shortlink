import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { validateEnvironment } from '../../environment.validation';
import { RedisModule } from '../../redis.module';
import { AuthModule } from '../auth/auth.module';
import { LinkEntity } from './link.entity';
import { LinkCodeGenerator } from './link-code-generator.service';
import { LinkResolutionCache } from './link-resolution-cache.service';
import { LinksController } from './links.controller';
import { LinksRepository } from './links.repository';
import { LinksService } from './links.service';
import { NodeLinkCodeGenerator } from './node-link-code-generator.service';
import { RedisLinkResolutionCache } from './redis-link-resolution-cache.service';
import { TypeormLinksRepository } from './typeorm-links.repository';

@Module({
  imports: [
    AuthModule,
    RedisModule,
    TypeOrmModule.forFeature([LinkEntity]),
  ],
  controllers: [LinksController],
  providers: [
    {
      provide: LinksRepository,
      useClass: TypeormLinksRepository,
    },
    {
      provide: LinkCodeGenerator,
      useClass: NodeLinkCodeGenerator,
    },
    {
      provide: LinkResolutionCache,
      useClass: RedisLinkResolutionCache,
    },
    {
      provide: LinksService,
      useFactory: (
        repository: LinksRepository,
        codeGenerator: LinkCodeGenerator,
        resolutionCache: LinkResolutionCache,
      ) => {
        const env = validateEnvironment();
        return new LinksService(
          repository,
          codeGenerator,
          resolutionCache,
          env.publicShortUrlBase,
          env.linkCodeGenerationMaxAttempts,
        );
      },
      inject: [LinksRepository, LinkCodeGenerator, LinkResolutionCache],
    },
  ],
  exports: [LinksService],
})
export class LinksModule {}
