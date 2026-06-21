import { useState, useContext, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { AuthContext } from '../context/AuthContext'

export default function Login() {
  const navigate = useNavigate()
  const { login, user, loading: authLoading } = useContext(AuthContext)

  useEffect(() => { document.title = 'Login | Testurai' }, [])

  useEffect(() => {
    if (!authLoading && user) navigate('/dashboard', { replace: true })
  }, [user, authLoading, navigate])

  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState('')

  async function handleSubmit(e) {
    e.preventDefault()
    if (!email || !password) return
    setSubmitting(true)
    setError('')
    try {
      await login(email, password)
      navigate('/dashboard')
    } catch (e) {
      setError(e.response?.data?.error || 'Login failed. Check your credentials.')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div style={{
      minHeight: '100vh',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      background: 'var(--bg)',
    }}>
      <div className="card fade-in" style={{ width: 400, padding: 40 }}>
        <div style={{ textAlign: 'center', marginBottom: 32 }}>
          <div style={{ fontSize: 44, marginBottom: 12 }}>✨</div>
          <h1 style={{ fontSize: 22, fontWeight: 700, marginBottom: 4 }}>Testurai</h1>
          <div style={{ fontSize: 13, color: 'var(--text-muted)' }}>Sign in to continue</div>
        </div>

        <form onSubmit={handleSubmit}>
          <div className="form-group">
            <label className="form-label">Email</label>
            <input
              type="email"
              className="form-input"
              value={email}
              onChange={e => setEmail(e.target.value)}
              placeholder="you@company.com"
              autoComplete="email"
              required
            />
          </div>

          <div className="form-group" style={{ marginBottom: 24 }}>
            <label className="form-label">Password</label>
            <input
              type="password"
              className="form-input"
              value={password}
              onChange={e => setPassword(e.target.value)}
              placeholder="••••••••"
              autoComplete="current-password"
              required
            />
          </div>

          {error && (
            <div style={{
              padding: '10px 14px',
              borderRadius: 'var(--radius)',
              background: 'var(--red-bg)',
              border: '1px solid var(--red)',
              color: 'var(--red)',
              fontSize: 13,
              marginBottom: 16,
            }}>
              ⚠ {error}
            </div>
          )}

          <button
            type="submit"
            className="btn btn-primary btn-lg"
            disabled={submitting}
            style={{ width: '100%' }}
          >
            {submitting
              ? <span className="spinner" style={{ width: 16, height: 16, borderWidth: 2 }} />
              : 'Sign In'}
          </button>
        </form>
      </div>
    </div>
  )
}
