import { randomBytes } from 'node:crypto';

import { Injectable } from '@nestjs/common';
import { hash, verify } from '@node-rs/argon2';

/**
 * Hashes and checks passwords with argon2id (the library defaults: 19 MiB, 2 iterations, 1 lane,
 * as OWASP recommends). Hashing runs on the libuv thread pool, not the event loop.
 */
@Injectable()
export class PasswordService {
  /** Checked when there is no usable hash, so every failed login costs the same time. */
  private dummyHash: Promise<string> | undefined;

  async hash(password: string): Promise<string> {
    return hash(password);
  }

  /**
   * Whether `password` matches `storedHash`. Returns false, never throws, when there is no stored
   * hash (unknown email) or it isn't an argon2 hash (e.g. `!locked` for seed scenario buyers),
   * after spending the same time on a dummy hash, so the response time doesn't reveal which
   * emails have an account.
   */
  async verify(storedHash: string | undefined, password: string): Promise<boolean> {
    if (storedHash !== undefined) {
      try {
        return await verify(storedHash, password);
      } catch {
        // Not a parsable argon2 hash: fall through to the dummy check.
      }
    }
    this.dummyHash ??= hash(randomBytes(16).toString('base64'));
    await verify(await this.dummyHash, password);
    return false;
  }
}
