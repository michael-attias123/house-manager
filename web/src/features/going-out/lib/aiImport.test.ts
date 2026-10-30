import type { Venue } from '@/lib/db-types'
import { validateDraft } from './draft'
import { aiDealToDraft, aiInstructions, matchVenue, parseAiDeals } from './aiImport'

const venue = (id: number, name: string): Venue =>
  ({ id, name, kind: 'bar', status: 'approved', hidden: false, lat: null, lng: null }) as Venue

describe('aiInstructions', () => {
  it('gives the date and the places the app knows', () => {
    const text = aiInstructions('2026-11-03', ['זאלמה קוקטייל בר', 'פרלה', 'פרלה'])
    expect(text).toContain('היום 2026-11-03')
    expect(text).toContain('זאלמה קוקטייל בר, פרלה')
    expect(text).toContain('"deals"')
  })
})

describe('parseAiDeals', () => {
  it('reads a ```json block with text around it', () => {
    const answer = `מצאתי שני דילים:
\`\`\`json
{"deals": [
  {"place": "זאלמה", "address": null, "title": "1+1 על קוקטיילים", "kind": "happy_hour",
   "days": [0, 1, 2, 3, 4], "from": "19:00", "to": "21:00", "date": null, "until": null, "note": null},
  {"place": "החלוץ 33", "title": "הופעה של להקת הבית", "kind": "event", "days": [],
   "from": "21:30", "to": "23:30", "date": "2026-11-12", "until": null, "note": "כניסה 40 ש\\"ח"}
]}
\`\`\`
אם צריך עוד משהו, אשמח.`
    const result = parseAiDeals(answer)
    expect(result.error).toBeNull()
    expect(result.deals.map((d) => [d.place, d.kind, d.from, d.date])).toEqual([
      ['זאלמה', 'happy_hour', '19:00', null],
      ['החלוץ 33', 'event', '21:30', '2026-11-12'],
    ])
  })

  it('takes a bare array, and fixes small slips', () => {
    const result = parseAiDeals(
      '[{"place": "פרלה", "title": "בירה ב-20", "kind": "coupon", "days": ["ג", 9, 2, "ראשון", "יום ו׳", "שבת"], "from": "9:00", "to": "2130"}] תודה!',
    )
    expect(result.deals).toEqual([
      {
        place: 'פרלה', address: null, title: 'בירה ב-20', kind: 'happy_hour', days: [0, 2, 5, 6],
        from: '09:00', to: '21:30', date: null, until: null, note: null,
      },
    ])
  })

  it('says why nothing came out', () => {
    expect(parseAiDeals('לא מצאתי דילים')).toEqual({ deals: [], error: 'no_json' })
    expect(parseAiDeals('{"deals": []}')).toEqual({ deals: [], error: 'no_deals' })
    expect(parseAiDeals('{"other": 1}')).toEqual({ deals: [], error: 'no_deals' })
  })
})

describe('aiDealToDraft', () => {
  const base = parseAiDeals(
    '{"deals":[{"place":"פרלה","title":"בירה ב-20","kind":"special_day","days":[2],"from":"20:00","to":"23:00","until":"2026-12-31","note":"עם צ\'ייסר"}]}',
  ).deals[0]

  it('fills the deal form, which checks it like any other', () => {
    const draft = aiDealToDraft(base, 7)
    expect(draft).toMatchObject({
      venueId: 7, title: 'בירה ב-20', kind: 'special_day', weekdays: [2], allHours: false,
      startsAt: '20:00', endsAt: '23:00', date: '2026-12-31', note: "עם צ'ייסר",
    })
    expect(validateDraft(draft, '2026-11-03')).toEqual({})
    expect(validateDraft(aiDealToDraft(base, null), '2026-11-03')).toEqual({ venue: 'venue_missing' })
  })

  it('keeps a start without an end in the note, and an event on its date', () => {
    expect(aiDealToDraft({ ...base, to: null }, 1)).toMatchObject({ allHours: true, startsAt: '', note: "מ־20:00 · עם צ'ייסר" })
    expect(aiDealToDraft({ ...base, kind: 'event', date: '2026-11-12', until: null }, 1)).toMatchObject({
      weekdays: [], date: '2026-11-12',
    })
  })
})

describe('matchVenue', () => {
  const venues = [venue(1, 'זאלמה קוקטייל בר'), venue(2, 'פרלה'), venue(3, 'בר הפרלה')]
  it('finds the place by name', () => {
    expect(matchVenue(venues, 'פרלה')?.id).toBe(2)
    expect(matchVenue(venues, 'זאלמה')?.id).toBe(1)
    expect(matchVenue(venues, 'סושי בר טוקיו')).toBeNull()
  })
})
