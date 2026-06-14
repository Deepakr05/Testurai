import { useState, useEffect, useRef, useContext } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import axios from 'axios'
import { ProviderContext } from '../context/ProviderContext'
import { AuthContext } from '../context/AuthContext'

const FORMATS = ['unit', 'integration', 'e2e', 'security']

const LOAD_STEPS = [
  'Fetching Jira Issue',
  'Analysing requirements...',
  'Drafting test cases',
  'Finalising & syncing',
]

export default function Generate() {
  const navigate = useNavigate()
  const [params] = useSearchParams()
  const { activeProvider } = useContext(ProviderContext)
  const { hasRole } = useContext(AuthContext)
  const readOnly = !hasRole('developer')

  const [jiraId, setJiraId] = useState(params.get('jira') || '')
  const [issue,  setIssue]  = useState(null)
  const [issueLoading, setIssueLoading] = useState(false)
  const [issueError,   setIssueError]   = useState('')


  const [formats,        setFormats]        = useState(['unit','integration','e2e'])
  const [negCases,       setNegCases]       = useState(true)
  const [subTasks,       setSubTasks]       = useState(true)
  const [aiSuggestions,  setAiSuggestions]  = useState(false)
  const [detailLevel,    setDetailLevel]    = useState('standard')

  const [generating, setGenerating] = useState(false)
  const [loadStep,   setLoadStep]   = useState(0)
  const [genError,   setGenError]   = useState('')
  const [toast,      setToast]      = useState(null)
  function showToast(msg, type = 'info') {
    setToast({ msg, type })
    setTimeout(() => setToast(null), 3000)
  }

  const loadInterval = useRef(null)

  // Auto-fetch if jira ID from query param
  useEffect(() => {
    if (params.get('jira')) fetchIssue(params.get('jira'))
  }, [])

  async function fetchIssue(id) {
    const target = (id || jiraId).trim().toUpperCase()
    if (!target) return
    setIssueLoading(true)
    setIssueError('')
    setIssue(null)
    try {
      const r = await axios.get(`/api/jira/issue/${target}`)
      setIssue(r.data.data)
      showToast('Jira issue fetched!', 'success')
    } catch(e) {
      setIssueError(e.response?.data?.error || 'Could not fetch issue. Check your Jira settings.')
      showToast(e.response?.data?.error || 'Fetch failed', 'error')
    } finally {
      setIssueLoading(false)
    }
  }

  function toggleFormat(f) {
    setFormats(prev => prev.includes(f) ? prev.filter(x => x !== f) : [...prev, f])
  }

  async function handleGenerate() {
    if (!issue) return
    setGenerating(true)
    setGenError('')
    setLoadStep(0)

    loadInterval.current = setInterval(() => {
      setLoadStep(prev => Math.min(prev + 1, LOAD_STEPS.length - 1))
    }, 2200)

    try {
      const r = await axios.post('/api/generate', {
        jira_issue_id:          issue.id,
        llm_provider:           activeProvider,
        include_sub_tasks:      subTasks,
        include_negative_cases: negCases,
        detail_level:           detailLevel,
        test_plan_format:       formats,
      })
      clearInterval(loadInterval.current)
      showToast('Success! Redirecting to test plan...', 'success')
      setTimeout(() => navigate(`/plan/${r.data.data.id}`, { state: { plan: r.data.data } }), 1000)
    } catch(e) {
      clearInterval(loadInterval.current)
      setGenError(e.response?.data?.error || 'Generation failed. Check your LLM API key in Settings.')
      showToast(e.response?.data?.error || 'Generation failed', 'error')
      setGenerating(false)
    }
  }

  // ── Loading Overlay ───────────────────────────────────────────────────────
  if (generating) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: '80vh' }}>
        <div className="card" style={{ width: 580, padding: 40 }}>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr auto', gap: 32, alignItems: 'center' }}>
            <div>
              <div style={{ fontSize: 18, fontWeight: 700, marginBottom: 28 }}>Generating Test Plan</div>
              {LOAD_STEPS.map((step, i) => (
                <div key={step} style={{ display: 'flex', alignItems: 'center', gap: 14, marginBottom: 18 }}>
                  <div style={{
                    width: 24, height: 24, borderRadius: '50%',
                    display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
                    background: i < loadStep ? 'var(--green-bg)' : i === loadStep ? 'var(--cyan-dim)' : 'var(--border)',
                    border: `2px solid ${i < loadStep ? 'var(--green)' : i === loadStep ? 'var(--cyan)' : 'var(--border-2)'}`,
                    transition: 'all 0.4s ease',
                  }}>
                    {i < loadStep
                      ? <span style={{ color: 'var(--green)', fontSize: 12 }}>✓</span>
                      : i === loadStep
                      ? <div className="spinner" style={{ width: 12, height: 12, borderWidth: 2 }} />
                      : null
                    }
                  </div>
                  <span style={{
                    fontSize: 14,
                    color: i < loadStep ? 'var(--green)' : i === loadStep ? 'var(--text)' : 'var(--text-dim)',
                    fontWeight: i === loadStep ? 600 : 400,
                    transition: 'color 0.4s ease',
                  }}>
                    {step}
                  </span>
                </div>
              ))}
            </div>

            {/* Brain animation */}
            <div style={{
              width: 140, height: 140,
              border: `2px solid var(--cyan)`,
              borderRadius: '50%',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              boxShadow: 'var(--cyan-glow)',
              animation: 'pulse 2s infinite',
              flexShrink: 0,
            }}>
              <span style={{ fontSize: 52 }}>🧠</span>
            </div>
          </div>

          <div style={{ marginTop: 28 }}>
            <div style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 8 }}>
              Loading test case skeletons...
            </div>
            <div className="progress-bar-wrap">
              <div className="progress-bar-fill" style={{ width: `${((loadStep + 1) / LOAD_STEPS.length) * 100}%` }} />
            </div>
            <div style={{ marginTop: 8, height: 6, borderRadius: 4, background: 'var(--border)', width: '60%' }}
              className="skeleton" />
          </div>
        </div>
      </div>
    )
  }

  // ── Main Generate UI ──────────────────────────────────────────────────────
  return (
    <div className="fade-in">
      <div className="page-header">
        <div>
          <h1 className="page-title">Generate Test Plan</h1>
          <p className="page-subtitle">Fetch a Jira issue and generate a structured test plan with AI</p>
        </div>
      </div>

      {readOnly && (
        <div className="card" style={{ marginBottom: 16, padding: '10px 16px', background: 'var(--orange-bg, rgba(251,146,60,0.1))', border: '1px solid var(--orange, #fb923c)', color: 'var(--orange, #fb923c)', fontSize: 13, display: 'flex', alignItems: 'center', gap: 8 }}>
          <span>👁</span> Read-only mode — you can browse Jira issues but generating test plans requires a developer account.
        </div>
      )}

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 300px', gap: 20, alignItems: 'start' }}>

        {/* Left: Jira Input + Preview */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>

          {/* Jira ID input */}
          <div className="card" style={{ padding: '16px 20px' }}>
            <div className="search-bar">
              <span className="search-icon">🔍</span>
              <input
                placeholder="Enter Jira Issue ID (e.g. PROJ-1042)"
                value={jiraId}
                onChange={e => setJiraId(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && fetchIssue()}
                style={{ fontSize: 14 }}
              />
              <button
                className="btn btn-outline"
                style={{ padding: '6px 14px', fontSize: 12 }}
                onClick={() => fetchIssue()}
                disabled={issueLoading || !jiraId.trim()}
              >
                {issueLoading ? <span className="spinner" /> : 'Fetch'}
              </button>
            </div>
          </div>

          {/* Error state */}
          {issueError && (
            <div className="card" style={{ border: '1px solid var(--red)', background: 'var(--red-bg)', color: 'var(--red)' }}>
              ⚠ {issueError}
            </div>
          )}

          {/* Issue Preview Card */}
          {issue && (
            <div className="card slide-in">
              <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 14 }}>
                <div style={{ fontWeight: 700, fontSize: 15 }}>Jira Issue Preview</div>
                <span className="badge badge-cyan">{issue.id}</span>
              </div>

              <div style={{ display: 'flex', gap: 12, marginBottom: 12 }}>
                <div style={{
                  width: 40, height: 40, borderRadius: '50%',
                  background: 'linear-gradient(135deg, var(--cyan), var(--cyan-2))',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  fontSize: 16, flexShrink: 0,
                }}>
                  {issue.issue_type?.[0] || '?'}
                </div>
                <div>
                  <div style={{ fontWeight: 600, fontSize: 15, marginBottom: 2 }}>{issue.title}</div>
                  <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>
                    {issue.issue_type} • {issue.status} • {issue.story_points ? `${issue.story_points} SP` : 'No SP'}
                  </div>
                </div>
              </div>

              <div style={{ fontSize: 13, color: 'var(--text-muted)', lineHeight: 1.7, marginBottom: 12 }}>
                {issue.description
                  ? issue.description.slice(0, 220) + (issue.description.length > 220 ? '...' : '')
                  : 'No description available.'}
              </div>

              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 10 }}>
                <span className={`badge ${issue.priority === 'High' ? 'badge-red' : issue.priority === 'Medium' ? 'badge-orange' : 'badge-gray'}`}>
                  {issue.priority}
                </span>
                <span className="badge badge-gray">{issue.assignee}</span>
              </div>

              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                {(issue.labels || []).map(l => (
                  <span key={l} className="badge badge-blue">{l}</span>
                ))}
              </div>

              {issue.sub_tasks?.length > 0 && (
                <div style={{ marginTop: 14, padding: '10px 14px', background: 'var(--bg-card-2)', borderRadius: 'var(--radius)' }}>
                  <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-muted)', marginBottom: 8, textTransform: 'uppercase', letterSpacing: '0.5px' }}>
                    Sub-tasks ({issue.sub_tasks.length})
                  </div>
                  {issue.sub_tasks.slice(0,3).map(st => (
                    <div key={st.id} style={{ fontSize: 12, color: 'var(--text)', display: 'flex', gap: 8, marginBottom: 4 }}>
                      <span className="badge badge-cyan" style={{ fontSize: 10 }}>{st.id}</span>
                      {st.title}
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* Empty state */}
          {!issue && !issueError && !issueLoading && (
            <div className="card empty-state" style={{ minHeight: 200 }}>
              <div className="empty-icon">🔍</div>
              <div className="empty-title">Enter a Jira Issue ID above</div>
              <div className="empty-desc">Paste any Jira issue like PROJ-1042 and click Fetch to preview it</div>
            </div>
          )}

          {genError && (
            <div className="card" style={{ border: '1px solid var(--red)', background: 'var(--red-bg)', color: 'var(--red)' }}>
              ⚠ {genError}
            </div>
          )}
        </div>

        {/* Right: Config Panel */}
        <div className="card" style={{ position: 'sticky', top: 20, display: 'flex', flexDirection: 'column', gap: 14, opacity: readOnly ? 0.6 : 1 }}>
          <div style={{ fontWeight: 700, fontSize: 15, marginBottom: 4 }}>Test Plan Configuration</div>

          <div className="form-group">
            <label className="form-label">Detail Level</label>
            <select className="form-select" value={detailLevel} onChange={e => setDetailLevel(e.target.value)} disabled={readOnly}>
              <option value="standard">Standard</option>
              <option value="detailed">Detailed</option>
            </select>
          </div>

          <div className="form-group">
            <label className="form-label">Test Plan Format</label>
            <div style={{ display: 'flex', gap: 7, flexWrap: 'wrap' }}>
              {FORMATS.map(f => (
                <button
                  key={f}
                  onClick={() => !readOnly && toggleFormat(f)}
                  disabled={readOnly}
                  style={{
                    padding: '4px 12px',
                    borderRadius: 9999,
                    fontSize: 12,
                    fontWeight: 600,
                    cursor: readOnly ? 'not-allowed' : 'pointer',
                    transition: 'all 0.2s',
                    border: `1px solid ${formats.includes(f) ? 'var(--cyan)' : 'var(--border-2)'}`,
                    background: formats.includes(f) ? 'var(--cyan-dim)' : 'transparent',
                    color: formats.includes(f) ? 'var(--cyan)' : 'var(--text-muted)',
                    fontFamily: 'Inter, sans-serif',
                  }}
                >
                  {f}
                </button>
              ))}
            </div>
          </div>

          <div className="divider" />

          <div className="toggle-row">
            <div>
              <div className="toggle-label">Include Negative Cases</div>
              <div className="toggle-desc">Edge & boundary tests</div>
            </div>
            <label className="toggle">
              <input type="checkbox" checked={negCases} onChange={e => setNegCases(e.target.checked)} disabled={readOnly} />
              <span className="toggle-slider" />
            </label>
          </div>

          <div className="toggle-row">
            <div>
              <div className="toggle-label">Include Sub-tasks</div>
              <div className="toggle-desc">Sub-task context in prompt</div>
            </div>
            <label className="toggle">
              <input type="checkbox" checked={subTasks} onChange={e => setSubTasks(e.target.checked)} disabled={readOnly} />
              <span className="toggle-slider" />
            </label>
          </div>

          <div className="toggle-row">
            <div>
              <div className="toggle-label">Use AI Suggestions</div>
              <div className="toggle-desc">Enhanced detail mode</div>
            </div>
            <label className="toggle">
              <input type="checkbox" checked={aiSuggestions} onChange={e => setAiSuggestions(e.target.checked)} disabled={readOnly} />
              <span className="toggle-slider" />
            </label>
          </div>

          <div className="divider" style={{ margin: '8px 0' }} />

          <button
            className="btn btn-primary btn-lg"
            onClick={handleGenerate}
            disabled={!issue || generating || readOnly}
            title={readOnly ? 'Developer account required to generate test plans' : ''}
            style={{ width: '100%', padding: '12px 16px', fontSize: 14 }}
          >
            {generating ? <><span className="spinner" style={{ borderWidth: 2, width: 16, height: 16 }} /> Generating...</> : '⚡ Generate Test Plan'}
          </button>
          {readOnly && (
            <div style={{ fontSize: 11, color: 'var(--text-muted)', textAlign: 'center' }}>
              Developer account required to generate
            </div>
          )}
        </div>
      </div>
      
      {toast && (
        <div className={`toast toast-${toast.type}`}>
          {toast.type === 'success' ? '✅' : '❌'} {toast.msg}
        </div>
      )}
    </div>
  )
}
