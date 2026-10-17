import type { HouseholdMember } from '@/lib/db-types'
import { cn } from '@/lib/cn'

interface MemberAvatarProps {
  member: Pick<HouseholdMember, 'display_name' | 'color'> | undefined
  size?: 'sm' | 'md'
  className?: string
}

export function MemberAvatar({ member, size = 'md', className }: MemberAvatarProps) {
  return (
    <span
      title={member?.display_name}
      className={cn(
        'inline-flex shrink-0 items-center justify-center rounded-full font-semibold text-white',
        size === 'sm' ? 'h-6 w-6 text-xs' : 'h-9 w-9 text-sm',
        className,
      )}
      style={{ backgroundColor: member?.color ?? '#94a3b8' }}
    >
      {member?.display_name.slice(0, 1) ?? '?'}
    </span>
  )
}
