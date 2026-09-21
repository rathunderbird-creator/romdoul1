// Snap a dollar amount to whole cents. Summing cent-precision amounts in binary
// floating point leaves noise (0.1 + 0.2 → 0.30000000000000004), which is
// invisible through a toFixed(2)/toLocaleString formatter but shows up verbatim
// wherever the raw number is put in an <input> or String()'d — and is persisted
// if written back. The EPSILON nudge makes exact half-cents round up
// (1.005 → 1.01) despite float error.
export const roundCents = (n: number): number => Math.round((n + Number.EPSILON) * 100) / 100;
