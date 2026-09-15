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
