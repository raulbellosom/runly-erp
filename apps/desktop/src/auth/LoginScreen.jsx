import { useState } from 'react'
import { useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { Server, Layers, Building2, Mail, Lock, ArrowRight } from 'lucide-react'
import { supabase } from '../lib/supabase'
import { TextField, PasswordField, Button, AuthAtmosphere } from '@runly/ui'
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

export function LoginScreen({ returnTo = '/app' }) {
  const navigate = useNavigate()
  const destination = normalizeAuthReturnPath(returnTo)
  const { session, loading: authLoading } = useAuth()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const [showForgotForm, setShowForgotForm] = useState(false)
  const [forgotEmail, setForgotEmail] = useState('')
  const [forgotStatus, setForgotStatus] = useState('')
  const [forgotLoading, setForgotLoading] = useState(false)
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
    setError('')
    setShowForgotForm(false)
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
    if (!forgotEmail) return
    setForgotLoading(true)
    setForgotStatus('')
    try {
      await runly.auth.forgotPassword(forgotEmail)
      setForgotStatus('Si el correo existe, enviamos un enlace para restablecer la contraseña.')
    } catch {
      setForgotStatus('Si el correo existe, enviamos un enlace para restablecer la contraseña.')
    } finally {
      setForgotLoading(false)
    }
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
                disabled={loading || !email || !password}
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
                  setForgotStatus('')
                  setShowForgotForm(v => !v)
                }}
                className="text-sm text-muted-foreground hover:text-foreground transition-colors duration-150 cursor-pointer"
              >
                ¿Olvidaste tu contraseña?
              </button>
              {showForgotForm && (
                <form onSubmit={handleForgotSubmit} className="flex flex-col gap-2 text-left">
                  <TextField
                    id="forgot-email"
                    icon={Mail}
                    type="email"
                    autoComplete="username"
                    value={forgotEmail}
                    onChange={e => setForgotEmail(e.target.value)}
                    placeholder="tu@empresa.com"
                    required
                  />
                  <Button
                    type="submit"
                    variant="outline"
                    className="w-full justify-center"
                    disabled={forgotLoading || !forgotEmail}
                    aria-busy={forgotLoading}
                  >
                    {forgotLoading ? 'Enviando...' : 'Enviar enlace de restablecimiento'}
                  </Button>
                  {forgotStatus && (
                    <p className="text-xs text-muted-foreground text-center">{forgotStatus}</p>
                  )}
                </form>
              )}
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
    </div>
  )
}
