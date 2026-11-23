import { Controller, Get, VERSION_NEUTRAL, Version } from '@nestjs/common';
import { Public } from './auth/decorators/public.decorator.js';
import { AppService } from './app.service.js';

@Controller()
export class AppController {
  constructor(private readonly appService: AppService) {}

  // Version-neutral: the root and health endpoints exist outside the API
  // version scheme. Monitors and orchestrators (Render, k8s, load balancers)
  // probe /health regardless of which API version the service currently ships.
  @Public()
  @Version(VERSION_NEUTRAL)
  @Get()
  getHello(): string {
    return this.appService.getHello();
  }

  @Public()
  @Version(VERSION_NEUTRAL)
  @Get('health')
  checkDatabase() {
    return this.appService.checkDatabase();
  }
}
