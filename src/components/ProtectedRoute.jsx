import { useContext } from 'react'
import { Navigate } from 'react-router-dom'
import { AuthContext } from '../context/AuthContext'

export default function ProtectedRoute({ children, minRole }) {
  const { user, loading, hasRole } = useContext(AuthContext)

  if (loading) {
    return (
      <div style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        minHeight: '100vh',
        background: 'var(--bg)',
      }}>
        <span className="spinner" style={{ width: 36, height: 36, borderWidth: 3 }} />
      </div>
    )
  }

  if (!user) return <Navigate to="/login" replace />

  if (minRole && !hasRole(minRole)) return <Navigate to="/dashboard" replace />

  return children
}
