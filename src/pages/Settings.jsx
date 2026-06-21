import { useState, useEffect } from 'react'
import axios from 'axios'

const PROVIDER_META = {
  openai:    { name: 'OpenAI',    model: 'GPT-4o',           color: '#10A37F', icon: 'O|' },
  anthropic: { name: 'Anthropic', model: 'Claude 3.5 Sonnet', color: '#CC7832', icon: 'A' },
  google:    { name: 'Google',    model: 'Gemini 1.5 Pro',   color: '#4285F4', icon: 'G' },
  groq:      { name: 'Groq',      model: 'Llama 3 70B',      color: '#F55036', icon: 'Gr' },
  local_llm: { name: 'Local LLM', model: 'Ollama/LM Studio', color: '#8B949E', icon: '💻' },
}

export default function Settings() {
  const [settings, setSettings] = useState(null)
  const [loading, setLoading]   = useState(true)
  const [saving, setSaving]     = useState(false)
  const [tab, setTab]           = useState('llm')
  const [activeEdit, setActiveEdit] = useState(null)
  const [testing, setTesting]   = useState({})
  const [testResults, setTestResults] = useState({})
  const [toast, setToast]       = useState(null)
  const [persistence, setPersistence] = useState(null)

  useEffect(() => { document.title = 'Settings | Testurai' }, [])

  useEffect(() => {
    axios.get('/api/settings')
      .then(r => {
        const data = r.data.data
        if (data._persistence) {
          setPersistence(data._persistence)
          delete data._persistence
        }
        setSettings(data)
        setLoading(false)
      })
      .catch(() => setLoading(false))
  }, [])

  function showToast(msg, type = 'info') {
    setToast({ msg, type }); setTimeout(() => setToast(null), 3500)
  }

  function updateField(path, value) {
    console.log(`[Update] ${path} -> ${value ? (value.length > 5 ? value.slice(0, 5) + '...' : value) : 'empty'}`)
    setSettings(prev => {
      const clone = { ...prev }
      const keys = path.split('.')
      const lastKey = keys.pop()
      let current = clone
      for (const k of keys) {
        if (!current[k]) current[k] = {}
        current[k] = { ...current[k] }
        current = current[k]
      }
      current[lastKey] = value
      return clone
    })
  }

  async function handleSave() {
    setSaving(true)
    try {
      const r = await axios.put('/api/settings', settings)
      setSettings(r.data.data)
      showToast('Settings saved!', 'success')
    } catch (e) {
      showToast(e.response?.data?.error || 'Save failed', 'error')
    } finally { setSaving(false) }
  }

  async function handleTestConnection(type, provider) {
    const key = type === 'jira' ? 'jira' : provider
    setTesting(p => ({ ...p, [key]: true }))
    setTestResults(p => ({ ...p, [key]: null }))
    try {
      // Save first so backend has latest keys
      await axios.put('/api/settings', settings)
      const r = await axios.post('/api/settings/test-connection', { type, provider })
      setTestResults(p => ({ ...p, [key]: r.data.data }))
    } catch (e) {
      setTestResults(p => ({ ...p, [key]: { ok: false, error: e.response?.data?.error || 'Failed' } }))
    } finally { setTesting(p => ({ ...p, [key]: false })) }
  }

  if (loading) return (
    <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', minHeight: '60vh' }}>
      <div className="spinner" style={{ width: 40, height: 40 }} />
    </div>
  )

  const providers = settings?.llm?.providers || {}

  const TABS = [
    { id: 'llm',     label: 'LLM Models',      icon: '🤖' },
    { id: 'jira',    label: 'Jira Integration', icon: '🔗' },
    { id: 'output',  label: 'Output Formats',   icon: '📄' },
  ]

  return (
    <div className="fade-in">
      <div className="page-header">
        <div>
          <h1 className="page-title">Settings</h1>
          <p className="page-subtitle">Configure integrations, LLM providers, and export options</p>
        </div>
        <button className="btn btn-primary" onClick={handleSave} disabled={saving}>
          {saving ? <span className="spinner" style={{ width: 14, height: 14 }} /> : '💾'} Save Settings
        </button>
      </div>

      {/* Persistence warning banner */}
      {persistence && !persistence.durable && (
        <div style={{
          background: 'rgba(245,158,11,0.12)', border: '1px solid rgba(245,158,11,0.4)',
          borderRadius: 'var(--radius)', padding: '12px 16px', marginBottom: 20,
          display: 'flex', gap: 12, alignItems: 'flex-start',
        }}>
          <span style={{ fontSize: 20, flexShrink: 0 }}>⚠️</span>
          <div>
            <div style={{ fontWeight: 700, color: '#f59e0b', marginBottom: 4 }}>No Durable Storage Detected</div>
            <div style={{ fontSize: 13, color: 'var(--text-muted)', lineHeight: 1.6 }}>
              {persistence.warning || 'Settings will be lost after each deploy.'}
            </div>
            <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 8 }}>
              <strong>Recommended fix:</strong> Add your API keys as Vercel Environment Variables:
              <code style={{ background: 'var(--surface-2)', padding: '1px 6px', borderRadius: 4, margin: '0 4px' }}>OPENAI_API_KEY</code>,
              <code style={{ background: 'var(--surface-2)', padding: '1px 6px', borderRadius: 4, margin: '0 4px' }}>ANTHROPIC_API_KEY</code>,
              <code style={{ background: 'var(--surface-2)', padding: '1px 6px', borderRadius: 4, margin: '0 4px' }}>GEMINI_API_KEY</code>,
              <code style={{ background: 'var(--surface-2)', padding: '1px 6px', borderRadius: 4, margin: '0 4px' }}>JIRA_API_TOKEN</code>,
              <code style={{ background: 'var(--surface-2)', padding: '1px 6px', borderRadius: 4, margin: '0 4px' }}>JIRA_EMAIL</code>,
              <code style={{ background: 'var(--surface-2)', padding: '1px 6px', borderRadius: 4, margin: '0 4px' }}>JIRA_BASE_URL</code>.
            </div>
          </div>
        </div>
      )}

      {/* Supabase connected badge */}
      {persistence?.durable && persistence?.mode === 'supabase' && (
        <div style={{
          background: 'rgba(34,197,94,0.08)', border: '1px solid rgba(34,197,94,0.3)',
          borderRadius: 'var(--radius)', padding: '10px 16px', marginBottom: 20,
          display: 'flex', gap: 10, alignItems: 'center', fontSize: 13,
        }}>
          <span>✅</span>
          <span style={{ color: 'var(--green)', fontWeight: 600 }}>Supabase connected — settings will persist across deployments.</span>
        </div>
      )}

      <div style={{ display: 'grid', gridTemplateColumns: '200px 1fr', gap: 20, alignItems: 'start' }}>
        {/* Left Tabs */}
        <div className="card" style={{ position: 'sticky', top: 20 }}>
          {TABS.map(t => (
            <div key={t.id} onClick={() => setTab(t.id)} style={{
              padding: '10px 12px', borderRadius: 'var(--radius-sm)', fontSize: 13, cursor: 'pointer',
              color: tab === t.id ? 'var(--cyan)' : 'var(--text-muted)',
              background: tab === t.id ? 'var(--cyan-dim)' : 'transparent',
              fontWeight: tab === t.id ? 600 : 400, marginBottom: 4, transition: 'all 0.15s',
              display: 'flex', gap: 8, alignItems: 'center',
            }}>
              <span>{t.icon}</span> {t.label}
            </div>
          ))}
        </div>

        {/* Right Content */}
        <div>
          {/* LLM Tab */}
          {tab === 'llm' && (
            <div className="slide-in">
              <div style={{ fontWeight: 700, fontSize: 16, marginBottom: 16 }}>LLM Models</div>

              {/* Provider Cards */}
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 14, marginBottom: 24 }}>
                {Object.entries(PROVIDER_META).map(([key, meta]) => {
                  const cfg = providers[key] || {}
                  const result = testResults[key]
                  const isActive = settings?.llm?.active_provider === key
                  return (
                    <div key={key} className="card" style={{
                      border: isActive ? '2px solid var(--cyan)' : '1px solid var(--border)',
                      cursor: 'pointer', transition: 'all 0.2s',
                    }} onClick={() => setActiveEdit(key)}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                          <span style={{ fontWeight: 800, color: meta.color, fontSize: 18 }}>{meta.icon}</span>
                          <span style={{ fontWeight: 600, fontSize: 13 }}>{meta.name}</span>
                        </div>
                        {isActive && <span style={{ color: 'var(--cyan)', fontSize: 16 }}>✦</span>}
                      </div>
                      <div style={{ fontWeight: 700, fontSize: 15, marginBottom: 6 }}>{cfg.model || meta.model}</div>
                      {result && (
                        <span className={`badge ${result.ok ? 'badge-green' : 'badge-red'}`} style={{ marginBottom: 8 }}>
                          {result.ok ? '✓ Connected' : '✗ Failed'}
                        </span>
                      )}

                      {key === 'local_llm' && !result && (
                        <span className="badge badge-gray" style={{ marginBottom: 8 }}>Base URL ready</span>
                      )}
                      {key !== 'local_llm' && cfg.api_key && !result && (
                        <span className="badge badge-gray" style={{ marginBottom: 8 }}>Configured</span>
                      )}
                      <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
                        {!isActive && (
                          <button className="btn btn-ghost" style={{ fontSize: 11, padding: '4px 8px' }}
                            onClick={e => { e.stopPropagation(); updateField('llm.active_provider', key) }}>
                            Set as Default
                          </button>
                        )}
                        <button className="btn btn-outline" style={{ fontSize: 11, padding: '4px 10px' }}
                          onClick={e => { e.stopPropagation(); setActiveEdit(key) }}>
                          Configure
                        </button>
                      </div>
                    </div>
                  )
                })}
              </div>

              {/* Config Form */}
              {activeEdit && (
                <div className="card" style={{ marginBottom: 20 }}>
                  <div style={{ fontWeight: 700, fontSize: 15, marginBottom: 16 }}>
                    {PROVIDER_META[activeEdit]?.name} Configuration
                  </div>
                  {activeEdit !== 'local_llm' && (
                    <div className="form-group">
                      <label className="form-label">API Key</label>
                      <input className="form-input" type="password"
                        value={providers[activeEdit]?.api_key || ''}
                        onChange={e => updateField(`llm.providers.${activeEdit}.api_key`, e.target.value)}
                        placeholder="Paste your API key here" />
                    </div>
                  )}
                  {activeEdit === 'local_llm' && (
                    <div className="form-group">
                      <label className="form-label">Base URL</label>
                      <input className="form-input" type="text"
                        value={providers[activeEdit]?.base_url || 'http://localhost:11434/v1'}
                        onChange={e => updateField(`llm.providers.${activeEdit}.base_url`, e.target.value)}
                        placeholder="http://localhost:11434/v1" />
                    </div>
                  )}
                  <div className="form-group">
                    <label className="form-label">Model</label>
                    <input className="form-input"
                      value={providers[activeEdit]?.model || ''}
                      onChange={e => updateField(`llm.providers.${activeEdit}.model`, e.target.value)} />
                  </div>
                  <div className="form-group">
                    <label className="form-label">Temperature</label>
                    <div className="range-row">
                      <input type="range" min="0" max="1" step="0.1"
                        value={providers[activeEdit]?.temperature || 0.7}
                        onChange={e => updateField(`llm.providers.${activeEdit}.temperature`, parseFloat(e.target.value))} />
                      <span className="range-val">{providers[activeEdit]?.temperature ?? 0.7}</span>
                    </div>
                  </div>
                  <div className="form-group">
                    <label className="form-label">Max Tokens</label>
                    <input className="form-input" type="number"
                      value={providers[activeEdit]?.max_tokens || 4096}
                      onChange={e => updateField(`llm.providers.${activeEdit}.max_tokens`, parseInt(e.target.value))} />
                  </div>
                  <button className="btn btn-primary" onClick={() => handleTestConnection('llm', activeEdit)} disabled={testing[activeEdit]}>
                    {testing[activeEdit] ? <span className="spinner" style={{width:14,height:14}} /> : '🔌'} Test Connection
                  </button>
                  {testResults[activeEdit] && (
                    <div style={{ marginTop: 12, fontSize: 13, color: testResults[activeEdit].ok ? 'var(--green)' : 'var(--red)' }}>
                      {testResults[activeEdit].ok ? '✅ Connection successful!' : `❌ ${testResults[activeEdit].error}`}
                      {!testResults[activeEdit].ok && testResults[activeEdit].details && (
                        <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 4 }}>
                          {testResults[activeEdit].details}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              )}
            </div>
          )}

          {/* Jira Tab */}
          {tab === 'jira' && (
            <div className="slide-in">
              <div style={{ fontWeight: 700, fontSize: 16, marginBottom: 16 }}>Jira Integration</div>
              <div className="card">
                <div className="form-group">
                  <label className="form-label">Jira Base URL</label>
                  <input className="form-input" value={settings?.jira?.base_url || ''}
                    onChange={e => updateField('jira.base_url', e.target.value)}
                    placeholder="https://yourcompany.atlassian.net" />
                </div>
                <div className="form-group">
                  <label className="form-label">Email</label>
                  <input className="form-input" value={settings?.jira?.email || ''}
                    onChange={e => updateField('jira.email', e.target.value)}
                    placeholder="user@company.com" />
                </div>
                <div className="form-group">
                  <label className="form-label">API Token</label>
                  <input className="form-input" type="password" value={settings?.jira?.api_token || ''}
                    onChange={e => updateField('jira.api_token', e.target.value)}
                    placeholder="Your Jira API token" />
                </div>
                <button className="btn btn-primary" onClick={() => handleTestConnection('jira')} disabled={testing.jira}>
                  {testing.jira ? <span className="spinner" style={{width:14,height:14}} /> : '🔌'} Test Jira Connection
                </button>
                {testResults.jira && (
                  <div style={{ marginTop: 12, fontSize: 13, color: testResults.jira.ok ? 'var(--green)' : 'var(--red)' }}>
                    {testResults.jira.ok ? `✅ Connected as ${testResults.jira.user}` : `❌ ${testResults.jira.error}`}
                    {!testResults.jira.ok && testResults.jira.details && (
                      <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 4 }}>
                        {testResults.jira.details}
                      </div>
                    )}
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Output Tab */}
          {tab === 'output' && (
            <div className="slide-in">
              <div style={{ fontWeight: 700, fontSize: 16, marginBottom: 16 }}>Output Formats</div>
              <div className="card">
                <div className="toggle-row">
                  <div>
                    <div className="toggle-label">DOCX Export</div>
                    <div className="toggle-desc">Microsoft Word format using python-docx</div>
                  </div>
                  <span className="badge badge-green">Enabled</span>
                </div>
                <div className="toggle-row">
                  <div>
                    <div className="toggle-label">PDF Export</div>
                    <div className="toggle-desc">PDF format using reportlab</div>
                  </div>
                  <span className="badge badge-green">Enabled</span>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>

      {toast && <div className={`toast toast-${toast.type}`}>{toast.type==='success'?'✅':toast.type==='error'?'❌':'ℹ️'} {toast.msg}</div>}
    </div>
  )
}
