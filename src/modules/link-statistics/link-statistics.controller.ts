import { Controller, Get, Param, Query, Req, UseGuards } from '@nestjs/common';
import {
  AuthenticatedRequest,
  AuthSessionGuard,
} from '../auth/auth-session.guard';
import { LinkIdParamDto } from '../links/links.dto';
import { LinkStatisticsPeriodQueryDto } from './link-statistics.dto';
import { LinkStatisticsService } from './link-statistics.service';

@Controller('links')
@UseGuards(AuthSessionGuard)
export class LinkStatisticsController {
  constructor(private readonly linkStatisticsService: LinkStatisticsService) {}

  @Get(':linkId/statistics')
  async getReport(
    @Req() request: AuthenticatedRequest,
    @Param() params: LinkIdParamDto,
    @Query() query: LinkStatisticsPeriodQueryDto,
  ) {
    return this.linkStatisticsService.getReport(
      request.user!.userId,
      params.linkId,
      query,
    );
  }
}
