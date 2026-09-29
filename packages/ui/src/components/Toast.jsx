import { Toaster as Sonner } from 'sonner'

function Toaster({ ...props }) {
  return (
    <Sonner
      className="toaster group"
      position="top-center"
      mobileOffset={{ top: 'calc(var(--safe-top, 0px) + 12px)' }}
      expand
      closeButton
      toastOptions={{
        classNames: {
          toast: [
            'group toast glass pointer-events-auto!',
            'group-[.toaster]:rounded-xl group-[.toaster]:border-[hsl(var(--border))]',
            'group-[.toaster]:shadow-lg',
          ].join(' '),
          // Per-type accent: a colored left bar and icon, so an error never
          // reads like a success. Title/description keep the theme colors.
          success: 'border-l-4! border-l-emerald-500! [&_[data-icon]]:text-emerald-500',
          error: 'border-l-4! border-l-red-500! [&_[data-icon]]:text-red-500',
          warning: 'border-l-4! border-l-amber-500! [&_[data-icon]]:text-amber-500',
          info: 'border-l-4! border-l-sky-500! [&_[data-icon]]:text-sky-500',
          description: 'group-[.toast]:text-[hsl(var(--muted-foreground))]',
          actionButton: 'group-[.toast]:bg-indigo-500 group-[.toast]:text-white',
          cancelButton: 'group-[.toast]:bg-[hsl(var(--muted))] group-[.toast]:text-[hsl(var(--muted-foreground))]',
        },
      }}
      {...props}
    />
  )
}

export { Toaster }
