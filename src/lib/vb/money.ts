// Dinheiro do VB em centavos inteiros. Somar floats de duas casas acumula erro
// binário (0.1 + 0.2); toda soma passa por toCents.

/** Arredonda para centavos, simétrico em torno de zero (-1,005 → -1,01). */
export function roundCents(value: number): number {
  const sign = value < 0 ? -1 : 1;
  return (sign * Math.round(Math.abs(value) * 100 + 1e-7)) / 100;
}

export function toCents(value: number): number {
  const sign = value < 0 ? -1 : 1;
  return sign * Math.round(Math.abs(value) * 100 + 1e-7);
}

export function fromCents(cents: number): number {
  return cents / 100;
}

export function sumCents(values: readonly number[]): number {
  return values.reduce((acc, v) => acc + toCents(v), 0);
}
