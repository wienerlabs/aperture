export const DAYS_OF_WEEK = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'] as const;

export type DayOfWeek = typeof DAYS_OF_WEEK[number];

export interface TimeRestriction {
  readonly allowed_days: readonly DayOfWeek[];
  readonly allowed_hours_start: number;
  readonly allowed_hours_end: number;
  readonly timezone: string;
}
