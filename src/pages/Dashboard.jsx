import { useState, useEffect, useContext } from 'react'
import { useNavigate } from 'react-router-dom'
import axios from 'axios'
import { AuthContext } from '../context/AuthContext'

function timeAgo(iso) {
  if (!iso) return ''
  const diff = (Date.now() - new Date(iso)) / 1000
  if (diff < 60)    return 'just now'
  if (diff < 3600)  return `${Math.floor(diff/60)}m ago`
  if (diff < 86400) return `${Math.floor(diff/3600)}h ago`
  return `${Math.floor(diff/86400)}d ago`
}

function statusBadge(status) {
  const map = {
    completed:   'badge-green',
    'in progress': 'badge-blue',
    failed:      'badge-red',
    pending:     'badge-gray',
  }
  return map[(status||'').toLowerCase()] || 'badge-gray'
}

function modelBadge(provider) {
  const map = { openai: 'model-openai', anthropic: 'model-anthropic', google: 'model-google' }
  return map[provider] || 'model-openai'
}

function modelShort(model) {
  if (!model) return '—'
  if (model.includes('gpt-4o')) return 'GPT-4o'
  if (model.includes('gpt-4'))  return 'GPT-4'
  if (model.includes('claude')) return 'Claude'
  if (model.includes('gemini')) return 'Gemini'
  return model.split('-')[0]
}

export default function Dashboard() {
  const navigate = useNavigate()
  const { hasRole } = useContext(AuthContext)
  const [stats, setStats]     = useState(null)
  const [loading, setLoading] = useState(true)
  const [quickId, setQuickId] = useState('')
  const [subTasks, setSubTasks]       = useState(true)
  const [aiSuggestions, setAiSuggestions] = useState(false)

  useEffect(() => { document.title = 'Dashboard | TestMaster' }, [])

  useEffect(() => {
    axios.get('/api/stats')
      .then(r => { setStats(r.data.data); setLoading(false) })
      .catch(() => setLoading(false))
  }, [])

  const handleQuickGenerate = () => {
    if (!quickId.trim()) return
    navigate(`/generate?jira=${quickId.trim()}`)
  }

  return (
    <div className="fade-in">
      <div className="page-header">
        <div>
          <h1 className="page-title">Test Plan Dashboard</h1>
          <p className="page-subtitle">Overview of all generated test plans</p>
        </div>
        <div className="search-bar" style={{ width: 260 }}>
          <span className="search-icon">🔍</span>
          <input placeholder="Search..." onKeyDown={e => { if(e.key==='Enter') navigate(`/history?q=${e.target.value}`) }} />
        </div>
      </div>

      {/* Stats Grid */}
      <div className="stats-grid">
        <div className="stat-card highlight">
          <div className="stat-label">Test Plans Generated</div>
          <div className="stat-value cyan">
            {loading ? <span className="skeleton" style={{display:'block',height:40,width:80}} /> : (stats?.total_plans ?? 0)}
          </div>
          <div className="stat-sub"><span className="stat-dot" />Live tracking</div>
        </div>
        <div className="stat-card">
          <div className="stat-label">Jira Issues Processed</div>
          <div className="stat-value">{loading ? '—' : (stats?.jira_issues_processed ?? 0).toLocaleString()}</div>
          <div className="stat-sub">Jira Issues Processed</div>
        </div>
        <div className="stat-card">
          <div className="stat-label">Avg Generation Time</div>
          <div className="stat-value">{loading ? '—' : `${stats?.avg_generation_time ?? 0}s`}</div>
          <div className="stat-sub">Avg Generation Time</div>
        </div>
        <div className="stat-card">
          <div className="stat-label">Active LLM Model</div>
          <div className="stat-value" style={{fontSize:24}}>{loading ? '—' : modelShort(stats?.active_model)}</div>
          <div className="stat-sub">{stats?.active_provider || 'Not configured'}</div>
        </div>
      </div>

      {/* Main Grid: Table + Quick Generate */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 280px', gap: 20 }}>

        {/* Recent Plans Table */}
        <div className="card">
          <div style={{ overflowX: 'auto' }}>
            <table className="data-table">
              <thead>
                <tr>
                  <th>Jira ID</th>
                  <th>Status</th>
                  <th>Model</th>
                  <th>Provider</th>
                  <th>Date</th>
                </tr>
              </thead>
              <tbody>
                {!loading && (!stats?.recent || stats.recent.length === 0) && (
                  <tr>
                    <td colSpan={5} style={{ textAlign: 'center', color: 'var(--text-muted)', padding: '32px 0' }}>
                      No test plans yet. Generate your first one →
                    </td>
                  </tr>
                )}
                {(stats?.recent || []).map(r => (
                  <tr key={r.id} onClick={() => navigate(`/plan/${r.id}`)}>
                    <td>
                      <span className="badge badge-cyan">{r.jira_id}</span>
                    </td>
                    <td>
                      <span className={`badge badge-dot ${statusBadge(r.status)}`}>
                        {r.status}
                      </span>
                    </td>
                    <td>
                      <span className={`model-badge ${modelBadge(r.llm_provider)}`}>
                        {modelShort(r.llm_model)}
                      </span>
                    </td>
                    <td style={{ color: 'var(--text-muted)', fontSize: 12 }}>{r.llm_provider || '—'}</td>
                    <td style={{ color: 'var(--text-muted)', fontSize: 12 }}>{timeAgo(r.generated_at)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Timeline */}
          {stats?.recent?.length > 0 && (
            <>
              <div className="divider" />
              <div style={{ fontWeight: 600, color: 'var(--cyan)', fontSize: 13, marginBottom: 12 }}>Timeline</div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '6px 24px' }}>
                {stats.recent.slice(0,4).map(r => (
                  <div key={r.id} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12, color: 'var(--text-muted)' }}>
                    <span style={{ width: 7, height: 7, borderRadius: '50%', background: 'var(--green)', flexShrink: 0 }} />
                    {r.jira_id} generated — {timeAgo(r.generated_at)}
                  </div>
                ))}
              </div>
            </>
          )}
        </div>

        {/* Quick Generate Panel */}
        <div className="card" style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          <div style={{ fontWeight: 700, fontSize: 15, marginBottom: 4 }}>Quick Generate</div>

          <div className="input-group">
            <span style={{ color: 'var(--text-dim)' }}>🔎</span>
            <input
              placeholder="Enter, |PROJ-1234"
              value={quickId}
              onChange={e => setQuickId(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && handleQuickGenerate()}
            />
          </div>

          <div>
            <div className="toggle-row">
              <div>
                <div className="toggle-label">Include Sub-tasks</div>
              </div>
              <label className="toggle">
                <input type="checkbox" checked={subTasks} onChange={e => setSubTasks(e.target.checked)} />
                <span className="toggle-slider" />
              </label>
            </div>
            <div className="toggle-row">
              <div>
                <div className="toggle-label">AI-driven Suggestions</div>
              </div>
              <label className="toggle">
                <input type="checkbox" checked={aiSuggestions} onChange={e => setAiSuggestions(e.target.checked)} />
                <span className="toggle-slider" />
              </label>
            </div>
          </div>

          <button
            className="btn btn-primary btn-lg"
            onClick={handleQuickGenerate}
            disabled={!quickId.trim() || !hasRole('developer')}
            title={!hasRole('developer') ? 'Developer account required to generate test plans' : ''}
          >
            ⚡ Generate Test Plan
          </button>

          <button
            className="btn btn-outline"
            style={{ width: '100%', justifyContent: 'center' }}
            onClick={() => navigate('/history')}
          >
            View All History
          </button>
        </div>
      </div>
    </div>
  )
}
