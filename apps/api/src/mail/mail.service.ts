import { Inject, Injectable, Logger } from '@nestjs/common';
import type { Transporter } from 'nodemailer';

import { ClockService } from '../clock/clock.service.js';
import { APP_CONFIG } from '../config/config.module.js';
import type { AppConfig } from '../config/config.schema.js';
import { MailRenderer, type MailTemplateData, type MailTemplateName } from './mail-templates.js';

/** Injection token for the Nodemailer transport (SMTP in the app, a fake in some tests). */
export const MAIL_TRANSPORT = Symbol('MAIL_TRANSPORT');

export interface MailRecipient {
  name: string;
  address: string;
}

/** A file sent with the email. With `cid`, it is an inline image the HTML shows as `cid:<cid>`. */
export interface MailAttachment {
  filename: string;
  content: Buffer;
  contentType: string;
  cid?: string;
}

export interface MailMessage<K extends MailTemplateName> {
  to: MailRecipient;
  template: K;
  data: MailTemplateData[K];
  attachments?: readonly MailAttachment[];
}

/**
 * Renders and sends emails. `send` resolves once the SMTP server has accepted the message and
 * rejects when it doesn't. Callers decide where it runs: the verification email is sent from the
 * request, the e-ticket email from a background job (C4.4).
 */
@Injectable()
export class MailService {
  private readonly logger = new Logger(MailService.name);

  constructor(
    @Inject(MAIL_TRANSPORT) private readonly transport: Transporter,
    private readonly renderer: MailRenderer,
    private readonly clock: ClockService,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  async send<K extends MailTemplateName>(message: MailMessage<K>): Promise<void> {
    const { subject, html, text } = this.renderer.render(message.template, message.data);
    const info = (await this.transport.sendMail({
      from: this.config.mailFrom,
      // An address object, never a formatted string: Nodemailer quotes and encodes the name, so a
      // user-chosen name can't add recipients or headers.
      to: { name: message.to.name, address: message.to.address },
      subject,
      html,
      text,
      attachments: (message.attachments ?? []).map((attachment) => ({
        filename: attachment.filename,
        content: attachment.content,
        contentType: attachment.contentType,
        ...(attachment.cid === undefined
          ? {}
          : { cid: attachment.cid, contentDisposition: 'inline' as const }),
      })),
      // The `Date` header follows the server clock, so it matches a frozen or moved test clock.
      date: await this.clock.now(),
    })) as { messageId?: string };
    this.logger.log(`Sent "${message.template}" email ${info.messageId ?? ''}`.trimEnd());
  }
}
