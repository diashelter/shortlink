import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  Query,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import { Response } from 'express';
import {
  AuthenticatedRequest,
  AuthSessionGuard,
} from '../auth/auth-session.guard';
import {
  CreateLinkDto,
  LinkIdParamDto,
  ListLinksQueryDto,
} from './links.dto';
import { LinksService } from './links.service';

@Controller('links')
@UseGuards(AuthSessionGuard)
export class LinksController {
  constructor(private readonly linksService: LinksService) {}

  @Post()
  async create(
    @Req() request: AuthenticatedRequest,
    @Body() body: CreateLinkDto,
    @Res({ passthrough: true }) response: Response,
  ) {
    const result = await this.linksService.create(
      request.user!.userId,
      body.destinationUrl,
    );

    response.status(result.created ? 201 : 200);
    return result.link;
  }

  @Get()
  async list(
    @Req() request: AuthenticatedRequest,
    @Query() query: ListLinksQueryDto,
  ) {
    return this.linksService.list(request.user!.userId, {
      page: query.page ?? 1,
      limit: query.limit ?? 20,
      status: query.status ?? 'active',
    });
  }

  @Patch(':linkId/deactivate')
  async deactivate(
    @Req() request: AuthenticatedRequest,
    @Param() params: LinkIdParamDto,
  ) {
    return this.linksService.deactivate(
      request.user!.userId,
      params.linkId,
    );
  }

  @Patch(':linkId/reactivate')
  async reactivate(
    @Req() request: AuthenticatedRequest,
    @Param() params: LinkIdParamDto,
  ) {
    return this.linksService.reactivate(
      request.user!.userId,
      params.linkId,
    );
  }
}
