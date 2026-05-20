// Port of safe_float_convert() from main.py. Handles BRL-formatted strings
// ("R$ 1.000,00"), US-formatted strings ("1000.00"), and bare numbers.
// Returns 0 for anything unparseable so the validation logic never crashes.

export function parseValor(value: unknown): number {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value !== 'string') return 0

  let cleaned = value.trim().replace(/^R\$/i, '').trim()
  if (!cleaned) return 0

  const hasComma = cleaned.includes(',')
  const hasDot = cleaned.includes('.')

  if (hasComma && hasDot) {
    // BRL: dots are thousands separators, comma is decimal.
    cleaned = cleaned.replace(/\./g, '').replace(',', '.')
  } else if (hasComma) {
    // Single comma -> decimal separator.
    cleaned = cleaned.replace(',', '.')
  } else if (hasDot && cleaned.split('.').length > 2) {
    // Multiple dots, no comma -> dots are thousands separators.
    const parts = cleaned.split('.')
    cleaned = parts.slice(0, -1).join('') + '.' + parts[parts.length - 1]
  }

  cleaned = cleaned.replace(/\s+/g, '')
  const parsed = Number(cleaned)
  return Number.isFinite(parsed) ? parsed : 0
}
