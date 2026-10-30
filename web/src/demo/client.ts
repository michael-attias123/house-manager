// A small stand-in for the supabase-js client: just the query-builder,
// rpc, auth and realtime calls this app makes, over the in-memory tables.
import { DEMO_USERS } from './seed'
import { RPCS, VIEWS } from './rpc'
import { currentUserId, db, primaryKey, save, withDefaults, type Row } from './store'

type Result = { data: unknown; error: { message: string } | null }

// "joined_at, households(*)" → own columns + embedded relations.
interface Selection {
  columns: string[] | '*'
  relations: { table: string; columns: string[] | '*' }[]
}

function parseSelect(text: string): Selection {
  const parts: string[] = []
  let depth = 0
  let current = ''
  for (const ch of text) {
    if (ch === '(') depth++
    if (ch === ')') depth--
    if (ch === ',' && depth === 0) {
      parts.push(current.trim())
      current = ''
    } else current += ch
  }
  if (current.trim()) parts.push(current.trim())

  const selection: Selection = { columns: [], relations: [] }
  const own: string[] = []
  for (const part of parts) {
    const rel = part.match(/^(\w+)\((.*)\)$/)
    if (rel) {
      const cols = rel[2].trim()
      selection.relations.push({ table: rel[1], columns: cols === '*' ? '*' : cols.split(',').map((c) => c.trim()) })
    } else if (part === '*') {
      selection.columns = '*'
    } else {
      own.push(part)
    }
  }
  if (selection.columns !== '*') selection.columns = own
  return selection
}

function pick(row: Row, columns: string[] | '*'): Row {
  if (columns === '*') return { ...row }
  return Object.fromEntries(columns.map((c) => [c, row[c]]))
}

const PRIVATE_TABLES = ['app_admins', 'allowed_emails', 'auth_users']

// Row-level security for the tables that other households' rows share
// (20261101000100_going_out.sql): the global catalog and approved deals are
// everyone's, a suggestion only its household's until an admin approves it.
// Other tables need none here: the app already asks for its household's rows.
interface Policy {
  select: (row: Row, mine: Set<string>) => boolean
  insert: (row: Row, mine: Set<string>) => boolean
  /** update and delete */
  write: (row: Row, mine: Set<string>) => boolean
}

const POLICIES: Record<string, Policy> = {
  venues: {
    select: (r, mine) => (r.household_id == null && !r.hidden) || mine.has(r.household_id),
    insert: (r, mine) =>
      r.source === 'community' && r.status === 'pending' && mine.has(r.household_id) && r.created_by === currentUserId(),
    write: (r, mine) => mine.has(r.household_id) && r.status !== 'approved',
  },
  venue_deals: {
    select: (r, mine) => r.status === 'approved' || mine.has(r.household_id),
    insert: (r, mine) =>
      r.status === 'pending' &&
      mine.has(r.household_id) &&
      r.created_by === currentUserId() &&
      db.venues.some((v) => v.id === r.venue_id && POLICIES.venues.select(v, mine)),
    write: (r, mine) => mine.has(r.household_id) && r.status !== 'approved',
  },
}

// Changed only inside the admin_review_* RPCs (a trigger in the real database).
const REVIEW_COLUMNS = ['status', 'reviewed_by', 'reviewed_at', 'review_note']

const myHouseholds = () =>
  new Set(db.household_members.filter((m) => m.user_id === currentUserId()).map((m) => String(m.household_id)))

// Embedded resources used by the app's selects.
const RELATIONS: Record<string, { kind: 'children' | 'parent'; key: string }> = {
  'expenses.expense_shares': { kind: 'children', key: 'expense_id' },
  'household_members.households': { kind: 'parent', key: 'household_id' },
}

function embed(table: string, row: Row, relation: Selection['relations'][number]) {
  const rel = RELATIONS[`${table}.${relation.table}`]
  if (!rel) throw new Error(`Could not find a relationship between '${table}' and '${relation.table}'`)
  const rows = db[relation.table]
  if (rel.kind === 'children') return rows.filter((c) => c[rel.key] === row.id).map((c) => pick(c, relation.columns))
  const parent = rows.find((p) => p.id === row[rel.key])
  return parent ? pick(parent, relation.columns) : null
}

class Query implements PromiseLike<Result> {
  private op: 'select' | 'insert' | 'update' | 'upsert' | 'delete' = 'select'
  private selection: Selection | null = null
  private filters: ((row: Row) => boolean)[] = []
  private orders: { column: string; ascending: boolean }[] = []
  private max: number | null = null
  private one = false
  private payload: Row | Row[] | null = null
  private ignoreDuplicates = false

  constructor(private table: string) {}

  select(columns = '*') {
    this.selection = parseSelect(columns)
    return this
  }
  insert(values: Row | Row[]) {
    this.op = 'insert'
    this.payload = values
    return this
  }
  upsert(values: Row | Row[], options: { ignoreDuplicates?: boolean } = {}) {
    this.op = 'upsert'
    this.payload = values
    this.ignoreDuplicates = Boolean(options.ignoreDuplicates)
    return this
  }
  update(values: Row) {
    this.op = 'update'
    this.payload = values
    return this
  }
  delete() {
    this.op = 'delete'
    return this
  }
  eq(column: string, value: unknown) {
    this.filters.push((r) => r[column] === value)
    return this
  }
  in(column: string, values: unknown[]) {
    this.filters.push((r) => values.includes(r[column]))
    return this
  }
  gte(column: string, value: string | number) {
    this.filters.push((r) => r[column] >= value)
    return this
  }
  order(column: string, options: { ascending?: boolean } = {}) {
    this.orders.push({ column, ascending: options.ascending ?? true })
    return this
  }
  limit(count: number) {
    this.max = count
    return this
  }
  single() {
    this.one = true
    return this
  }

  then<A = Result, B = never>(
    onfulfilled?: ((value: Result) => A | PromiseLike<A>) | null,
    onrejected?: ((reason: unknown) => B | PromiseLike<B>) | null,
  ): PromiseLike<A | B> {
    let result: Result
    try {
      result = { data: this.run(), error: null }
    } catch (err) {
      result = { data: null, error: { message: err instanceof Error ? err.message : String(err) } }
    }
    return Promise.resolve(result).then(onfulfilled, onrejected)
  }

  private source(): Row[] {
    if (VIEWS[this.table]) return VIEWS[this.table]()
    if (!db[this.table]) throw new Error(`Could not find the table 'public.${this.table}'`)
    return db[this.table]
  }

  private matches(row: Row) {
    return this.filters.every((f) => f(row))
  }

  private run(): unknown {
    // No grants on these in the real database: only the admin RPCs reach them.
    if (PRIVATE_TABLES.includes(this.table)) throw new Error(`permission denied for table ${this.table}`)
    const policy = POLICIES[this.table]
    const mine = policy ? myHouseholds() : new Set<string>()
    const visible = (r: Row) => !policy || policy.select(r, mine)
    // Rows this user may change: visible ones, then the update/delete policy.
    const changeable = (r: Row) => this.matches(r) && visible(r) && (!policy || policy.write(r, mine))
    const checkNew = (r: Row) => {
      if (policy && !policy.insert(r, mine)) {
        throw new Error(`new row violates row-level security policy for table "${this.table}"`)
      }
    }
    let affected: Row[]
    switch (this.op) {
      case 'select':
        affected = this.source().filter((r) => this.matches(r) && visible(r))
        break
      case 'insert':
        affected = [this.payload ?? []].flat().map((v) => withDefaults(this.table, v))
        affected.forEach(checkNew)
        db[this.table].push(...affected)
        break
      case 'upsert': {
        const key = primaryKey(this.table)
        affected = []
        for (const value of [this.payload ?? []].flat()) {
          const existing = db[this.table].find((r) => key.every((k) => r[k] === value[k]))
          if (existing) {
            if (!this.ignoreDuplicates) Object.assign(existing, value)
          } else {
            const row = withDefaults(this.table, value)
            checkNew(row)
            db[this.table].push(row)
            affected.push(row)
          }
        }
        break
      }
      case 'update':
        if (policy && REVIEW_COLUMNS.some((c) => c in (this.payload as Row))) {
          throw new Error('status and review columns change only through admin_review_*')
        }
        affected = db[this.table].filter(changeable)
        for (const row of affected) {
          Object.assign(row, this.payload)
          if ('updated_at' in row) row.updated_at = new Date().toISOString()
        }
        break
      case 'delete': {
        affected = db[this.table].filter(changeable)
        const gone = new Set(affected)
        db[this.table] = db[this.table].filter((r) => !gone.has(r))
        cascadeDelete(this.table, affected)
        break
      }
    }
    if (this.op !== 'select') save()
    if (this.op !== 'select' && !this.selection) return null

    let rows = [...affected]
    for (const { column, ascending } of [...this.orders].reverse()) {
      rows.sort((a, b) => {
        const x = a[column]
        const y = b[column]
        if (x === y) return 0
        if (x == null) return 1
        if (y == null) return -1
        return (x < y ? -1 : 1) * (ascending ? 1 : -1)
      })
    }
    if (this.max !== null) rows = rows.slice(0, this.max)
    const selection = this.selection ?? parseSelect('*')
    const shaped = rows.map((row) => {
      const out = pick(row, selection.columns)
      for (const rel of selection.relations) out[rel.table] = embed(this.table, row, rel)
      return structuredClone(out)
    })
    if (this.one) {
      if (shaped.length !== 1) throw new Error('JSON object requested, multiple (or no) rows returned')
      return shaped[0]
    }
    return shaped
  }
}

// The ON DELETE CASCADE / SET NULL rules this app relies on.
function cascadeDelete(table: string, rows: Row[]) {
  const ids = new Set(rows.map((r) => r.id))
  if (table === 'expenses') {
    db.expense_shares = db.expense_shares.filter((s) => !ids.has(s.expense_id))
    for (const p of db.bill_payments) if (ids.has(p.expense_id)) p.expense_id = null
  }
  if (table === 'venues') db.venue_deals = db.venue_deals.filter((d) => !ids.has(d.venue_id))
}

function session() {
  const user = DEMO_USERS.find((u) => u.id === currentUserId())!
  return {
    access_token: 'demo',
    token_type: 'bearer',
    user: { id: user.id, email: user.email, user_metadata: { full_name: user.name }, app_metadata: {}, aud: 'authenticated' },
  }
}

type DemoSession = ReturnType<typeof session>
type AuthListener = (event: string, current: DemoSession | null) => void
const listeners = new Set<AuthListener>()
let signedIn = true

function emit(event: string) {
  for (const l of listeners) l(event, signedIn ? session() : null)
}

const auth = {
  async initialize() {
    return { error: null }
  },
  onAuthStateChange(callback: AuthListener) {
    listeners.add(callback)
    setTimeout(() => callback('INITIAL_SESSION', signedIn ? session() : null), 0)
    return { data: { subscription: { unsubscribe: () => listeners.delete(callback) } } }
  },
  async signOut() {
    signedIn = false
    emit('SIGNED_OUT')
    return { error: null }
  },
  async signInWithOtp() {
    return { data: {}, error: null }
  },
  async verifyOtp() {
    signedIn = true
    emit('SIGNED_IN')
    return { data: {}, error: null }
  },
  async signInWithOAuth() {
    signedIn = true
    emit('SIGNED_IN')
    return { data: {}, error: null }
  },
}

const channelStub = {
  on() {
    return channelStub
  },
  subscribe() {
    return channelStub
  },
}

export const demoClient = {
  from: (table: string) => new Query(table),
  async rpc(name: string, args: Record<string, unknown> = {}): Promise<Result> {
    const fn = RPCS[name]
    if (!fn) return { data: null, error: { message: `function ${name} does not exist` } }
    try {
      const data = structuredClone(fn(args))
      save()
      return { data, error: null }
    } catch (err) {
      return { data: null, error: { message: err instanceof Error ? err.message : String(err) } }
    }
  },
  auth,
  channel: () => channelStub,
  removeChannel: async () => 'ok',
}
