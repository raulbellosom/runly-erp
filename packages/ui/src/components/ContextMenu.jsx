import { forwardRef, useRef } from 'react'
import * as ContextMenuPrimitive from '@radix-ui/react-context-menu'
import { Check, ChevronRight, Circle } from 'lucide-react'
import { cn, mergeRefs } from '../lib/utils.js'
import { useIsolatedScroll } from '../hooks/useIsolatedScroll.js'

// Right-click / long-press context menu. Same visual language as DropdownMenu
// (glass-strong surface, rounded-lg items, muted focus), but anchored at the
// pointer instead of a trigger element. Radix handles positioning, collision,
// keyboard nav, focus trap and portalling.

const ContextMenu = ContextMenuPrimitive.Root
const ContextMenuTrigger = ContextMenuPrimitive.Trigger
const ContextMenuGroup = ContextMenuPrimitive.Group
const ContextMenuPortal = ContextMenuPrimitive.Portal
const ContextMenuSub = ContextMenuPrimitive.Sub
const ContextMenuRadioGroup = ContextMenuPrimitive.RadioGroup

const ContextMenuSubTrigger = forwardRef(function ContextMenuSubTrigger(
  { className, inset, children, ...props },
  ref
) {
  return (
    <ContextMenuPrimitive.SubTrigger
      ref={ref}
      className={cn(
        'flex cursor-default select-none items-center gap-2 rounded-lg px-2 py-1.5 text-sm outline-none',
        'focus:bg-[hsl(var(--muted))] data-[state=open]:bg-[hsl(var(--muted))]',
        inset && 'pl-8',
        className
      )}
      {...props}
    >
      {children}
      <ChevronRight className="ml-auto h-4 w-4" />
    </ContextMenuPrimitive.SubTrigger>
  )
})

const ContextMenuSubContent = forwardRef(function ContextMenuSubContent(
  { className, ...props },
  ref
) {
  return (
    <ContextMenuPrimitive.SubContent
      ref={ref}
      className={cn(
        'z-50 min-w-[8rem] overflow-hidden rounded-xl glass-strong p-1 shadow-lg',
        'data-[state=open]:animate-in data-[state=closed]:animate-out',
        'data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0',
        'data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95',
        className
      )}
      {...props}
    />
  )
})

const ContextMenuContent = forwardRef(function ContextMenuContent(
  { className, ...props },
  ref
) {
  // Keep wheel/touch scrolling alive when the menu opens from inside a
  // Dialog/Sheet (react-remove-scroll lock). See useIsolatedScroll.
  const scrollRef = useRef(null)
  useIsolatedScroll(scrollRef)
  return (
    <ContextMenuPrimitive.Portal>
      <ContextMenuPrimitive.Content
        ref={mergeRefs(ref, scrollRef)}
        className={cn(
          'z-50 min-w-[9rem] overflow-hidden rounded-xl glass-strong p-1 shadow-lg',
          'data-[state=open]:animate-in data-[state=closed]:animate-out',
          'data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0',
          'data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95',
          'data-[side=bottom]:slide-in-from-top-2 data-[side=left]:slide-in-from-right-2',
          'data-[side=right]:slide-in-from-left-2 data-[side=top]:slide-in-from-bottom-2',
          className
        )}
        {...props}
      />
    </ContextMenuPrimitive.Portal>
  )
})

const ContextMenuItem = forwardRef(function ContextMenuItem(
  { className, inset, ...props },
  ref
) {
  return (
    <ContextMenuPrimitive.Item
      ref={ref}
      className={cn(
        'relative flex cursor-default select-none items-center gap-2.5 rounded-lg px-3 py-2.5 text-[13px] outline-none transition-colors',
        'hover:bg-[hsl(var(--muted))] active:bg-[hsl(var(--muted))]',
        'focus:bg-[hsl(var(--muted))] focus:text-[hsl(var(--foreground))]',
        'data-[disabled]:pointer-events-none data-[disabled]:opacity-50',
        '[&>svg]:size-4 [&>svg]:shrink-0',
        inset && 'pl-8',
        className
      )}
      {...props}
    />
  )
})

const ContextMenuCheckboxItem = forwardRef(function ContextMenuCheckboxItem(
  { className, children, checked, ...props },
  ref
) {
  return (
    <ContextMenuPrimitive.CheckboxItem
      ref={ref}
      className={cn(
        'relative flex cursor-default select-none items-center rounded-lg py-2.5 pl-8 pr-3 text-[13px] outline-none transition-colors',
        'hover:bg-[hsl(var(--muted))] active:bg-[hsl(var(--muted))] focus:bg-[hsl(var(--muted))]',
        'data-[disabled]:pointer-events-none data-[disabled]:opacity-50',
        className
      )}
      checked={checked}
      {...props}
    >
      <span className="absolute left-2 flex h-3.5 w-3.5 items-center justify-center">
        <ContextMenuPrimitive.ItemIndicator>
          <Check className="h-4 w-4 text-(--brand-primary)" />
        </ContextMenuPrimitive.ItemIndicator>
      </span>
      {children}
    </ContextMenuPrimitive.CheckboxItem>
  )
})

const ContextMenuRadioItem = forwardRef(function ContextMenuRadioItem(
  { className, children, ...props },
  ref
) {
  return (
    <ContextMenuPrimitive.RadioItem
      ref={ref}
      className={cn(
        'relative flex cursor-default select-none items-center rounded-lg py-2.5 pl-8 pr-3 text-[13px] outline-none transition-colors',
        'hover:bg-[hsl(var(--muted))] active:bg-[hsl(var(--muted))] focus:bg-[hsl(var(--muted))]',
        'data-[disabled]:pointer-events-none data-[disabled]:opacity-50',
        className
      )}
      {...props}
    >
      <span className="absolute left-2 flex h-3.5 w-3.5 items-center justify-center">
        <ContextMenuPrimitive.ItemIndicator>
          <Circle className="h-2 w-2 fill-(--brand-primary) text-(--brand-primary)" />
        </ContextMenuPrimitive.ItemIndicator>
      </span>
      {children}
    </ContextMenuPrimitive.RadioItem>
  )
})

const ContextMenuLabel = forwardRef(function ContextMenuLabel(
  { className, inset, ...props },
  ref
) {
  return (
    <ContextMenuPrimitive.Label
      ref={ref}
      className={cn(
        'px-2 py-1.5 text-xs font-medium text-[hsl(var(--muted-foreground))]',
        inset && 'pl-8',
        className
      )}
      {...props}
    />
  )
})

const ContextMenuSeparator = forwardRef(function ContextMenuSeparator(
  { className, ...props },
  ref
) {
  return (
    <ContextMenuPrimitive.Separator
      ref={ref}
      className={cn('-mx-1 my-1 h-px bg-[hsl(var(--border))]', className)}
      {...props}
    />
  )
})

function ContextMenuShortcut({ className, ...props }) {
  return (
    <span
      className={cn('ml-auto text-xs tracking-widest text-[hsl(var(--muted-foreground))]', className)}
      {...props}
    />
  )
}

export {
  ContextMenu,
  ContextMenuTrigger,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuCheckboxItem,
  ContextMenuRadioItem,
  ContextMenuLabel,
  ContextMenuSeparator,
  ContextMenuShortcut,
  ContextMenuGroup,
  ContextMenuPortal,
  ContextMenuSub,
  ContextMenuSubContent,
  ContextMenuSubTrigger,
  ContextMenuRadioGroup,
}
