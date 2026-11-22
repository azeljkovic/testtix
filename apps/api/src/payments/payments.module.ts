import { Module } from '@nestjs/common';

import { PaymentsClient } from './payments.client.js';

/** The payment provider's API (C4.2). Webhooks from it arrive in C4.3. */
@Module({
  providers: [PaymentsClient],
  exports: [PaymentsClient],
})
export class PaymentsModule {}
