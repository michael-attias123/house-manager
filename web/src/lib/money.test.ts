import { formatILS, parseAmount, toAgorot } from './money'

describe('money', () => {
  it('parses user amounts', () => {
    expect(parseAmount('12.5')).toBe(12.5)
    expect(parseAmount('12,50')).toBe(12.5)
    expect(parseAmount('₪ 40')).toBe(40)
    expect(parseAmount('0')).toBeNull()
    expect(parseAmount('abc')).toBeNull()
    expect(parseAmount('1.234')).toBeNull()
  })

  it('shows agorot only when there are any', () => {
    expect(formatILS(40)).toMatch(/^\D*40\D*$/)
    expect(formatILS(12.5)).toContain('12.50')
    expect(formatILS(1234.567)).toContain('1,234.57')
  })

  it('rounds to agorot', () => {
    expect(toAgorot(0.1 + 0.2)).toBe(30)
    expect(toAgorot(19.99)).toBe(1999)
  })
})
