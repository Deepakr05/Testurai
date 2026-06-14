import { useState, useEffect, useRef, useContext } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import axios from 'axios'
import { ProviderContext } from '../context/ProviderContext'
import { AuthContext } from '../context/AuthContext'

const NAV = [
  { path: '/dashboard',     label: 'Dashboard',    icon: '▤' },
  { path: '/generate',      label: 'Test Plan',    icon: '⚡' },
  { path: '/test-cases',    label: 'Test Cases',   icon: '📋' },
  { path: '/test-generator',label: 'Test Scripts', icon: '🤖' },
  { path: '/history',       label: 'History',      icon: '🕐' },
  { path: '/settings',      label: 'Settings',     icon: '⚙',  minRole: 'developer' },
  { path: '/users',         label: 'Users',        icon: '👥', minRole: 'admin' },
]

const PROVIDER_META = {
  openai:    { name: 'OpenAI',    icon: '◈', color: '#10A37F' },
  anthropic: { name: 'Anthropic', icon: '◆', color: '#CC7832' },
  google:    { name: 'Google',    icon: '●', color: '#4285F4' },
  groq:      { name: 'Groq',      icon: '◎', color: '#F55036' },
  local_llm: { name: 'Local LLM', icon: '💻', color: '#8B949E' },
}

const ROLE_LEVELS = { normal: 0, developer: 1, admin: 2 }

export default function Sidebar() {
  const location = useLocation()
  const navigate = useNavigate()
  const { activeProvider, setActiveProvider } = useContext(ProviderContext)
  const { user, logout, hasRole } = useContext(AuthContext)
  const [providers, setProviders] = useState([])
  const [open, setOpen] = useState(false)
  const [switching, setSwitching] = useState(false)
  const [error, setError] = useState('')
  const dropdownRef = useRef(null)

  const [theme, setTheme] = useState(() => localStorage.getItem('tm_theme') || 'dark')

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme)
    localStorage.setItem('tm_theme', theme)
  }, [theme])

  function toggleTheme() {
    setTheme(prev => prev === 'dark' ? 'light' : 'dark')
  }

  useEffect(() => {
    axios.get('/api/settings/providers')
      .then(r => {
        setProviders(r.data.data.providers || [])
        if (!activeProvider) setActiveProvider(r.data.data.active_provider || '')
      })
      .catch(() => {})
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    function handleClick(e) {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target)) {
        setOpen(false)
      }
    }
    document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [])

  async function switchProvider(providerId) {
    if (providerId === activeProvider) { setOpen(false); return }
    setSwitching(true)
    setError('')
    try {
      const r = await axios.patch('/api/settings/active-provider', { provider: providerId })
      const confirmed = r.data.data.active_provider
      setActiveProvider(confirmed)
      setProviders(prev => prev.map(p => ({ ...p, active: p.id === confirmed })))
      setOpen(false)
    } catch (e) {
      setError(e.response?.data?.error || 'Switch failed')
      setTimeout(() => setError(''), 4000)
    } finally {
      setSwitching(false)
    }
  }

  function handleLogout() {
    logout()
    navigate('/login')
  }

  const activeMeta = PROVIDER_META[activeProvider] || {}
  const activeProviderInfo = providers.find(p => p.id === activeProvider)

  const visibleNav = NAV.filter(item => {
    if (!item.minRole) return true
    return (ROLE_LEVELS[user?.role] ?? -1) >= (ROLE_LEVELS[item.minRole] ?? 999)
  })

  return (
    <div className="sidebar fade-in">
      <div className="sidebar-brand">
        <div className="brand-icon">✨</div>
        <div>
          <span className="brand-name">TestMaster</span>
          <div className="brand-tagline">Test Orchestrator</div>
        </div>
      </div>

      <div className="sidebar-nav">
        {visibleNav.map(item => (
          <button
            key={item.path}
            className={`nav-item ${location.pathname === item.path ? 'active' : ''}`}
            onClick={() => navigate(item.path)}
          >
            <span className="nav-icon">{item.icon}</span>
            {item.label}
          </button>
        ))}
      </div>

      {/* LLM Provider selector — visible to developer+ */}
      {hasRole('developer') && (
        <div className="sidebar-model-selector" ref={dropdownRef}>
          <div className="divider" style={{ margin: '0 16px 12px' }} />
          <div className="model-selector-heading">Select LLM Provider</div>
          <div
            className="model-selector-trigger"
            onClick={() => setOpen(!open)}
            role="button"
            tabIndex={0}
          >
            <div className="model-selector-left">
              <span className="model-selector-dot" style={{ background: activeMeta.color || 'var(--text-dim)' }} />
              <div className="model-selector-info">
                <div className="model-selector-name">{activeMeta.name || 'Select Model'}</div>
                <div className="model-selector-model">{activeProviderInfo?.model || '—'}</div>
              </div>
            </div>
            <span className={`model-selector-chevron ${open ? 'open' : ''}`}>▾</span>
          </div>

          {open && (
            <div className="model-dropdown">
              <div className="model-dropdown-header">Switch LLM Provider</div>
              {providers.map(p => {
                const meta = PROVIDER_META[p.id] || {}
                return (
                  <div
                    key={p.id}
                    className={`model-dropdown-item ${p.id === activeProvider ? 'active' : ''} ${!p.has_key && p.id !== 'local_llm' ? 'no-key' : ''}`}
                    onClick={() => switchProvider(p.id)}
                  >
                    <span className="model-dropdown-dot" style={{ background: meta.color || 'var(--text-dim)' }} />
                    <div className="model-dropdown-info">
                      <div className="model-dropdown-name">{meta.name || p.id}</div>
                      <div className="model-dropdown-model">{p.model}</div>
                    </div>
                    {p.id === activeProvider && <span className="model-dropdown-check">✓</span>}
                    {!p.has_key && p.id !== 'local_llm' && (
                      <span className="model-dropdown-nokey" title="No API key configured">🔑</span>
                    )}
                  </div>
                )
              })}
              {switching && (
                <div className="model-dropdown-loading">
                  <span className="spinner" style={{ width: 14, height: 14, borderWidth: 2 }} />
                  Switching...
                </div>
              )}
              {error && <div className="model-dropdown-error">{error}</div>}
            </div>
          )}
        </div>
      )}

      <div className="sidebar-footer">
        {/* Logged-in user info */}
        {user && (
          <div style={{ padding: '0 16px 10px', borderTop: '1px solid var(--border)', paddingTop: 10 }}>
            <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--text)', marginBottom: 2, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {user.full_name || user.email}
            </div>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>{user.role}</span>
              <button
                onClick={handleLogout}
                style={{
                  background: 'none', border: 'none', cursor: 'pointer',
                  fontSize: 11, color: 'var(--text-muted)', padding: '2px 6px',
                  borderRadius: 4,
                }}
                title="Sign out"
              >
                Sign out
              </button>
            </div>
          </div>
        )}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '8px 16px' }}>
          <div className="sidebar-version">TestMaster v1.0</div>
          <button
            className="theme-toggle-btn"
            onClick={toggleTheme}
            title={theme === 'dark' ? 'Switch to Light Mode' : 'Switch to Dark Mode'}
          >
            {theme === 'dark' ? '☀️' : '🌙'}
          </button>
        </div>
      </div>
    </div>
  )
}
