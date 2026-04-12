import { z } from 'zod';
import { DAYS_OF_WEEK, type TimeRestriction } from './time.js';

export const TimeRestrictionSchema = z.object({
  allowed_days: z.array(z.enum(DAYS_OF_WEEK)),
  allowed_hours_start: z.number().int().min(0).max(23),
  allowed_hours_end: z.number().int().min(0).max(23),
  timezone: z.string().min(1),
}).refine(
  (data) => data.allowed_hours_start !== data.allowed_hours_end,
  { message: 'Start and end hours must differ' }
);

export const PolicySchema = z.object({
  operator_id: z.string().min(1).max(64),
  name: z.string().min(1).max(255),
  description: z.string().max(1000).optional(),
  max_daily_spend: z.number().positive().finite(),
  max_per_transaction: z.number().positive().finite(),
  allowed_endpoint_categories: z.array(z.string().min(1)).min(1),
  blocked_addresses: z.array(z.string().min(1)),
  time_restrictions: z.array(TimeRestrictionSchema),
  token_whitelist: z.array(z.string().min(1)).min(1),
  is_active: z.boolean().default(true),
});

export interface Policy {
  readonly id: string;
  readonly operator_id: string;
  readonly name: string;
  readonly description: string | null;
  readonly max_daily_spend: number;
  readonly max_per_transaction: number;
  readonly allowed_endpoint_categories: readonly string[];
  readonly blocked_addresses: readonly string[];
  readonly time_restrictions: readonly TimeRestriction[];
  readonly token_whitelist: readonly string[];
  readonly is_active: boolean;
  readonly version: number;
  readonly created_at: Date;
  readonly updated_at: Date;
}

export type PolicyInput = z.infer<typeof PolicySchema>;

export type PolicyUpdate = Partial<Omit<PolicyInput, 'operator_id'>>;

export interface CircuitPolicyInput {
  readonly policy_id: string;
  readonly operator_id: string;
  readonly max_daily_spend_lamports: bigint;
  readonly max_per_transaction_lamports: bigint;
  readonly allowed_endpoint_categories: readonly string[];
  readonly blocked_addresses: readonly string[];
  readonly time_restrictions: readonly TimeRestriction[];
  readonly token_whitelist: readonly string[];
  readonly version: number;
  readonly compiled_at: string;
}
