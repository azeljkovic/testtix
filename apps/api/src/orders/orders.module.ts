import { Module } from '@nestjs/common';

import { PaymentsModule } from '../payments/payments.module.js';
import { OrderJobsModule } from './order-jobs.module.js';
import { OrdersController } from './orders.controller.js';
import { OrdersService } from './orders.service.js';
import { PaymentWebhooksController } from './payment-webhooks.controller.js';
import { PaymentWebhooksService } from './payment-webhooks.service.js';

/** Checkout and customers' orders (C4.2), and the payment provider's webhooks (C4.3). */
@Module({
  imports: [PaymentsModule, OrderJobsModule],
  controllers: [OrdersController, PaymentWebhooksController],
  providers: [OrdersService, PaymentWebhooksService],
})
export class OrdersModule {}
