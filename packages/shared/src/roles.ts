import { z } from 'zod';

/** User roles. Every account has exactly one. */
export const ROLES = ['CUSTOMER', 'ADMIN'] as const;

export const RoleSchema = z.enum(ROLES).meta({ id: 'Role' });

export type Role = z.infer<typeof RoleSchema>;
