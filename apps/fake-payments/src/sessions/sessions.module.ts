import { Module } from '@nestjs/common';

import { ApiKeyGuard } from '../infra/api-key.guard.js';
import { PaymentPageController } from '../page/payment-page.controller.js';
import { WebhookDispatcher } from '../webhooks/webhook-dispatcher.js';
import { PaymentSessionsService } from './payment-sessions.service.js';
import { SessionsController } from './sessions.controller.js';

@Module({
  controllers: [SessionsController, PaymentPageController],
  providers: [PaymentSessionsService, WebhookDispatcher, ApiKeyGuard],
})
export class SessionsModule {}
