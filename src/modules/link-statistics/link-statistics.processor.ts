import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Injectable, Logger } from '@nestjs/common';
import { Job } from 'bullmq';
import { LINK_STATS_QUEUE } from '../../redis.module';
import {
  RECORD_LINK_ACCESS_JOB,
  RecordLinkAccessJobData,
} from './link-access-collector.service';
import { LinkStatisticsRepository } from './link-statistics.repository';

@Injectable()
@Processor(LINK_STATS_QUEUE)
export class LinkStatisticsProcessor extends WorkerHost {
  private readonly logger = new Logger(LinkStatisticsProcessor.name);

  constructor(
    private readonly linkStatistics: LinkStatisticsRepository,
  ) {
    super();
  }

  async process(job: Job<RecordLinkAccessJobData>): Promise<void> {
    if (job.name === RECORD_LINK_ACCESS_JOB) {
      await this.recordAccess(job.data);
      return;
    }

    this.logger.warn(`Ignoring unknown link statistics job: ${job.name}`);
  }

  private async recordAccess(data: RecordLinkAccessJobData): Promise<void> {
    await this.linkStatistics.recordAccess({
      eventId: data.eventId,
      linkId: data.linkId,
      occurredAt: new Date(data.occurredAt),
      occurredOn: data.occurredOn,
      country: data.country,
      visitorPseudonym: data.visitorPseudonym,
    });
  }
}
