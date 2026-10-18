const whole = new Intl.NumberFormat('he-IL', { style: 'currency', currency: 'ILS', maximumFractionDigits: 0 })
const exact = new Intl.NumberFormat('he-IL', { style: 'currency', currency: 'ILS', minimumFractionDigits: 2 })

/** Money is handled in integer agorot to avoid floating point drift. */
export function toAgorot(shekels: number): number {
  return Math.round(shekels * 100)
}

export function fromAgorot(agorot: number): number {
  return agorot / 100
}

/** "₪40" for whole amounts, "₪12.50" otherwise. */
export function formatILS(shekels: number): string {
  return (Number.isInteger(Math.round(shekels * 100) / 100) ? whole : exact).format(shekels)
}

/** Parses user input like "12.5", "12,50" or "₪12". Returns null if invalid. */
export function parseAmount(input: string): number | null {
  const cleaned = input.replace(/[₪\s]/g, '').replace(',', '.')
  if (!/^\d+(\.\d{0,2})?$/.test(cleaned)) return null
  const value = Number(cleaned)
  return value > 0 ? value : null
}
