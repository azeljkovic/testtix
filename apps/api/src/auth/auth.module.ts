import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';

import { AuthCookies } from './auth-cookies.js';
import { AuthController } from './auth.controller.js';
import { AuthGuard } from './auth.guard.js';
import { AuthService } from './auth.service.js';
import { CsrfGuard } from './csrf.guard.js';
import { PasswordService } from './password.service.js';
import { SessionService } from './session.service.js';

/**
 * Accounts, sessions and the two global guards. Global guards run in the order they are
 * registered: `AuthGuard` (401/403) first, then `CsrfGuard` (403 `csrf-token-invalid`).
 */
@Module({
  controllers: [AuthController],
  providers: [
    AuthCookies,
    AuthService,
    PasswordService,
    SessionService,
    { provide: APP_GUARD, useClass: AuthGuard },
    { provide: APP_GUARD, useClass: CsrfGuard },
  ],
  exports: [AuthCookies, PasswordService, SessionService],
})
export class AuthModule {}
