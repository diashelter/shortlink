import { LinkStatus } from './link-status.enum';

export const MAX_ACTIVE_LINKS_PER_USER = 10;

export type LinkRecord = {
  id: string;
  userId: string;
  shortCode: string;
  destinationUrl: string;
  status: LinkStatus;
  createdAt: Date;
  updatedAt: Date;
};

export type CreateOrRestoreLinkResult =
  | { outcome: 'created'; link: LinkRecord }
  | { outcome: 'existing'; link: LinkRecord }
  | { outcome: 'reactivated'; link: LinkRecord }
  | { outcome: 'limit_reached' }
  | { outcome: 'short_code_collision' };

export type ChangeLinkStatusResult =
  | { outcome: 'changed'; link: LinkRecord }
  | { outcome: 'unchanged'; link: LinkRecord }
  | { outcome: 'not_found' }
  | { outcome: 'forbidden' }
  | { outcome: 'limit_reached' };

export type ListLinksStatusFilter = 'active' | 'deactivated' | 'all';

export type ListLinksQuery = {
  page: number;
  limit: number;
  status: ListLinksStatusFilter;
};

export type PaginatedLinks = {
  items: LinkRecord[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
};

export type ResolvedLink = {
  linkId: string;
  destinationUrl: string;
};
