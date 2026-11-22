import { createHash, timingSafeEqual } from 'node:crypto';

import {
  type CanActivate,
  type ExecutionContext,
  Inject,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import type { FastifyReply, FastifyRequest } from 'fastify';

import { APP_CONFIG } from '../config/config.module.js';
import type { AppConfig } from '../config/config.schema.js';

/**
 * Server-to-server routes need `Authorization: Bearer <PAYMENTS_API_KEY>`, as a real provider's
 * secret key. Without it anyone could make the service POST to any URL.
 */
@Injectable()
export class ApiKeyGuard implements CanActivate {
  private readonly expected: Buffer;

  constructor(@Inject(APP_CONFIG) config: AppConfig) {
    this.expected = digest(config.apiKey);
  }

  canActivate(context: ExecutionContext): boolean {
    const http = context.switchToHttp();
    const header = http.getRequest<FastifyRequest>().headers.authorization;
    const match = /^Bearer (.+)$/.exec(header ?? '');
    // Compares fixed-length digests, so the time taken says nothing about the key.
    if (match?.[1] !== undefined && timingSafeEqual(digest(match[1]), this.expected)) return true;
    void http.getResponse<FastifyReply>().header('WWW-Authenticate', 'Bearer');
    throw new UnauthorizedException('Missing or invalid API key.');
  }
}

function digest(value: string): Buffer {
  return createHash('sha256').update(value).digest();
}
