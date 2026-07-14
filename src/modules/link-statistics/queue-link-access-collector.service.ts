import { InjectQueue } from '@nestjs/bullmq';
import { Injectable } from '@nestjs/common';
import { Queue } from 'bullmq';
import { validateEnvironment } from '../../environment.validation';
import { LINK_STATS_QUEUE } from '../../redis.module';
import {
  CollectedAccess,
  LinkAccessCollector,
  RECORD_LINK_ACCESS_JOB,
  RecordLinkAccessJobData,
} from './link-access-collector.service';

@Injectable()
export class QueueLinkAccessCollector extends LinkAccessCollector {
  private readonly attempts: number;
  private readonly backoffMs: number;

  constructor(
    @InjectQueue(LINK_STATS_QUEUE)
    private readonly linkStatsQueue: Queue,
  ) {
    super();
    const env = validateEnvironment();
    this.attempts = env.linkStatsQueue.attempts;
    this.backoffMs = env.linkStatsQueue.backoffMs;
  }

  async collect(input: CollectedAccess): Promise<void> {
    const data: RecordLinkAccessJobData = {
      eventId: input.eventId,
      linkId: input.linkId,
      occurredAt: input.occurredAt,
      occurredOn: input.occurredOn,
      country: input.country,
      visitorPseudonym: input.visitorPseudonym,
    };

    await this.linkStatsQueue.add(RECORD_LINK_ACCESS_JOB, data, {
      jobId: `access-${input.eventId}`,
      attempts: this.attempts,
      backoff: {
        type: 'exponential',
        delay: this.backoffMs,
      },
    });
  }
}
