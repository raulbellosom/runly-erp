import { Avatar, AvatarImage, AvatarFallback } from './Avatar.jsx'
import { cn } from '../lib/utils.js'

// Photo of a person (user, employee, actor) with an initials bubble fallback.
// `src` is a ready signed URL (APIs embed it as `avatarUrl`); without one, or
// while it loads / if it fails, the initials show on a color derived from the
// name so different people are easy to tell apart.
const SIZES = {
  xs: 'h-5 w-5 text-[9px]',
  sm: 'h-7 w-7 text-[11px]',
  md: 'h-9 w-9 text-xs',
  lg: 'h-12 w-12 text-sm',
}

const HUES = [262, 199, 152, 24, 340, 43, 217, 291]

export function personInitials(name) {
  const words = String(name ?? '').trim().split(/\s+/).filter(Boolean)
  return (words.slice(0, 2).map((w) => w[0]?.toUpperCase() ?? '').join('')) || '?'
}

function hueFor(name) {
  let hash = 0
  for (const ch of String(name ?? '')) hash = (hash * 31 + ch.charCodeAt(0)) | 0
  return HUES[Math.abs(hash) % HUES.length]
}

export function PersonAvatar({ name, src = null, size = 'sm', className, ...rest }) {
  const hue = hueFor(name)
  return (
    <Avatar className={cn(SIZES[size] ?? SIZES.sm, className)} title={name || undefined} {...rest}>
      {src ? <AvatarImage src={src} alt={name || ''} loading="lazy" decoding="async" /> : null}
      <AvatarFallback
        className="font-semibold"
        style={{ backgroundColor: `hsl(${hue} 70% 92%)`, color: `hsl(${hue} 55% 32%)` }}
      >
        {personInitials(name)}
      </AvatarFallback>
    </Avatar>
  )
}

export default PersonAvatar
