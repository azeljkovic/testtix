import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import { Logger } from 'nestjs-pino';

import { REQUEST_ID_HEADER, requestIdFor } from './infra/request-id.js';

/** The HTTP adapter shared by `main.ts` and the tests. */
export function createHttpAdapter(): FastifyAdapter {
  return new FastifyAdapter({ genReqId: requestIdFor, requestIdHeader: false });
}

/** App-level setup shared by `main.ts` and the tests. Call before `init()` / `listen()`. */
export function configureApp(app: NestFastifyApplication): void {
  app.useLogger(app.get(Logger));
  app
    .getHttpAdapter()
    .getInstance()
    .addHook('onRequest', (request, reply, done) => {
      void reply.header(REQUEST_ID_HEADER, request.id);
      done();
    });
}
