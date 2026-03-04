import { Controller, Get, HttpCode } from '@nestjs/common';
import { RabbitmqService } from './rabbitmq.service';

@Controller('health')
export class HealthController {
  constructor(private readonly rabbitmqService: RabbitmqService) {}

  @Get()
  @HttpCode(200)
  check() {
    const { rabbitmq, sql } = this.rabbitmqService.getStatus();
    const healthy = rabbitmq && sql;
    return {
      status: healthy ? 'ok' : 'degraded',
      rabbitmq,
      sql,
    };
  }
}
