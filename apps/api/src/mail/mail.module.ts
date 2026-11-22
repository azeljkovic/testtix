import { Inject, Module, type OnApplicationShutdown } from '@nestjs/common';
import { createTransport, type Transporter } from 'nodemailer';

import { APP_CONFIG } from '../config/config.module.js';
import type { AppConfig } from '../config/config.schema.js';
import { MailRenderer } from './mail-templates.js';
import { MAIL_TRANSPORT, MailService } from './mail.service.js';

/** Connecting, the SMTP greeting and an idle socket each give up after this long. */
export const SMTP_TIMEOUT_MS = 10_000;

/** Outgoing email: `MailService` sends Handlebars templates over SMTP (`SMTP_URL`). */
@Module({
  providers: [
    {
      provide: MAIL_TRANSPORT,
      inject: [APP_CONFIG],
      useFactory: (config: AppConfig): Transporter =>
        // A new connection per message: email is rare (registration, orders), so no pool to manage.
        createTransport({
          url: config.smtpUrl,
          connectionTimeout: SMTP_TIMEOUT_MS,
          greetingTimeout: SMTP_TIMEOUT_MS,
          socketTimeout: SMTP_TIMEOUT_MS,
        }),
    },
    { provide: MailRenderer, useFactory: () => new MailRenderer() },
    MailService,
  ],
  exports: [MailService],
})
export class MailModule implements OnApplicationShutdown {
  constructor(@Inject(MAIL_TRANSPORT) private readonly transport: Transporter) {}

  onApplicationShutdown(): void {
    this.transport.close();
  }
}
