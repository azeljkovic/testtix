import { CreatePaymentSessionRequestSchema, PaymentSessionSchema } from '@testtix/shared';
import { createZodDto } from 'nestjs-zod';

export class CreatePaymentSessionDto extends createZodDto(CreatePaymentSessionRequestSchema) {}
export class PaymentSessionDto extends createZodDto(PaymentSessionSchema) {}
