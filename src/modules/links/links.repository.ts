import { LinkStatus } from './link-status.enum';
import {
  ChangeLinkStatusResult,
  CreateOrRestoreLinkResult,
  LinkRecord,
  ListLinksQuery,
  PaginatedLinks,
} from './links.types';

export abstract class LinksRepository {
  abstract createOrRestore(
    userId: string,
    destinationUrl: string,
    shortCode: string,
  ): Promise<CreateOrRestoreLinkResult>;

  abstract listByUser(
    userId: string,
    query: ListLinksQuery,
  ): Promise<PaginatedLinks>;

  abstract changeStatus(
    userId: string,
    linkId: string,
    status: LinkStatus,
  ): Promise<ChangeLinkStatusResult>;

  abstract findActiveByShortCode(
    shortCode: string,
  ): Promise<LinkRecord | null>;
}
