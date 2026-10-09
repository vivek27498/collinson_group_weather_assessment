/** Injected wherever "now" matters, so tests control time instead of sleeping or mocking Date. */
export interface Clock {
  now(): Date;
}

export const systemClock: Clock = { now: () => new Date() };
