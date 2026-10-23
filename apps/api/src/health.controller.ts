import { Controller, Get, Inject, ServiceUnavailableException } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Infrastructure } from './infrastructure';

@ApiTags('health')
@Controller('health')
export class HealthController {
  constructor(@Inject(Infrastructure) private readonly infra: Infrastructure) {}
  @Get('live') live() { return { status: 'ok', application: 'Ventilyator' }; }
  @Get('ready') async ready() {
    const status = await this.infra.status();
    if (!Object.values(status).every(Boolean)) throw new ServiceUnavailableException('Ventilyator is not ready');
    return { status: 'ok' };
  }
}
