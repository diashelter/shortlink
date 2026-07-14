export const RECORD_LINK_ACCESS_JOB = 'record-link-access';

export type CollectedAccess = {
  eventId: string;
  linkId: string;
  occurredAt: string;
  occurredOn: string;
  country: string;
  visitorPseudonym: string;
};

export type RecordLinkAccessJobData = CollectedAccess;

export abstract class LinkAccessCollector {
  abstract collect(input: CollectedAccess): Promise<void>;
}
