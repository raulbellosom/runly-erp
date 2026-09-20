import { useState } from 'react'
import { useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { Server, Layers, Building2, Mail, Lock, ArrowRight, CheckCircle2, AlertCircle } from 'lucide-react'
import { supabase } from '../lib/supabase'
import { TextField, PasswordField, Button, AuthAtmosphere, Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@runly/ui'
import { clearServerUrl, isTauriRuntime } from '../lib/serverStore.js'
import { runly } from '../lib/runly'
import { useAuth } from './AuthProvider'
import { normalizeAuthReturnPath } from './authReturnPath.js'
import { useThemeStore } from '../stores/theme'
import { ThemeToggle } from '../components/ThemeToggle'
import { RUNLY_EDITION_NAME } from '../lib/appConfig.js'

const SIDEBAR_FEATURES = [
  { icon: Server, label: 'Autoalojado en tu infraestructura' },
  { icon: Layers, label: 'Módulos que crecen con tu operación' },
  { icon: Building2, label: 'Multi-empresa desde el primer día' },
]

const CTA_GRADIENT = { backgroundImage: 'linear-gradient(120deg,#FD6016,#E4262A)' }

// Same shape the API validates with on POST /auth/forgot-password — kept in
// sync so "well-formed enough to submit" means the same thing on both sides.
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
function isValidEmail(value) {
  return EMAIL_RE.test(String(value ?? '').trim())
}

export function LoginScreen({ returnTo = '/app' }) {
  const navigate = useNavigate()
  const destination = normalizeAuthReturnPath(returnTo)
  const { session, loading: authLoading } = useAuth()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const [forgotOpen, setForgotOpen] = useState(false)
  const [forgotEmail, setForgotEmail] = useState('')
  // 'form' | 'sending' | 'sent' | 'error' — 'error' is only for a real
  // request failure (server unreachable), never for "email doesn't exist":
  // that must stay indistinguishable from success so the endpoint can't be
  // used to enumerate accounts.
  const [forgotPhase, setForgotPhase] = useState('form')
  const [forgotError, setForgotError] = useState('')
  const isDark = useThemeStore((s) => s.isDark)
  const logo = isDark ? '/runly/runly-logo-dark.png' : '/runly/runly-logo-light.png'

  useEffect(() => {
    let mounted = true
    runly.instance.status()
      .then((data) => {
        if (!mounted) return
        if (!data?.initialized) {
          navigate('/app/setup', { replace: true })
        }
      })
      .catch(() => {})
    return () => {
      mounted = false
    }
  }, [navigate])

  useEffect(() => {
    if (authLoading) return
    if (session) {
      navigate(destination, { replace: true })
    }
  }, [authLoading, destination, navigate, session])

  async function handleSubmit(e) {
    e.preventDefault()
    if (!isValidEmail(email) || !password) return
    setError('')
    setLoading(true)
    try {
      const { error: authError } = await supabase.auth.signInWithPassword({ email, password })
      if (authError) {
        if (authError.message.includes('Email not confirmed')) {
          setError('Tu cuenta no ha sido confirmada. Contacta al administrador.')
        } else {
          setError('Credenciales incorrectas. Verifica tu correo y contraseña.')
        }
        return
      }
      navigate(destination, { replace: true })
    } catch {
      setError('Sin conexión con el servidor. Intenta de nuevo.')
    } finally {
      setLoading(false)
    }
  }

  async function handleForgotSubmit(e) {
    e.preventDefault()
    if (!isValidEmail(forgotEmail)) return
    setForgotPhase('sending')
    setForgotError('')
    try {
      await runly.auth.forgotPassword(forgotEmail)
      setForgotPhase('sent')
    } catch (err) {
      // A 400 here is real (malformed email) — show it inline. Anything else
      // (network down, unreachable API) gets a generic retry state; the
      // endpoint itself never reveals whether the address has an account.
      if (err?.status === 400) {
        setForgotError(err.message || 'Ingresa un correo válido.')
        setForgotPhase('form')
      } else {
        setForgotPhase('error')
      }
    }
  }

  function closeForgotDialog() {
    setForgotOpen(false)
    setForgotError('')
    // Reset after the close animation finishes so the form doesn't visibly
    // flash back to its initial state while the dialog is still fading out.
    setTimeout(() => setForgotPhase('form'), 200)
  }

  async function handleChangeServer() {
    await supabase.auth.signOut().catch(() => {})
    await clearServerUrl().catch(() => {})
    window.location.reload()
  }

  return (
    <div className="relative h-dvh overflow-hidden bg-background text-foreground">
      <AuthAtmosphere />

      {/* Caps how wide the layout grows on ultra-wide monitors — past this
          point extra space becomes side margins instead of stretching the
          hero column and pushing the form card further from it. */}
      <div className="relative h-dvh max-w-350 mx-auto lg:grid lg:grid-cols-[minmax(0,1fr)_minmax(0,480px)]">
        {/* Hero — desktop only; matches the setup wizard's atmosphere so both
            auth-adjacent screens read as one product. Never shows a specific
            company's branding: this screen is shared across every company on
            the instance, before one is picked/activated. */}
        <section className="hidden lg:flex relative z-10 flex-col justify-between gap-10 px-13 py-12">
          <img
            src={logo}
            alt="Runly"
            className="h-7.5 w-auto object-contain"
            draggable={false}
          />

          <div className="flex flex-col gap-8 max-w-md">
            <div className="flex flex-col gap-4">
              <h1 className="text-[clamp(2rem,3.6vw,3rem)] font-bold leading-[1.08] tracking-tight text-foreground text-pretty">
                Bienvenido de vuelta a Runly.
              </h1>
              <p className="text-[15px] leading-relaxed text-muted-foreground max-w-[36ch]">
                Ingresa para continuar donde lo dejaste.
              </p>
            </div>

            <ul className="flex flex-col gap-3" role="list">
              {SIDEBAR_FEATURES.map(({ icon: Icon, label }) => (
                <li
                  key={label}
                  className="flex items-center gap-3.5 rounded-2xl px-4 py-3.5 glass"
                >
                  <span
                    className="shrink-0 w-8 h-8 rounded-md grid place-items-center text-(--brand-primary)"
                    style={{
                      background:
                        'linear-gradient(140deg,rgba(253,96,22,.24),rgba(249,162,27,.10))',
                      border: '1px solid rgba(253,96,22,.32)',
                    }}
                  >
                    <Icon size={15} aria-hidden="true" />
                  </span>
                  <span className="text-sm font-medium text-foreground">{label}</span>
                </li>
              ))}
            </ul>
          </div>

          <div className="flex items-center justify-between text-[11px] uppercase tracking-[0.14em] text-muted-foreground">
            <span>Runly ERP · {RUNLY_EDITION_NAME}</span>
            <span>v0.1.0</span>
          </div>
        </section>

        {/* Form panel */}
        <section className="relative z-10 h-dvh box-border flex px-4 py-4 sm:px-8 sm:py-8 lg:px-10">
          <div className="relative w-full max-w-md mx-auto my-auto lg:max-w-none lg:my-0 flex flex-col rounded-[26px] glass-shell px-6 py-7 sm:px-9 sm:py-9">
            <div className="flex items-center gap-4 mb-7">
              <img
                src={logo}
                alt="Runly"
                className="h-6 w-auto object-contain lg:hidden"
                draggable={false}
              />
              <div className="ml-auto">
                <ThemeToggle />
              </div>
            </div>

            <div className="flex flex-col gap-1.5 mb-7">
              <p className="text-[11px] font-semibold uppercase tracking-widest text-muted-foreground">
                Runly ERP
              </p>
              <h2 className="text-2xl font-bold tracking-tight text-foreground">
                Bienvenido de nuevo
              </h2>
              <p className="text-sm text-muted-foreground leading-relaxed">
                Ingresa para continuar donde lo dejaste.
              </p>
            </div>

            <form onSubmit={handleSubmit} className="flex flex-col gap-4" noValidate>
              <TextField
                id="email"
                icon={Mail}
                label="Correo electrónico"
                type="email"
                autoComplete="username"
                value={email}
                onChange={e => setEmail(e.target.value)}
                placeholder="tu@empresa.com"
                required
              />
              <PasswordField
                id="password"
                icon={Lock}
                label="Contraseña"
                autoComplete="current-password"
                value={password}
                onChange={e => setPassword(e.target.value)}
                placeholder="••••••••"
              />

              {error && (
                <p role="alert" className="text-sm text-destructive">
                  {error}
                </p>
              )}

              <Button
                type="submit"
                variant="gradient"
                style={CTA_GRADIENT}
                className="w-full justify-center"
                disabled={loading || !isValidEmail(email) || !password}
                aria-busy={loading}
              >
                {loading ? 'Verificando credenciales...' : 'Acceder al sistema'}
                {!loading && <ArrowRight size={15} />}
              </Button>
            </form>

            <div className="text-center space-y-2 mt-6">
              <button
                type="button"
                onClick={() => {
                  setForgotEmail(email)
                  setForgotOpen(true)
                }}
                className="text-sm text-muted-foreground hover:text-foreground transition-colors duration-150 cursor-pointer"
              >
                ¿Olvidaste tu contraseña?
              </button>
              {isTauriRuntime() ? (
                <button
                  type="button"
                  onClick={handleChangeServer}
                  className="text-sm text-(--brand-primary) hover:text-(--brand-primary-hover) transition-colors duration-150 cursor-pointer"
                >
                  Cambiar servidor
                </button>
              ) : null}
            </div>
          </div>
        </section>
      </div>

      <Dialog open={forgotOpen} onOpenChange={(open) => (open ? setForgotOpen(true) : closeForgotDialog())}>
        <DialogContent size="sm">
          {forgotPhase === 'sent' ? (
            <div className="flex flex-col items-center gap-3 py-4 text-center">
              <div className="grid place-items-center h-12 w-12 rounded-full bg-emerald-500/10 text-emerald-500 animate-in zoom-in-50 duration-300">
                <CheckCircle2 size={26} />
              </div>
              <DialogTitle>Enlace enviado</DialogTitle>
              <DialogDescription>
                Si el correo tiene una cuenta, enviamos un enlace para restablecer la contraseña. Revisa tu bandeja de entrada (y spam).
              </DialogDescription>
              <Button type="button" variant="outline" className="mt-2 w-full justify-center" onClick={closeForgotDialog}>
                Entendido
              </Button>
            </div>
          ) : forgotPhase === 'error' ? (
            <div className="flex flex-col items-center gap-3 py-4 text-center">
              <div className="grid place-items-center h-12 w-12 rounded-full bg-destructive/10 text-destructive animate-in zoom-in-50 duration-300">
                <AlertCircle size={26} />
              </div>
              <DialogTitle>No se pudo enviar</DialogTitle>
              <DialogDescription>
                No pudimos conectar con el servidor. Verifica tu conexión e intenta de nuevo.
              </DialogDescription>
              <Button type="button" variant="outline" className="mt-2 w-full justify-center" onClick={() => setForgotPhase('form')}>
                Reintentar
              </Button>
            </div>
          ) : (
            <>
              <DialogHeader>
                <DialogTitle>Restablecer contraseña</DialogTitle>
                <DialogDescription>
                  Ingresa tu correo y te enviaremos un enlace para elegir una nueva contraseña.
                </DialogDescription>
              </DialogHeader>
              <form onSubmit={handleForgotSubmit} className="flex flex-col gap-3 pt-1">
                <TextField
                  id="forgot-email"
                  icon={Mail}
                  label="Correo electrónico"
                  type="email"
                  autoComplete="username"
                  value={forgotEmail}
                  onChange={e => setForgotEmail(e.target.value)}
                  placeholder="tu@empresa.com"
                  required
                  autoFocus
                />
                {forgotError && (
                  <p role="alert" className="text-sm text-destructive">{forgotError}</p>
                )}
                <Button
                  type="submit"
                  variant="gradient"
                  style={CTA_GRADIENT}
                  className="w-full justify-center"
                  disabled={forgotPhase === 'sending' || !isValidEmail(forgotEmail)}
                  aria-busy={forgotPhase === 'sending'}
                >
                  {forgotPhase === 'sending' ? 'Enviando...' : 'Enviar enlace de restablecimiento'}
                </Button>
              </form>
            </>
          )}
        </DialogContent>
      </Dialog>
    </div>
  )
}
