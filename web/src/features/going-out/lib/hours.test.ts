import { openState, parseOpeningHours, todayHours, weekLines } from './hours'

// November 2026 is UTC+2 in Israel. 2026-11-01 is a Sunday … 2026-11-07 a Saturday.
const at = (local: string) => new Date(`${local}:00+02:00`)
const SUN = '2026-11-01'
const MON = '2026-11-02'
const TUE = '2026-11-03'
const WED = '2026-11-04'
const THU = '2026-11-05'
const FRI = '2026-11-06'
const SAT = '2026-11-07'

describe('openState', () => {
  it('reads a simple weekday string', () => {
    const hours = 'Mo-Fr 09:00-17:00; Sa 10:00-14:00'
    expect(openState(hours, at(`${MON}T12:00`))).toEqual({ state: 'open', closesAt: '17:00' })
    expect(openState(hours, at(`${MON}T08:00`))).toEqual({ state: 'closed', opensAt: '09:00', opensInDays: 0 })
    expect(openState(hours, at(`${FRI}T18:00`))).toEqual({ state: 'closed', opensAt: '10:00', opensInDays: 1 })
    expect(openState(hours, at(`${SUN}T12:00`))).toEqual({ state: 'closed', opensAt: '09:00', opensInDays: 1 })
  })

  it('keeps a range past midnight on the day it started', () => {
    const hours = 'Su-Th 15:00-04:00; Sa "צאת שבת עד 04:00"'
    // Thursday's night runs into Friday morning; Friday itself is not listed.
    expect(openState(hours, at(`${FRI}T02:00`))).toEqual({ state: 'open', closesAt: '04:00' })
    expect(openState(hours, at(`${MON}T16:00`))).toEqual({ state: 'open', closesAt: '04:00' })
    expect(openState(hours, at(`${MON}T10:00`))).toEqual({ state: 'closed', opensAt: '15:00', opensInDays: 0 })
  })

  it('never calls a quoted comment closed', () => {
    const hours = 'Su-Th 15:00-04:00; Sa "צאת שבת עד 04:00"'
    expect(openState(hours, at(`${SAT}T21:00`)).state).toBe('unknown')
    // The night after a day of unknown hours stays unknown.
    expect(openState(hours, at(`${SUN}T02:00`)).state).toBe('unknown')
    // Friday noon is closed, but the next opening is not certain (Saturday is unknown).
    expect(openState(hours, at(`${FRI}T12:00`))).toEqual({ state: 'closed' })
  })

  it('reads a day list with a gap and an end at midnight', () => {
    const hours = 'Mo-We, Su 12:00-00:00; Th-Sa 12:00-01:00'
    expect(openState(hours, at(`${SUN}T23:00`))).toEqual({ state: 'open', closesAt: '00:00' })
    expect(openState(hours, at(`${MON}T00:30`))).toEqual({ state: 'closed', opensAt: '12:00', opensInDays: 0 })
    expect(openState(hours, at(`${FRI}T00:30`))).toEqual({ state: 'open', closesAt: '01:00' })
  })

  it('lets a later rule for named days override a bare time range', () => {
    const hours = '10:00-24:00; Fr,Sa 09:00-24:00'
    expect(openState(hours, at(`${TUE}T09:30`))).toEqual({ state: 'closed', opensAt: '10:00', opensInDays: 0 })
    expect(openState(hours, at(`${FRI}T09:30`))).toEqual({ state: 'open', closesAt: '00:00' })
  })

  it('reads two ranges in one rule', () => {
    const hours = 'Sa-Th 21:00-02:00; Fr 12:00-16:30, 21:00-02:00'
    expect(openState(hours, at(`${FRI}T13:00`))).toEqual({ state: 'open', closesAt: '16:30' })
    expect(openState(hours, at(`${FRI}T18:00`))).toEqual({ state: 'closed', opensAt: '21:00', opensInDays: 0 })
    expect(openState(hours, at(`${SAT}T01:00`))).toEqual({ state: 'open', closesAt: '02:00' })
    expect(openState(hours, at(`${WED}T12:00`))).toEqual({ state: 'closed', opensAt: '21:00', opensInDays: 0 })
  })

  it('reads every day to midnight', () => {
    expect(openState('Mo-Su 12:00-00:00', at(`${THU}T20:00`))).toEqual({ state: 'open', closesAt: '00:00' })
    expect(openState('Mo-Su 12:00-00:00', at(`${THU}T11:00`))).toEqual({
      state: 'closed',
      opensAt: '12:00',
      opensInDays: 0,
    })
  })

  it('reads 24/7 and off', () => {
    expect(openState('24/7', at(`${SAT}T04:00`))).toEqual({ state: 'open' })
    expect(openState('off', at(`${SAT}T04:00`))).toEqual({ state: 'closed' })
    expect(openState('Mo-Fr 09:00-17:00; We off', at(`${WED}T12:00`))).toEqual({
      state: 'closed',
      opensAt: '09:00',
      opensInDays: 1,
    })
  })

  it('adds a rule after a comma instead of replacing', () => {
    const hours = 'Mo-Fr 09:00-17:00, Sa 10:00-14:00'
    expect(openState(hours, at(`${SAT}T11:00`))).toEqual({ state: 'open', closesAt: '14:00' })
    expect(openState(hours, at(`${MON}T11:00`))).toEqual({ state: 'open', closesAt: '17:00' })
  })

  it('leaves holiday rules out', () => {
    expect(openState('Su-Th 09:00-17:00; PH off', at(`${MON}T12:00`)).state).toBe('open')
  })

  it('says unknown for anything it cannot read, never closed', () => {
    for (const text of [null, '', 'by appointment', 'Mo-Fr 18:00+', 'sunrise-sunset', 'Jan-Mar Mo 10:00-12:00', 'Mo 25:00-26:00', 'Mo-Fr 09:00-17:00 || "call"']) {
      expect(openState(text, at(`${MON}T12:00`)), String(text)).toEqual({ state: 'unknown' })
    }
  })
})

describe('parseOpeningHours', () => {
  it('keeps the comment of a comment-only rule', () => {
    const week = parseOpeningHours('Su-Th 15:00-04:00; Sa "צאת שבת עד 04:00"')!
    expect(week[6]).toEqual({ ranges: [], unknown: true, comment: 'צאת שבת עד 04:00' })
    expect(week[5]).toEqual({ ranges: [], unknown: false, comment: null })
    expect(week[0].ranges).toEqual([[900, 1680]])
  })
})

describe('display', () => {
  it("shows today's hours and the week", () => {
    const hours = 'Sa-Th 21:00-02:00; Fr 12:00-16:30, 21:00-02:00'
    expect(todayHours(hours, at(`${FRI}T10:00`))).toEqual({ day: 'ו׳', times: '12:00–16:30, 21:00–02:00', note: null })
    expect(todayHours('nonsense', at(`${FRI}T10:00`))).toBeNull()
    const lines = weekLines('Su-Th 15:00-04:00; Sa "צאת שבת עד 04:00"')!
    expect(lines.map((l) => [l.day, l.times, l.note])).toEqual([
      ['א׳', '15:00–04:00', null],
      ['ב׳', '15:00–04:00', null],
      ['ג׳', '15:00–04:00', null],
      ['ד׳', '15:00–04:00', null],
      ['ה׳', '15:00–04:00', null],
      ['ו׳', null, 'סגור'],
      ['ש׳', null, 'צאת שבת עד 04:00'],
    ])
    expect(weekLines('24/7')![0]).toEqual({ day: 'א׳', times: null, note: 'כל היממה' })
  })
})
