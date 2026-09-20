// apps/desktop/src/shell/PublicClientLogin.jsx
import { useState, useEffect } from 'react'
import { useNavigate, Link } from 'react-router-dom'
import { supabase } from '../lib/supabase.js'
import { getApiUrl } from '../lib/runtimeConfig.js'
import { useQuery } from '@tanstack/react-query'
import { PasswordField } from '@runly/ui'

function useSiteName() {
  return useQuery({
    queryKey: ['public-client-site-name'],
    queryFn: async () => {
      try {
        const res = await fetch(`${getApiUrl()}/public/website/resolve?path=/`)
        if (!res.ok) return null
        return res.json()
      } catch {
        return null
      }
    },
    staleTime: 300_000,
    retry: 1,
  })
}

async function checkRoleAndRedirect(token, navigate) {
  try {
    const res = await fetch(`${getApiUrl()}/public/website/auth-check`, {
      headers: { Authorization: `Bearer ${token}` },
    })
    if (!res.ok) {
      navigate('/', { replace: true })
      return
    }
    const data = await res.json()
    navigate(data.canAccessErp ? '/app' : '/', { replace: true })
  } catch {
    navigate('/', { replace: true })
  }
}

export function PublicClientLogin() {
  const navigate = useNavigate()
  const [email, setEmail]       = useState('')
  const [password, setPassword] = useState('')
  const [loading, setLoading]   = useState(false)
  const [error, setError]       = useState(null)

  const siteQuery = useSiteName()
  const siteName = siteQuery.data?.site?.name ?? null

  // Redirect if already logged in
  useEffect(() => {
    let active = true
    supabase.auth.getSession().then(({ data }) => {
      if (!active) return
      if (data?.session?.access_token) {
        checkRoleAndRedirect(data.session.access_token, navigate)
      }
    })
    return () => { active = false }
  }, [navigate])

  async function handleSubmit(e) {
    e.preventDefault()
    setError(null)
    setLoading(true)
    try {
      const { data, error: signInError } = await supabase.auth.signInWithPassword({ email, password })
      if (signInError) {
        const msg = signInError.message?.toLowerCase() ?? ''
        if (msg.includes('invalid') || signInError.status === 400) {
          setError('Correo o contrasena incorrectos. Verifica tus datos.')
        } else {
          setError('Ocurrio un error. Intenta de nuevo.')
        }
        return
      }
      if (!data?.session?.access_token) {
        setError('No se pudo iniciar sesion. Intenta de nuevo.')
        return
      }
      await checkRoleAndRedirect(data.session.access_token, navigate)
    } catch {
      setError('Ocurrio un error inesperado. Intenta de nuevo.')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="min-h-screen flex flex-col items-center justify-center bg-[hsl(var(--background))] px-6">
      <div className="w-full max-w-sm space-y-8">
        <div className="text-center space-y-2">
          {siteName && (
            <p className="text-2xl font-bold text-[hsl(var(--foreground))] tracking-tight">
              {siteName}
            </p>
          )}
          <h1 className="text-xl font-semibold text-[hsl(var(--foreground))]">
            Iniciar sesion
          </h1>
          <p className="text-sm text-[hsl(var(--muted-foreground))]">
            Accede a tu cuenta para continuar.
          </p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-1.5">
            <label htmlFor="login-email" className="text-sm font-medium text-[hsl(var(--foreground))]">
              Correo electronico
            </label>
            <input
              id="login-email"
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="tu@correo.com"
              className="w-full px-3.5 py-2.5 rounded-lg border border-[hsl(var(--border))] bg-[hsl(var(--background))] text-[hsl(var(--foreground))] text-sm outline-none focus:ring-2 focus:ring-[hsl(var(--ring))] placeholder:text-[hsl(var(--muted-foreground))]"
            />
          </div>

          <PasswordField
            id="login-password"
            label="Contraseña"
            autoComplete="current-password"
            required
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />

          {error && (
            <p className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-3.5 py-2.5">
              {error}
            </p>
          )}

          <button
            type="submit"
            disabled={loading}
            className="w-full py-2.5 rounded-lg bg-[hsl(var(--primary))] text-[hsl(var(--primary-foreground))] text-sm font-semibold hover:opacity-90 transition-opacity disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {loading ? 'Ingresando...' : 'Entrar'}
          </button>
        </form>

        <div className="text-center">
          <Link
            to="/"
            className="text-sm text-[hsl(var(--muted-foreground))] hover:text-[hsl(var(--foreground))] transition-colors"
          >
            &larr; Volver al sitio
          </Link>
        </div>
      </div>
    </div>
  )
}
