import { useMemo, useRef, useState, type ChangeEvent } from 'react'
import { useNavigate } from 'react-router-dom'
import { useQueryClient } from '@tanstack/react-query'
import { CheckCircle2, FileUp, TriangleAlert } from 'lucide-react'
import { formatDay } from '@/lib/dates'
import { formatILS } from '@/lib/money'
import { cn } from '@/lib/cn'
import { Button } from '@/components/ui/Button'
import { Card, CardTitle } from '@/components/ui/Card'
import { ErrorBox } from '@/components/ui/Feedback'
import { Select } from '@/components/ui/Field'
import { Sheet } from '@/components/ui/Sheet'
import { addPlaceholderMember } from '@/features/household/api'
import { householdKeys, useHousehold } from '@/features/household/HouseholdProvider'
import { importExpenses, type ImportResult } from '../api'
import { expenseKeys } from '../hooks'
import { EXPENSE_CATEGORIES } from '../lib/categories'
import {
  balanceFromRows,
  convertRow,
  guessExpenseCategory,
  guessKind,
  guessPeople,
  parseSplitwise,
  rowKeys,
  type RowKind,
  type SplitwiseFile,
} from '../lib/splitwise'

/**
 * Settings card for moving history over from Splitwise. Used about once, so
 * it lives here rather than in the navigation: pick the export, check the
 * preview, import.
 */
// "Add to the household" choice for a Splitwise person: a placeholder member
// is created on import, until then rows use this stand-in id.
const NEW = 'new:'

export default function SplitwiseImportCard() {
  const inputRef = useRef<HTMLInputElement>(null)
  const [file, setFile] = useState<{ name: string; data: SplitwiseFile } | null>(null)
  const [error, setError] = useState<unknown>(null)

  async function onFile(e: ChangeEvent<HTMLInputElement>) {
    const picked = e.target.files?.[0]
    e.target.value = ''
    if (!picked) return
    setError(null)
    try {
      setFile({ name: picked.name, data: parseSplitwise(await picked.text()) })
    } catch (err) {
      setError(err)
    }
  }

  return (
    <Card className="space-y-2">
      <CardTitle>ייבוא מ-Splitwise</CardTitle>
      <p className="text-sm text-ink-2">
        מעבירים לכאן את ההיסטוריה מ-Splitwise, פעם אחת. ב-Splitwise: הקבוצה ← הגדרות ←{' '}
        <span dir="ltr">Export as spreadsheet</span>, ואז בוחרים כאן את קובץ ה-CSV.
      </p>
      <Button variant="secondary" onClick={() => inputRef.current?.click()}>
        <FileUp size={18} />
        בחירת קובץ
      </Button>
      <input
        ref={inputRef}
        type="file"
        accept=".csv,text/csv"
        className="hidden"
        onChange={onFile}
      />
      {error != null && <ErrorBox error={error} />}
      {file && <ImportSheet fileName={file.name} data={file.data} onClose={() => setFile(null)} />}
    </Card>
  )
}

function ImportSheet({
  fileName,
  data,
  onClose,
}: {
  fileName: string
  data: SplitwiseFile
  onClose: () => void
}) {
  const { household, members, user, memberById } = useHousehold()
  const queryClient = useQueryClient()
  const navigate = useNavigate()

  const keys = useMemo(() => rowKeys(data.rows), [data.rows])
  const [people, setPeople] = useState<(string | null)[]>(() => {
    const guessed = guessPeople(data.people, members, {
      id: user.id,
      names: [
        user.user_metadata?.full_name,
        user.user_metadata?.name,
        user.email?.split('@')[0],
      ].filter((n): n is string => typeof n === 'string'),
    })
    // Whoever is not in the household yet (the partner before signing in)
    // is added as a placeholder member by default.
    let free = data.people.length - members.length
    return guessed.map((id, i) => (id === null && free-- > 0 ? NEW + i : id))
  })
  const [kinds, setKinds] = useState<RowKind[]>(() => data.rows.map(guessKind))
  const [categories, setCategories] = useState<string[]>(() =>
    data.rows.map((r) => guessExpenseCategory(r.description, r.category)),
  )
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<unknown>(null)
  const [result, setResult] = useState<ImportResult | null>(null)

  const conversions = useMemo(
    () => data.rows.map((row, i) => convertRow(row, keys[i], people, kinds[i], categories[i])),
    [data.rows, keys, people, kinds, categories],
  )
  const expenses = conversions.flatMap((c) => (c.ok && 'expense' in c ? [c.expense] : []))
  const transfers = conversions.flatMap((c) => (c.ok && 'transfer' in c ? [c.transfer] : []))
  const skipped = conversions.filter((c) => !c.ok).length
  const duplicatePeople = people.filter(Boolean).length !== new Set(people.filter(Boolean)).size

  // Splitwise's own "Total balance" row against what these rows add up to.
  const imported = balanceFromRows(
    data.rows.filter((_, i) => conversions[i].ok),
    people,
  )
  const expected = data.totals
    ? Object.fromEntries(data.totals.flatMap((v, i) => (people[i] ? [[people[i]!, v]] : [])))
    : null
  const matches =
    expected !== null &&
    Object.keys({ ...expected, ...imported }).every(
      (id) => Math.abs((expected[id] ?? 0) - (imported[id] ?? 0)) < 0.005,
    )
  const creditor = Object.entries(imported).sort((a, b) => b[1] - a[1])[0]
  const nameOf = (id: string) =>
    id.startsWith(NEW) ? data.people[Number(id.slice(NEW.length))] : memberById(id)?.display_name

  const dates = data.rows.map((r) => r.date).sort()

  async function submit() {
    setBusy(true)
    setError(null)
    try {
      const ids = [...people]
      for (const [i, id] of ids.entries()) {
        if (id?.startsWith(NEW)) ids[i] = (await addPlaceholderMember(household.id, data.people[i])).user_id
      }
      setPeople(ids)
      await queryClient.invalidateQueries({ queryKey: householdKeys.members(household.id) })
      const final = data.rows.map((row, i) => convertRow(row, keys[i], ids, kinds[i], categories[i]))
      setResult(
        await importExpenses(
          household.id,
          final.flatMap((c) => (c.ok && 'expense' in c ? [c.expense] : [])),
          final.flatMap((c) => (c.ok && 'transfer' in c ? [c.transfer] : [])),
        ),
      )
      await queryClient.invalidateQueries({ queryKey: expenseKeys.all(household.id) })
    } catch (err) {
      setError(err)
    } finally {
      setBusy(false)
    }
  }

  if (result) {
    return (
      <Sheet
        open
        onClose={onClose}
        title="ייבוא מ-Splitwise"
        footer={
          <Button
            className="w-full"
            onClick={() => {
              onClose()
              navigate('/expenses')
            }}
          >
            להתחשבנות
          </Button>
        }
      >
        <div className="flex flex-col items-center gap-2 py-6 text-center">
          <CheckCircle2 size={40} className="text-emerald-600" />
          {result.expenses + result.settlements === 0 ? (
            <p className="text-lg font-semibold">הקובץ הזה כבר יובא, לא נוסף כלום</p>
          ) : (
            <p className="text-lg font-semibold">
              יובאו <span className="num">{result.expenses}</span> הוצאות ו-
              <span className="num">{result.settlements}</span> העברות
            </p>
          )}
          {result.skipped > 0 && result.expenses + result.settlements > 0 && (
            <p className="text-sm text-ink-2">
              <span className="num">{result.skipped}</span> שורות כבר היו מייבוא קודם ודולגו.
            </p>
          )}
        </div>
      </Sheet>
    )
  }

  return (
    <Sheet
      open
      onClose={onClose}
      title="ייבוא מ-Splitwise"
      footer={
        <Button
          className="w-full"
          onClick={submit}
          disabled={busy || duplicatePeople || expenses.length + transfers.length === 0}
        >
          ייבוא {expenses.length} הוצאות ו-{transfers.length} העברות
        </Button>
      }
    >
      <div className="space-y-4">
        <p className="text-sm text-ink-2">
          <span dir="ltr">{fileName}</span> · {data.rows.length} שורות
          {dates.length > 0 && (
            <>
              {' '}
              · {formatDay(dates[0])} עד {formatDay(dates[dates.length - 1])}
            </>
          )}
        </p>

        <section className="space-y-2">
          <h3 className="text-sm font-semibold text-ink-2">מי זה מי</h3>
          {data.people.map((name, i) => (
            <div key={name} className="flex items-center gap-3">
              <span className="min-w-0 flex-1 truncate" dir="auto">
                {name}
              </span>
              <Select
                aria-label={`מי זה ${name}`}
                className="w-40"
                value={people[i] ?? ''}
                onChange={(e) =>
                  setPeople((p) => p.map((v, j) => (j === i ? e.target.value || null : v)))
                }
              >
                <option value="">לא בבית</option>
                <option value={NEW + i}>להוסיף לבית את {name}</option>
                {members.map((m) => (
                  <option key={m.user_id} value={m.user_id}>
                    {m.display_name}
                  </option>
                ))}
              </Select>
            </div>
          ))}
          {duplicatePeople && (
            <p className="text-sm text-rose-600">כל אחד מכם צריך להופיע פעם אחת.</p>
          )}
        </section>

        {expected && (
          <div
            className={cn(
              'flex items-start gap-2 rounded-xl p-3 text-sm',
              matches
                ? 'bg-emerald-50 text-emerald-900 dark:bg-emerald-950 dark:text-emerald-100'
                : 'bg-amber-50 text-amber-900 dark:bg-amber-950 dark:text-amber-100',
            )}
          >
            {matches ? (
              <CheckCircle2 size={18} className="mt-0.5 shrink-0" />
            ) : (
              <TriangleAlert size={18} className="mt-0.5 shrink-0" />
            )}
            <span>
              {matches
                ? 'המאזן תואם ל-Splitwise'
                : 'המאזן לא תואם ל-Splitwise, בגלל שורות שלא ייובאו'}
              {creditor && creditor[1] > 0 && (
                <>
                  : יתרה לטובת {nameOf(creditor[0])}{' '}
                  <span className="num font-semibold">{formatILS(creditor[1])}</span>
                </>
              )}
              . היתרה תתווסף למה שכבר רשום כאן.
            </span>
          </div>
        )}

        <section className="space-y-1">
          <h3 className="text-sm font-semibold text-ink-2">השורות</h3>
          <p className="text-xs text-ink-3">
            החזרים ביניכם מסומנים כ"העברה" כדי שלא ייספרו כהוצאה. אפשר לשנות לכל שורה.
          </p>
          <ul className="divide-y divide-line">
            {data.rows.map((row, i) => {
              const c = conversions[i]
              const payer = c.ok ? nameOf('expense' in c ? c.expense.paidBy : c.transfer.from) : undefined
              return (
                <li key={keys[i]} className="space-y-1.5 py-2.5">
                  <div className="flex items-baseline gap-2">
                    <span className="min-w-0 flex-1 truncate">{row.description || '—'}</span>
                    <span className="num font-medium">{formatILS(row.cost)}</span>
                  </div>
                  <div className="flex flex-wrap items-center gap-2 text-xs text-ink-3">
                    <span>{formatDay(row.date)}</span>
                    {payer && (
                      <span>
                        ·{' '}
                        {kinds[i] === 'transfer'
                          ? `העברה מ־${payer}`
                          : `שולם ע״י ${payer}`}
                      </span>
                    )}
                    {!c.ok && <span className="text-rose-600">· לא ייובא: {c.reason}</span>}
                  </div>
                  <div className="flex items-center gap-2">
                    <div
                      className="flex rounded-lg bg-surface-2 p-0.5 text-xs"
                      role="group"
                      aria-label="סוג השורה"
                    >
                      {(['expense', 'transfer'] as const).map((k) => (
                        <button
                          key={k}
                          type="button"
                          aria-pressed={kinds[i] === k}
                          onClick={() => setKinds((ks) => ks.map((v, j) => (j === i ? k : v)))}
                          className={cn(
                            'rounded-md px-2.5 py-1',
                            kinds[i] === k
                              ? 'bg-surface font-medium text-ink shadow-sm'
                              : 'text-ink-2',
                          )}
                        >
                          {k === 'expense' ? 'הוצאה' : 'העברה'}
                        </button>
                      ))}
                    </div>
                    {kinds[i] === 'expense' && (
                      <Select
                        aria-label={`קטגוריה של ${row.description}`}
                        className="h-8 flex-1 py-0 text-sm"
                        value={categories[i]}
                        onChange={(e) =>
                          setCategories((cs) => cs.map((v, j) => (j === i ? e.target.value : v)))
                        }
                      >
                        {EXPENSE_CATEGORIES.map((cat) => (
                          <option key={cat.id} value={cat.id}>
                            {cat.emoji} {cat.label}
                          </option>
                        ))}
                      </Select>
                    )}
                  </div>
                </li>
              )
            })}
          </ul>
          {skipped > 0 && (
            <p className="text-sm text-ink-2">
              <span className="num">{skipped}</span> שורות לא ייובאו (הסיבה מופיעה ליד כל אחת).
            </p>
          )}
        </section>
        {error != null && <ErrorBox error={error} />}
      </div>
    </Sheet>
  )
}
