import { useState, useEffect, useContext } from 'react'
import axios from 'axios'
import { AuthContext } from '../context/AuthContext'

const ROLES = ['normal', 'developer', 'admin']

const ROLE_BADGE = {
  normal:    'badge-gray',
  developer: 'badge-blue',
  admin:     'badge-cyan',
}

export default function UserManagement() {
  const { user: currentUser } = useContext(AuthContext)
  const [users, setUsers] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [toast, setToast] = useState(null)

  const [showCreate, setShowCreate] = useState(false)
  const [newEmail, setNewEmail] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [newRole, setNewRole] = useState('normal')
  const [newName, setNewName] = useState('')
  const [creating, setCreating] = useState(false)
  const [createError, setCreateError] = useState('')

  function showToast(msg, type = 'info') {
    setToast({ msg, type })
    setTimeout(() => setToast(null), 3500)
  }

  async function fetchUsers() {
    setLoading(true)
    setError('')
    try {
      const r = await axios.get('/api/users')
      setUsers(r.data.data || [])
    } catch (e) {
      setError(e.response?.data?.error || 'Failed to load users')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { document.title = 'User Management | TestMaster' }, [])
  useEffect(() => { fetchUsers() }, [])

  async function handleRoleChange(userId, role) {
    try {
      await axios.put(`/api/users/${userId}`, { role })
      setUsers(prev => prev.map(u => u.id === userId ? { ...u, role } : u))
      showToast('Role updated', 'success')
    } catch (e) {
      showToast(e.response?.data?.error || 'Failed to update role', 'error')
    }
  }

  async function handleDelete(userId, email) {
    if (!confirm(`Delete user ${email}? This cannot be undone.`)) return
    try {
      await axios.delete(`/api/users/${userId}`)
      setUsers(prev => prev.filter(u => u.id !== userId))
      showToast('User deleted', 'success')
    } catch (e) {
      showToast(e.response?.data?.error || 'Delete failed', 'error')
    }
  }

  async function handleCreate(e) {
    e.preventDefault()
    setCreating(true)
    setCreateError('')
    try {
      const r = await axios.post('/api/users', {
        email: newEmail,
        password: newPassword,
        role: newRole,
        full_name: newName,
      })
      setUsers(prev => [...prev, r.data.data])
      setShowCreate(false)
      setNewEmail(''); setNewPassword(''); setNewRole('normal'); setNewName('')
      showToast('User created successfully', 'success')
    } catch (e) {
      setCreateError(e.response?.data?.error || 'User creation failed')
    } finally {
      setCreating(false)
    }
  }

  return (
    <div className="fade-in">
      <div className="page-header">
        <div>
          <h1 className="page-title">User Management</h1>
          <p className="page-subtitle">Manage user accounts and access levels</p>
        </div>
        <button className="btn btn-primary" onClick={() => setShowCreate(true)}>
          + Add User
        </button>
      </div>

      {error && (
        <div className="card" style={{ border: '1px solid var(--red)', background: 'var(--red-bg)', color: 'var(--red)', marginBottom: 16 }}>
          ⚠ {error}
        </div>
      )}

      {loading ? (
        <div style={{ display: 'flex', justifyContent: 'center', padding: 60 }}>
          <span className="spinner" style={{ width: 32, height: 32, borderWidth: 3 }} />
        </div>
      ) : (
        <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr style={{ borderBottom: '1px solid var(--border)' }}>
                {['Name', 'Email', 'Role', 'Joined', 'Actions'].map(h => (
                  <th key={h} style={{
                    padding: '12px 16px', textAlign: 'left',
                    fontSize: 11, fontWeight: 600, color: 'var(--text-muted)',
                    textTransform: 'uppercase', letterSpacing: '0.5px',
                  }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {users.map(u => (
                <tr key={u.id} style={{ borderBottom: '1px solid var(--border)' }}>
                  <td style={{ padding: '12px 16px', fontSize: 14, fontWeight: 500 }}>
                    {u.full_name || '—'}
                    {u.id === currentUser?.id && (
                      <span className="badge badge-cyan" style={{ marginLeft: 8, fontSize: 10 }}>You</span>
                    )}
                  </td>
                  <td style={{ padding: '12px 16px', fontSize: 13, color: 'var(--text-muted)' }}>{u.email}</td>
                  <td style={{ padding: '12px 16px' }}>
                    {u.id === currentUser?.id ? (
                      <span className={`badge ${ROLE_BADGE[u.role] || 'badge-gray'}`}>{u.role}</span>
                    ) : (
                      <select
                        className="form-select"
                        value={u.role}
                        onChange={e => handleRoleChange(u.id, e.target.value)}
                        style={{ fontSize: 12, padding: '4px 8px', width: 'auto', minWidth: 110 }}
                      >
                        {ROLES.map(r => <option key={r} value={r}>{r}</option>)}
                      </select>
                    )}
                  </td>
                  <td style={{ padding: '12px 16px', fontSize: 12, color: 'var(--text-muted)' }}>
                    {u.created_at ? new Date(u.created_at).toLocaleDateString() : '—'}
                  </td>
                  <td style={{ padding: '12px 16px' }}>
                    {u.id !== currentUser?.id && (
                      <button
                        className="btn btn-outline"
                        style={{ fontSize: 11, padding: '4px 10px', borderColor: 'var(--red)', color: 'var(--red)' }}
                        onClick={() => handleDelete(u.id, u.email)}
                      >
                        Delete
                      </button>
                    )}
                  </td>
                </tr>
              ))}
              {users.length === 0 && (
                <tr>
                  <td colSpan={5} style={{ padding: 40, textAlign: 'center', color: 'var(--text-muted)', fontSize: 14 }}>
                    No users found
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}

      {/* Role legend */}
      <div className="card" style={{ marginTop: 16, padding: '12px 16px' }}>
        <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-muted)', marginBottom: 8, textTransform: 'uppercase', letterSpacing: '0.5px' }}>
          Access Levels
        </div>
        <div style={{ display: 'flex', gap: 20, fontSize: 12, color: 'var(--text-muted)' }}>
          <div><span className="badge badge-gray" style={{ marginRight: 6 }}>normal</span>Read-only — view plans, history, test cases</div>
          <div><span className="badge badge-blue" style={{ marginRight: 6 }}>developer</span>Read/write — generate plans &amp; scripts, edit test cases</div>
          <div><span className="badge badge-cyan" style={{ marginRight: 6 }}>admin</span>Full access — settings, user management, delete plans</div>
        </div>
      </div>

      {/* Create User Modal */}
      {showCreate && (
        <div
          style={{
            position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.55)',
            display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000,
          }}
          onClick={e => e.target === e.currentTarget && setShowCreate(false)}
        >
          <div className="card fade-in" style={{ width: 440, padding: 32 }}>
            <div style={{ fontWeight: 700, fontSize: 16, marginBottom: 24 }}>Add New User</div>
            <form onSubmit={handleCreate}>
              <div className="form-group">
                <label className="form-label">Full Name</label>
                <input
                  type="text"
                  className="form-input"
                  value={newName}
                  onChange={e => setNewName(e.target.value)}
                  placeholder="Jane Smith"
                />
              </div>
              <div className="form-group">
                <label className="form-label">Email *</label>
                <input
                  type="email"
                  className="form-input"
                  value={newEmail}
                  onChange={e => setNewEmail(e.target.value)}
                  placeholder="user@company.com"
                  required
                />
              </div>
              <div className="form-group">
                <label className="form-label">Password *</label>
                <input
                  type="password"
                  className="form-input"
                  value={newPassword}
                  onChange={e => setNewPassword(e.target.value)}
                  placeholder="Min 8 characters"
                  required
                  minLength={8}
                />
              </div>
              <div className="form-group" style={{ marginBottom: 20 }}>
                <label className="form-label">Role</label>
                <select className="form-select" value={newRole} onChange={e => setNewRole(e.target.value)}>
                  {ROLES.map(r => <option key={r} value={r}>{r}</option>)}
                </select>
              </div>

              {createError && (
                <div style={{
                  padding: '10px 14px',
                  borderRadius: 'var(--radius)',
                  background: 'var(--red-bg)',
                  border: '1px solid var(--red)',
                  color: 'var(--red)',
                  fontSize: 13,
                  marginBottom: 16,
                }}>
                  ⚠ {createError}
                </div>
              )}

              <div style={{ display: 'flex', gap: 10 }}>
                <button
                  type="button"
                  className="btn btn-outline"
                  style={{ flex: 1 }}
                  onClick={() => { setShowCreate(false); setCreateError('') }}
                >
                  Cancel
                </button>
                <button type="submit" className="btn btn-primary" style={{ flex: 1 }} disabled={creating}>
                  {creating
                    ? <span className="spinner" style={{ width: 14, height: 14, borderWidth: 2 }} />
                    : 'Create User'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {toast && (
        <div className={`toast toast-${toast.type}`}>
          {toast.type === 'success' ? '✅' : '❌'} {toast.msg}
        </div>
      )}
    </div>
  )
}
