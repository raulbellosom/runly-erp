import { useEffect, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { Lock, ArrowRight } from 'lucide-react'
import { supabase } from '../lib/supabase'
import { PasswordField, Button, AuthAtmosphere } from '@runly/ui'
import { useThemeStore } from '../stores/theme'
import { ThemeToggle } from '../components/ThemeToggle'

export function ResetPasswordScreen() {
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const isDark = useThemeStore((s) => s.isDark)
  const logo = isDark ? '/runly/runly-logo-dark.png' : '/runly/runly-logo-light.png'

  const [verifying, setVerifying] = useState(true)
  const [linkError, setLinkError] = useState('')
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    let mounted = true
    const tokenHash = searchParams.get('token_hash')
    const type = searchParams.get('type') || 'recovery'

    if (!tokenHash) {
      setLinkError('El enlace no es válido o ya expiró. Solicita uno nuevo desde la pantalla de acceso.')
      setVerifying(false)
      return undefined
    }

    supabase.auth.verifyOtp({ token_hash: tokenHash, type }).then(({ error: verifyError }) => {
      if (!mounted) return
      if (verifyError) {
        setLinkError('El enlace no es válido o ya expiró. Solicita uno nuevo desde la pantalla de acceso.')
      }
      setVerifying(false)
    })

    return () => {
      mounted = false
    }
  }, [searchParams])

  async function handleSubmit(e) {
    e.preventDefault()
    setError('')
    if (password.length < 8) {
      setError('La contraseña debe tener al menos 8 caracteres.')
      return
    }
    if (password !== confirmPassword) {
      setError('La confirmación no coincide.')
      return
    }
    setLoading(true)
    try {
      const { error: updateError } = await supabase.auth.updateUser({ password })
      if (updateError) {
        setError('No se pudo actualizar la contraseña. Intenta de nuevo.')
        return
      }
      navigate('/app', { replace: true })
    } catch {
      setError('Sin conexión con el servidor. Intenta de nuevo.')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="relative h-dvh overflow-hidden bg-background text-foreground">
      <AuthAtmosphere />
      <div className="relative h-dvh flex items-center justify-center px-4">
        <div className="relative w-full max-w-md flex flex-col rounded-[26px] glass-shell px-6 py-7 sm:px-9 sm:py-9">
          <div className="flex items-center gap-4 mb-7">
            <img src={logo} alt="Runly" className="h-6 w-auto object-contain" draggable={false} />
            <div className="ml-auto">
              <ThemeToggle />
            </div>
          </div>

          <div className="flex flex-col gap-1.5 mb-7">
            <p className="text-[11px] font-semibold uppercase tracking-widest text-muted-foreground">
              Runly ERP
            </p>
            <h2 className="text-2xl font-bold tracking-tight text-foreground">
              Restablecer contraseña
            </h2>
            <p className="text-sm text-muted-foreground leading-relaxed">
              Elige una nueva contraseña para tu cuenta.
            </p>
          </div>

          {verifying ? (
            <p className="text-sm text-muted-foreground">Verificando enlace...</p>
          ) : linkError ? (
            <div className="flex flex-col gap-3">
              <p role="alert" className="text-sm text-destructive">{linkError}</p>
              <Button type="button" variant="outline" onClick={() => navigate('/app/login')}>
                Volver al inicio de sesión
              </Button>
            </div>
          ) : (
            <form onSubmit={handleSubmit} className="flex flex-col gap-4" noValidate>
              <PasswordField
                id="password"
                icon={Lock}
                label="Nueva contraseña"
                autoComplete="new-password"
                showStrength
                value={password}
                onChange={e => setPassword(e.target.value)}
                placeholder="••••••••"
              />
              <PasswordField
                id="confirmPassword"
                icon={Lock}
                label="Confirmar nueva contraseña"
                autoComplete="new-password"
                value={confirmPassword}
                onChange={e => setConfirmPassword(e.target.value)}
                placeholder="••••••••"
              />

              {error && (
                <p role="alert" className="text-sm text-destructive">{error}</p>
              )}

              <Button
                type="submit"
                variant="gradient"
                className="w-full justify-center"
                disabled={loading || !password || !confirmPassword}
                aria-busy={loading}
              >
                {loading ? 'Guardando...' : 'Guardar nueva contraseña'}
                {!loading && <ArrowRight size={15} />}
              </Button>
            </form>
          )}
        </div>
      </div>
    </div>
  )
}
