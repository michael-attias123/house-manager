import { dashboardWidgets, featureForPath, FEATURES, moreFeatures, primaryNav } from './features'

describe('feature registry', () => {
  it('has unique ids and paths', () => {
    expect(new Set(FEATURES.map((f) => f.id)).size).toBe(FEATURES.length)
    expect(new Set(FEATURES.map((f) => f.path)).size).toBe(FEATURES.length)
  })

  it('groups money features into one bottom-nav slot with tabs', () => {
    const nav = primaryNav()
    expect(nav.map((n) => n.key)).toEqual(['shopping', 'money', 'chores', 'going-out'])
    expect(nav[1].tabs?.map((t) => t.to)).toEqual(['/expenses', '/bills'])
  })

  it('puts going out in the bar under its short label', () => {
    const nav = primaryNav()
    expect(nav.map((n) => n.key)).toContain('going-out')
    expect(nav.find((n) => n.key === 'going-out')?.title).toBe('יוצאים')
    expect(FEATURES.find((f) => f.id === 'going-out')?.title).toBe('לאן יוצאים')
  })

  it('lists the rest on the "more" page and orders widgets', () => {
    expect(moreFeatures().map((f) => f.id)).toEqual(['prices', 'insights', 'household'])
    expect(dashboardWidgets()[0].id).toBe('insights')
    expect(featureForPath('/bills')?.id).toBe('bills')
    // The going-out card comes after the shopping list and the bills.
    const order = dashboardWidgets().map((w) => w.id)
    expect(order.indexOf('going-out')).toBeGreaterThan(order.indexOf('shopping'))
    expect(order.indexOf('going-out')).toBeGreaterThan(order.indexOf('bills'))
  })

  it('keeps the admin screen out of the navigation (reached from Settings)', () => {
    expect(primaryNav().map((n) => n.key)).not.toContain('admin')
    expect(primaryNav().flatMap((n) => n.paths)).not.toContain('/admin')
    expect(moreFeatures().map((f) => f.id)).not.toContain('admin')
    expect(featureForPath('/admin')?.SettingsSection).toBeDefined()
  })

  it('has a Settings card for notifications, before the rarely used ones, and no nav entry', () => {
    const sections = FEATURES.filter((f) => f.SettingsSection).map((f) => f.id)
    expect(sections[0]).toBe('notifications')
    expect(primaryNav().map((n) => n.key)).not.toContain('notifications')
    expect(moreFeatures().map((f) => f.id)).not.toContain('notifications')
  })
})
