import { createContext, useContext, useMemo, type ReactNode } from 'react'
import { useQuery } from '@tanstack/react-query'
import type { User } from '@supabase/supabase-js'
import type { Household, HouseholdMember } from '@/lib/db-types'
import { fetchMembers, fetchMyHousehold } from './api'

export interface HouseholdContextValue {
  user: User
  household: Household
  members: HouseholdMember[]
  me: HouseholdMember | undefined
  partner: HouseholdMember | undefined
  memberById: (id: string | null | undefined) => HouseholdMember | undefined
}

const HouseholdContext = createContext<HouseholdContextValue | null>(null)

export const householdKeys = {
  mine: (userId: string) => ['household', userId] as const,
  members: (householdId: string) => ['household-members', householdId] as const,
}

export function useMyHouseholdQuery(userId: string) {
  return useQuery({
    queryKey: householdKeys.mine(userId),
    queryFn: () => fetchMyHousehold(userId),
  })
}

export function HouseholdProvider({
  user,
  household,
  children,
}: {
  user: User
  household: Household
  children: ReactNode
}) {
  const membersQuery = useQuery({
    queryKey: householdKeys.members(household.id),
    queryFn: () => fetchMembers(household.id),
  })

  const value = useMemo<HouseholdContextValue>(() => {
    const members = membersQuery.data ?? []
    const byId = new Map(members.map((m) => [m.user_id, m]))
    return {
      user,
      household,
      members,
      me: byId.get(user.id),
      partner: members.find((m) => m.user_id !== user.id),
      memberById: (id) => (id ? byId.get(id) : undefined),
    }
  }, [user, household, membersQuery.data])

  return <HouseholdContext.Provider value={value}>{children}</HouseholdContext.Provider>
}

export function useHousehold(): HouseholdContextValue {
  const value = useContext(HouseholdContext)
  if (!value) throw new Error('useHousehold must be used inside HouseholdProvider')
  return value
}
