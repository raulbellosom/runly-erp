import { forwardRef } from 'react'
import * as PopoverPrimitive from '@radix-ui/react-popover'
import { cn, mergeRefs } from '../lib/utils.js'
import { useIsolatedScrollRef } from '../hooks/useIsolatedScroll.js'

const Popover = PopoverPrimitive.Root
const PopoverTrigger = PopoverPrimitive.Trigger
const PopoverAnchor = PopoverPrimitive.Anchor

const PopoverContent = forwardRef(function PopoverContent(
  { className, align = 'center', sideOffset = 4, ...props },
  ref
) {
  // Keep wheel/touch scrolling alive when the popover is opened from inside a
  // Dialog/Sheet (react-remove-scroll would otherwise cancel it). See
  // useIsolatedScroll for the full explanation.
  const scrollRef = useIsolatedScrollRef()
  // callback ref: the content node mounts only while open
  return (
    <PopoverPrimitive.Portal>
      <PopoverPrimitive.Content
        ref={mergeRefs(ref, scrollRef)}
        align={align}
        sideOffset={sideOffset}
        collisionPadding={8}
        className={cn(
          'z-50 rounded-xl glass-strong shadow-lg outline-none',
          'data-[state=open]:animate-in data-[state=closed]:animate-out',
          'data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0',
          'data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95',
          'data-[side=bottom]:slide-in-from-top-2 data-[side=left]:slide-in-from-right-2',
          'data-[side=right]:slide-in-from-left-2 data-[side=top]:slide-in-from-bottom-2',
          className
        )}
        {...props}
      />
    </PopoverPrimitive.Portal>
  )
})

export { Popover, PopoverTrigger, PopoverAnchor, PopoverContent }
