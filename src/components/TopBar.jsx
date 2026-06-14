import { useState, useEffect, useContext } from 'react'
import { useNavigate } from 'react-router-dom'
import { AuthContext } from '../context/AuthContext'

const ROLE_COLORS = {
  admin:     { bg: 'var(--red-bg,rgba(239,68,68,0.12))', color: 'var(--red,#ef4444)' },
  developer: { bg: 'var(--cyan-dim)',                     color: 'var(--cyan)' },
  normal:    { bg: 'var(--bg-card-2)',                    color: 'var(--text-muted)' },
}

export default function TopBar() {
  const { user, logout } = useContext(AuthContext)
  const navigate = useNavigate()

  const [theme, setTheme] = useState(() => localStorage.getItem('tm_theme') || 'dark')

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme)
    localStorage.setItem('tm_theme', theme)
  }, [theme])

  if (!user) return null

  function handleLogout() {
    logout()
    navigate('/login')
  }

  const roleStyle = ROLE_COLORS[user.role] || ROLE_COLORS.normal
  const displayName = user.full_name || user.email

  return (
    <div className="top-bar">
      <div className="top-bar-user">
        <button
          className="theme-toggle-btn"
          onClick={() => setTheme(t => t === 'dark' ? 'light' : 'dark')}
          title={theme === 'dark' ? 'Switch to Light Mode' : 'Switch to Dark Mode'}
          style={{ marginRight: 4 }}
        >
          {theme === 'dark' ? '☀️' : '🌙'}
        </button>

        <div className="top-bar-divider" />

        <div className="top-bar-avatar">
          {(displayName[0] || '?').toUpperCase()}
        </div>
        <div className="top-bar-info">
          <span className="top-bar-name" title={user.email}>{displayName}</span>
          <span
            className="top-bar-role"
            style={{ background: roleStyle.bg, color: roleStyle.color }}
          >
            {user.role}
          </span>
        </div>
        <button className="top-bar-signout" onClick={handleLogout} title="Sign out">
          Sign out
        </button>
      </div>
    </div>
  )
}
