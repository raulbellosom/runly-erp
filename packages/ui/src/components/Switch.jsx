import { forwardRef } from 'react'
import * as SwitchPrimitive from '@radix-ui/react-switch'
import { cn } from '../lib/utils.js'

const Switch = forwardRef(function Switch({ className, ...props }, ref) {
  return (
    <SwitchPrimitive.Root
      ref={ref}
      className={cn(
        'peer inline-flex h-5 w-9 shrink-0 cursor-pointer items-center rounded-full border-2 border-transparent shadow-sm transition-colors',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[hsl(var(--ring))]/40 focus-visible:ring-offset-2',
        'disabled:cursor-not-allowed disabled:opacity-50',
        'data-[state=unchecked]:bg-[hsl(var(--muted-foreground)/0.3)]',
        'data-[state=checked]:bg-(--brand-primary)',
        className
      )}
      {...props}
    >
      <SwitchPrimitive.Thumb
        className={cn(
          'pointer-events-none block h-4 w-4 rounded-full bg-white shadow-md ring-0 transition-transform',
          'data-[state=unchecked]:translate-x-0',
          'data-[state=checked]:translate-x-4'
        )}
      />
    </SwitchPrimitive.Root>
  )
})

export { Switch }
