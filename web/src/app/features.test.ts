import { dashboardWidgets, featureForPath, FEATURES, moreFeatures, primaryNav } from './features'

describe('feature registry', () => {
  it('has unique ids and paths', () => {
    expect(new Set(FEATURES.map((f) => f.id)).size).toBe(FEATURES.length)
    expect(new Set(FEATURES.map((f) => f.path)).size).toBe(FEATURES.length)
  })

  it('groups money features into one bottom-nav slot with tabs', () => {
    const nav = primaryNav()
    expect(nav.map((n) => n.key)).toEqual(['shopping', 'money', 'chores'])
    expect(nav[1].tabs?.map((t) => t.to)).toEqual(['/expenses', '/bills'])
  })

  it('lists the rest on the "more" page and orders widgets', () => {
    expect(moreFeatures().map((f) => f.id)).toEqual(['prices', 'insights', 'household'])
    expect(dashboardWidgets()[0].id).toBe('insights')
    expect(featureForPath('/bills')?.id).toBe('bills')
  })
})
