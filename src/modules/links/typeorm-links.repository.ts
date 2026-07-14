import { Injectable } from '@nestjs/common';
import {
  DataSource,
  EntityManager,
  QueryFailedError,
} from 'typeorm';
import { AccountEntity } from '../auth/account.entity';
import { LinkEntity } from './link.entity';
import { LinkStatus } from './link-status.enum';
import { LinksRepository } from './links.repository';
import {
  ChangeLinkStatusResult,
  CreateOrRestoreLinkResult,
  LinkRecord,
  ListLinksQuery,
  MAX_ACTIVE_LINKS_PER_USER,
  PaginatedLinks,
} from './links.types';

const UNIQUE_VIOLATION = '23505';

@Injectable()
export class TypeormLinksRepository extends LinksRepository {
  constructor(private readonly dataSource: DataSource) {
    super();
  }

  async createOrRestore(
    userId: string,
    destinationUrl: string,
    shortCode: string,
  ): Promise<CreateOrRestoreLinkResult> {
    try {
      return await this.dataSource.transaction(async (manager) => {
        await this.lockAccount(manager, userId);

        const existing = await manager.findOne(LinkEntity, {
          where: { userId, destinationUrl },
        });

        if (existing?.status === LinkStatus.ACTIVE) {
          return { outcome: 'existing', link: this.toRecord(existing) };
        }

        const activeCount = await this.countActiveLinks(manager, userId);

        if (existing?.status === LinkStatus.DEACTIVATED) {
          if (activeCount >= MAX_ACTIVE_LINKS_PER_USER) {
            return { outcome: 'limit_reached' };
          }

          existing.status = LinkStatus.ACTIVE;
          const saved = await manager.save(existing);
          return { outcome: 'reactivated', link: this.toRecord(saved) };
        }

        if (activeCount >= MAX_ACTIVE_LINKS_PER_USER) {
          return { outcome: 'limit_reached' };
        }

        const created = await manager.save(
          manager.create(LinkEntity, {
            userId,
            destinationUrl,
            shortCode,
            status: LinkStatus.ACTIVE,
          }),
        );

        return { outcome: 'created', link: this.toRecord(created) };
      });
    } catch (error) {
      if (this.isShortCodeCollision(error)) {
        return { outcome: 'short_code_collision' };
      }

      throw error;
    }
  }

  async listByUser(
    userId: string,
    query: ListLinksQuery,
  ): Promise<PaginatedLinks> {
    const links = this.dataSource.getRepository(LinkEntity);
    const where: { userId: string; status?: LinkStatus } = { userId };

    if (query.status === 'active') {
      where.status = LinkStatus.ACTIVE;
    } else if (query.status === 'deactivated') {
      where.status = LinkStatus.DEACTIVATED;
    }

    const [items, total] = await links.findAndCount({
      where,
      order: { createdAt: 'DESC', id: 'DESC' },
      skip: (query.page - 1) * query.limit,
      take: query.limit,
    });

    return {
      items: items.map((item) => this.toRecord(item)),
      total,
      page: query.page,
      limit: query.limit,
      totalPages: total === 0 ? 0 : Math.ceil(total / query.limit),
    };
  }

  async changeStatus(
    userId: string,
    linkId: string,
    status: LinkStatus,
  ): Promise<ChangeLinkStatusResult> {
    return this.dataSource.transaction(async (manager) => {
      const link = await manager.findOne(LinkEntity, {
        where: { id: linkId },
      });

      if (!link) {
        return { outcome: 'not_found' };
      }

      if (link.userId !== userId) {
        return { outcome: 'forbidden' };
      }

      await this.lockAccount(manager, userId);

      const locked = await manager.findOne(LinkEntity, {
        where: { id: linkId },
      });

      if (!locked) {
        return { outcome: 'not_found' };
      }

      if (locked.status === status) {
        return { outcome: 'unchanged', link: this.toRecord(locked) };
      }

      if (status === LinkStatus.ACTIVE) {
        const activeCount = await this.countActiveLinks(manager, userId);
        if (activeCount >= MAX_ACTIVE_LINKS_PER_USER) {
          return { outcome: 'limit_reached' };
        }
      }

      locked.status = status;
      const saved = await manager.save(locked);
      return { outcome: 'changed', link: this.toRecord(saved) };
    });
  }

  async findActiveByShortCode(shortCode: string): Promise<LinkRecord | null> {
    const link = await this.dataSource.getRepository(LinkEntity).findOne({
      where: { shortCode, status: LinkStatus.ACTIVE },
    });

    return link ? this.toRecord(link) : null;
  }

  private async lockAccount(
    manager: EntityManager,
    userId: string,
  ): Promise<AccountEntity> {
    const account = await manager.findOne(AccountEntity, {
      where: { id: userId },
      lock: { mode: 'pessimistic_write' },
    });

    if (!account) {
      throw new Error('Account not found.');
    }

    return account;
  }

  private async countActiveLinks(
    manager: EntityManager,
    userId: string,
  ): Promise<number> {
    return manager.count(LinkEntity, {
      where: { userId, status: LinkStatus.ACTIVE },
    });
  }

  private isShortCodeCollision(error: unknown): boolean {
    if (!(error instanceof QueryFailedError)) {
      return false;
    }

    const driverError = error.driverError as
      | { code?: string; constraint?: string; detail?: string }
      | undefined;

    if (driverError?.code !== UNIQUE_VIOLATION) {
      return false;
    }

    const haystack = `${driverError.constraint ?? ''} ${driverError.detail ?? ''}`.toLowerCase();
    return haystack.includes('shortcode');
  }

  private toRecord(entity: LinkEntity): LinkRecord {
    return {
      id: entity.id,
      userId: entity.userId,
      shortCode: entity.shortCode,
      destinationUrl: entity.destinationUrl,
      status: entity.status,
      createdAt: entity.createdAt,
      updatedAt: entity.updatedAt,
    };
  }
}
