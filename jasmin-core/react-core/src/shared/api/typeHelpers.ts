/**
 * Type helpers for the orval-generated models.
 *
 * Orval marks server-generated fields `readonly`. `Writable<T>` drops the
 * modifier, for a form state the page builds from a response model and then
 * edits. A request body needs none of this: it has its own generated
 * `…Request` type without the read-only fields.
 *
 *   const payload: OrderContentRequest = { reseller, offer, amount };
 *   await commissioningOrderContentsCreate(payload);
 */
export type Writable<T> = { -readonly [K in keyof T]: T[K] };
