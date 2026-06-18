import { useState, useEffect, useMemo, useContext } from 'react'
import { useNavigate } from 'react-router-dom'
import axios from 'axios'
import { AuthContext } from '../context/AuthContext'

function priorityBadge(p) {
  if (!p) return 'badge-gray'
  if (p.toLowerCase() === 'high')   return 'badge-red'
  if (p.toLowerCase() === 'medium') return 'badge-orange'
  return 'badge-gray'
}

export default function TestCaseDashboard() {
  const navigate = useNavigate()
  const { hasRole } = useContext(AuthContext)
  const readOnly = !hasRole('developer')
  const [testCases, setTestCases] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  // Filters
  const [jiraFilter, setJiraFilter] = useState('')
  const [searchFilter, setSearchFilter] = useState('')

  // CRUD State
  const [editingId, setEditingId] = useState(null)
  const [editForm, setEditForm] = useState({})
  const [cloningTc, setCloningTc] = useState(null)
  const [cloneForm, setCloneForm] = useState(null)
  const [actionLoading, setActionLoading] = useState(false)
  const [generateLoading, setGenerateLoading] = useState(null)

  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(10)
  
  const [toast, setToast] = useState(null)
  function showToast(msg, type = 'info') {
    setToast({ msg, type })
    setTimeout(() => setToast(null), 3000)
  }

  function handleGenerateScript(plan_id, tc_id) {
    setGenerateLoading(tc_id)
    axios.post(`/api/generate-script/${plan_id}/${tc_id}`)
      .then(() => {
        fetchCases()
        showToast('Script generated successfully!', 'success')
      })
      .catch(e => showToast(e.response?.data?.error || 'Failed to generate script', 'error'))
      .finally(() => setGenerateLoading(null))
  }

  const fetchCases = () => {
    axios.get('/api/test-cases')
      .then(r => { setTestCases(r.data.data); setLoading(false) })
      .catch(e => { setError('Failed to load test cases'); setLoading(false) })
  }

  useEffect(() => {
    fetchCases()
  }, [])

  function startEdit(tc) {
    setEditingId(`${tc.plan_id}-${tc.id}`)
    setEditForm({
      title: tc.title,
      priority: tc.priority,
      type: tc.type,
      preconditions: (tc.preconditions || []).join('\n'),
      steps: (tc.steps || []).join('\n'),
      expected_result: tc.expected_result || '',
      test_data: JSON.stringify(tc.test_data || {}, null, 2)
    })
  }

  function handleSave(plan_id, tc_id) {
    setActionLoading(true)
    let parsedData = {}
    try {
      parsedData = JSON.parse(editForm.test_data)
    } catch(e) {}

    const payload = {
      id: tc_id,
      title: editForm.title,
      priority: editForm.priority,
      type: editForm.type,
      preconditions: editForm.preconditions.split('\n').map(s=>s.trim()).filter(Boolean),
      steps: editForm.steps.split('\n').map(s=>s.trim()).filter(Boolean),
      expected_result: editForm.expected_result,
      test_data: parsedData
    }

    axios.put(`/api/test-cases/${plan_id}/${tc_id}`, payload)
      .then(() => {
        setEditingId(null)
        fetchCases()
        showToast('Test case saved successfully!', 'success')
      })
      .catch(e => showToast(e.response?.data?.error || 'Failed to update test case', 'error'))
      .finally(() => setActionLoading(false))
  }

  function startClone(tc) {
    setCloningTc(tc)
    setCloneForm({
      title: `${tc.title} (Copy)`,
      priority: tc.priority,
      type: tc.type,
      preconditions: (tc.preconditions || []).join('\n'),
      steps: (tc.steps || []).join('\n'),
      expected_result: tc.expected_result || '',
      test_data: JSON.stringify(tc.test_data || {}, null, 2)
    })
  }

  function submitClone() {
    setActionLoading(true)
    let parsedData = {}
    try { parsedData = JSON.parse(cloneForm.test_data) } catch(e) {}

    const payload = {
      title: cloneForm.title,
      priority: cloneForm.priority,
      type: cloneForm.type,
      preconditions: cloneForm.preconditions.split('\n').map(s=>s.trim()).filter(Boolean),
      steps: cloneForm.steps.split('\n').map(s=>s.trim()).filter(Boolean),
      expected_result: cloneForm.expected_result,
      test_data: parsedData
    }
    axios.post(`/api/test-cases/${cloningTc.plan_id}`, payload)
      .then(() => { fetchCases(); setPage(1); setCloningTc(null); showToast('Test case duplicated!', 'success') })
      .catch(e => showToast(e.response?.data?.error || 'Failed to duplicate test case', 'error'))
      .finally(() => setActionLoading(false))
  }

  function handleDelete(plan_id, tc_id) {
    if(!window.confirm(`Delete ${tc_id} permanently?`)) return
    setActionLoading(true)
    axios.delete(`/api/test-cases/${plan_id}/${tc_id}`)
      .then(() => {
        fetchCases()
        showToast('Test case deleted.', 'success')
      })
      .catch(e => showToast(e.response?.data?.error || 'Failed to delete test case', 'error'))
      .finally(() => setActionLoading(false))
  }

  // Derived filtered list
  const filteredCases = useMemo(() => {
    return testCases.filter(tc => {
      const matchJira = !jiraFilter || tc.jira_id.toLowerCase().includes(jiraFilter.toLowerCase())
      const matchSearch = !searchFilter || 
                          tc.title.toLowerCase().includes(searchFilter.toLowerCase()) || 
                          (tc.type || '').toLowerCase().includes(searchFilter.toLowerCase())
      return matchJira && matchSearch
    }).reverse()
  }, [testCases, jiraFilter, searchFilter])

  // Get unique Jira IDs for autocomplete/dropdown (optional, but good for UX)
  const uniqueJiras = useMemo(() => {
    const ids = new Set(testCases.map(tc => tc.jira_id).filter(Boolean))
    return Array.from(ids)
  }, [testCases])

  if (loading) return (
    <div style={{ display:'flex', justifyContent:'center', alignItems:'center', minHeight:'60vh' }}>
      <div className="spinner" style={{ width:40, height:40 }} />
    </div>
  )

  if (error) return (
    <div className="empty-state">
      <div className="empty-icon">❌</div>
      <div className="empty-title">Error</div>
      <div className="empty-desc">{error}</div>
    </div>
  )

  return (
    <div className="fade-in">
      <div className="page-header">
        <div>
          <h1 className="page-title">Test Case Dashboard</h1>
          <p className="page-subtitle">View and filter all isolated test cases across generated plans</p>
        </div>
      </div>

      {readOnly && (
        <div className="card" style={{ marginBottom: 16, padding: '10px 16px', background: 'var(--orange-bg, rgba(251,146,60,0.1))', border: '1px solid var(--orange, #fb923c)', color: 'var(--orange, #fb923c)', fontSize: 13, display: 'flex', alignItems: 'center', gap: 8 }}>
          <span>👁</span> Read-only mode — editing, cloning, deleting, and generating scripts requires a developer account.
        </div>
      )}

      <div className="card" style={{ marginBottom: 20 }}>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
          <div className="form-group" style={{ marginBottom: 0 }}>
            <label className="form-label">Filter by Jira ID</label>
            <div className="search-bar">
              <span className="search-icon">🔗</span>
              <input 
                placeholder="e.g. PROJ-1042" 
                value={jiraFilter} 
                onChange={e => setJiraFilter(e.target.value)} 
              />
            </div>
          </div>
          <div className="form-group" style={{ marginBottom: 0 }}>
            <label className="form-label">Search Title/Type</label>
            <div className="search-bar">
              <span className="search-icon">🔍</span>
              <input 
                placeholder="Search..." 
                value={searchFilter} 
                onChange={e => setSearchFilter(e.target.value)} 
              />
            </div>
          </div>
        </div>
        
        {/* Quick select tags for Jira IDs */}
        {uniqueJiras.length > 0 && (
          <div style={{ marginTop: 12, display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
            <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>Quick Filters: </span>
            <button 
              className={`filter-tab ${!jiraFilter ? 'active' : ''}`}
              onClick={() => setJiraFilter('')}
            >
              All
            </button>
            {uniqueJiras.map(id => (
              <button 
                key={id}
                className={`filter-tab ${jiraFilter.toUpperCase() === id.toUpperCase() ? 'active' : ''}`}
                onClick={() => setJiraFilter(id)}
              >
                {id}
              </button>
            ))}
          </div>
        )}
      </div>

      {filteredCases.length > 0 && (
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, fontSize: 13, color: 'var(--text-muted)' }}>
            <span>Show</span>
            <select className="form-select" style={{ padding: '4px 24px 4px 8px', fontSize: 13 }} value={pageSize} onChange={e => { setPageSize(e.target.value === 'All' ? 'All' : Number(e.target.value)); setPage(1) }}>
              <option value={10}>10</option>
              <option value={20}>20</option>
              <option value={50}>50</option>
              <option value="All">All</option>
            </select>
          </div>
          
          <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
            <button className="btn btn-ghost" style={{ padding: '4px 8px' }} disabled={page === 1} onClick={() => setPage(p => Math.max(1, p - 1))}>Previous</button>
            <span style={{ fontSize: 13 }}>Page {page} of {pageSize === 'All' ? 1 : Math.ceil(filteredCases.length / pageSize) || 1}</span>
            <button className="btn btn-ghost" style={{ padding: '4px 8px' }} disabled={page >= (pageSize === 'All' ? 1 : Math.ceil(filteredCases.length / pageSize))} onClick={() => setPage(p => Math.min(Math.ceil(filteredCases.length / pageSize), p + 1))}>Next</button>
          </div>
        </div>
      )}

      {filteredCases.length === 0 ? (
        <div className="empty-state card">
          <div className="empty-icon">📂</div>
          <div className="empty-title">No matching test cases</div>
          <div className="empty-desc">Try clearing your filters or generating a new test plan.</div>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          {(() => {
            const limit = pageSize === 'All' ? filteredCases.length : pageSize;
            const startIndex = (page - 1) * limit;
            const visibleCases = filteredCases.slice(startIndex, startIndex + limit);
            return visibleCases.map((tc, idx) => {
              const uniqueKey = `${tc.plan_id}-${tc.id}`
            const isEditing = editingId === uniqueKey

            if (isEditing) {
              return (
                <div key={uniqueKey} className="tc-card slide-in" style={{ borderLeft: '3px solid var(--cyan)' }}>
                  <div style={{ display: 'flex', gap: 12, marginBottom: 12 }}>
                    <div style={{ flex: 1 }}>
                      <label className="form-label">Title</label>
                      <input className="form-input" value={editForm.title} onChange={e => setEditForm({...editForm, title: e.target.value})} />
                    </div>
                    <div style={{ width: 120 }}>
                      <label className="form-label">Priority</label>
                      <select className="form-select" value={editForm.priority} onChange={e => setEditForm({...editForm, priority: e.target.value})}>
                        <option value="High">High</option>
                        <option value="Medium">Medium</option>
                        <option value="Low">Low</option>
                      </select>
                    </div>
                    <div style={{ width: 120 }}>
                      <label className="form-label">Type</label>
                      <select className="form-select" value={editForm.type} onChange={e => setEditForm({...editForm, type: e.target.value})}>
                        <option value="Positive">Positive</option>
                        <option value="Negative">Negative</option>
                        <option value="Edge">Edge Case</option>
                      </select>
                    </div>
                  </div>
                  
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
                    <div>
                      <label className="form-label">Preconditions (1 per line)</label>
                      <textarea className="form-input" rows="3" value={editForm.preconditions} onChange={e => setEditForm({...editForm, preconditions: e.target.value})} />
                      <div style={{ marginTop: 12 }}>
                        <label className="form-label">Steps (1 per line)</label>
                        <textarea className="form-input" rows="4" value={editForm.steps} onChange={e => setEditForm({...editForm, steps: e.target.value})} />
                      </div>
                    </div>
                    <div>
                      <label className="form-label">Expected Result</label>
                      <textarea className="form-input" style={{ height: 42 }} value={editForm.expected_result} onChange={e => setEditForm({...editForm, expected_result: e.target.value})} />
                      <div style={{ marginTop: 12 }}>
                        <label className="form-label">Test Data (JSON)</label>
                        <textarea className="form-input" rows="4" style={{ fontFamily: 'monospace' }} value={editForm.test_data} onChange={e => setEditForm({...editForm, test_data: e.target.value})} />
                      </div>
                    </div>
                  </div>
                  
                  <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end', marginTop: 16, paddingTop: 16, borderTop: '1px solid var(--border)' }}>
                    <button className="btn btn-outline" onClick={() => setEditingId(null)}>Cancel</button>
                    {!readOnly && (
                      <button className="btn btn-primary" onClick={() => handleSave(tc.plan_id, tc.id)} disabled={actionLoading}>
                        {actionLoading ? 'Saving...' : 'Save Changes'}
                      </button>
                    )}
                  </div>
                </div>
              )
            }

            return (
              <div key={uniqueKey} className="tc-card slide-in">
                <div className="tc-header" style={{ justifyContent: 'space-between' }}>
                  <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                    <span className="badge badge-gray" style={{ cursor: 'pointer' }} onClick={() => navigate(`/plan/${tc.plan_id}`)}>
                      {tc.jira_id}
                    </span>
                    <span className="tc-id">{tc.id}</span>
                    <span className={`badge ${priorityBadge(tc.priority)}`}>{tc.priority}</span>
                    <span className={`badge ${tc.type?.toLowerCase()==='negative' ? 'badge-orange' : 'badge-blue'}`}>{tc.type}</span>
                  </div>
                  <div style={{ display: 'flex', gap: 8 }}>
                    {!readOnly && (
                      <button
                        className="btn btn-ghost"
                        style={{ fontSize: 11, padding: '4px 8px' }}
                        onClick={() => startEdit(tc)}
                        disabled={actionLoading}
                      >
                        ✏️ Edit
                      </button>
                    )}
                    {!readOnly && (
                      <button
                        className="btn btn-ghost"
                        style={{ fontSize: 11, padding: '4px 8px' }}
                        onClick={() => startClone(tc)}
                        disabled={actionLoading}
                      >
                        ➕ Clone
                      </button>
                    )}
                    {!readOnly && (
                      <button
                        className="btn btn-ghost"
                        style={{ fontSize: 11, padding: '4px 8px', color: 'var(--cyan)' }}
                        onClick={() => handleGenerateScript(tc.plan_id, tc.id)}
                        disabled={actionLoading || generateLoading === tc.id}
                      >
                        {generateLoading === tc.id ? '⏳ Gen...' : (tc.playwright_script ? '🔄 Regen' : '🤖 Gen')}
                      </button>
                    )}
                    {tc.playwright_script && (
                      <button
                        className="btn btn-ghost"
                        style={{ fontSize: 11, padding: '4px 8px', color: 'var(--cyan)' }}
                        onClick={() => navigate(`/test-generator?tc=${tc.id}`)}
                      >
                        👁️ View Script
                      </button>
                    )}
                    {!readOnly && (
                      <button
                        className="btn btn-ghost"
                        style={{ fontSize: 11, padding: '4px 8px', color: 'var(--red)' }}
                        onClick={() => handleDelete(tc.plan_id, tc.id)}
                        disabled={actionLoading}
                      >
                        🗑️
                      </button>
                    )}
                    <button
                      className="btn btn-ghost"
                      style={{ fontSize: 11, padding: '4px 8px' }}
                      onClick={() => navigate(`/plan/${tc.plan_id}`)}
                    >
                      View Plan ⇗
                    </button>
                  </div>
                </div>
                
                <div className="tc-title">{tc.title}</div>
                
                <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:16, marginTop: 12 }}>
                  <div>
                    {tc.preconditions?.length > 0 && <>
                      <div className="tc-section-label">Preconditions</div>
                      <ul className="tc-list">{tc.preconditions.map((p,i) => <li key={i}>{p}</li>)}</ul>
                    </>}
                    {tc.steps?.length > 0 && <>
                      <div className="tc-section-label" style={{ marginTop:12 }}>Steps</div>
                      <ul className="tc-list">{tc.steps.map((s,i) => <li key={i}>{i+1}. {s}</li>)}</ul>
                    </>}
                  </div>
                  <div>
                    {tc.expected_result && <>
                      <div className="tc-section-label">Expected Result</div>
                      <div style={{ fontSize:13, color:'var(--text)', marginBottom:10 }}>{tc.expected_result}</div>
                    </>}
                    {Object.keys(tc.test_data||{}).length > 0 && <>
                      <div className="tc-section-label">Test Data</div>
                      {Object.entries(tc.test_data).map(([k,v]) => (
                        <div key={k} style={{ fontSize:12, marginBottom:3 }}>
                          <b style={{ color:'var(--text)' }}>{k}:</b> <span style={{ fontFamily:'monospace', color:'var(--cyan)' }}>{v}</span>
                        </div>
                      ))}
                    </>}
                  </div>
                </div>
              </div>
            )
          })})()}
        </div>
      )}
      
      {toast && (
        <div className={`toast toast-${toast.type}`}>
          {toast.type === 'success' ? '✅' : '❌'} {toast.msg}
        </div>
      )}

      {/* Clone Modal */}
      {cloningTc && cloneForm && (
        <div className="modal-overlay" onClick={() => setCloningTc(null)}>
          <div className="modal-content" onClick={e => e.stopPropagation()}>
            <h2 style={{ fontSize: 18, marginBottom: 16 }}>Clone Test Case {cloningTc.id}</h2>
            
            <div style={{ display: 'flex', gap: 12, marginBottom: 12 }}>
              <div style={{ flex: 1 }}>
                <label className="form-label">Title</label>
                <input className="form-input" value={cloneForm.title} onChange={e => setCloneForm({...cloneForm, title: e.target.value})} />
              </div>
              <div style={{ width: 120 }}>
                <label className="form-label">Priority</label>
                <select className="form-select" value={cloneForm.priority} onChange={e => setCloneForm({...cloneForm, priority: e.target.value})}>
                  <option value="High">High</option>
                  <option value="Medium">Medium</option>
                  <option value="Low">Low</option>
                </select>
              </div>
              <div style={{ width: 120 }}>
                <label className="form-label">Type</label>
                <select className="form-select" value={cloneForm.type} onChange={e => setCloneForm({...cloneForm, type: e.target.value})}>
                  <option value="Positive">Positive</option>
                  <option value="Negative">Negative</option>
                  <option value="Edge">Edge Case</option>
                </select>
              </div>
            </div>
            
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
              <div>
                <label className="form-label">Preconditions (1 per line)</label>
                <textarea className="form-input" rows="3" value={cloneForm.preconditions} onChange={e => setCloneForm({...cloneForm, preconditions: e.target.value})} />
                <div style={{ marginTop: 12 }}>
                  <label className="form-label">Steps (1 per line)</label>
                  <textarea className="form-input" rows="4" value={cloneForm.steps} onChange={e => setCloneForm({...cloneForm, steps: e.target.value})} />
                </div>
              </div>
              <div>
                <label className="form-label">Expected Result</label>
                <textarea className="form-input" style={{ height: 42 }} value={cloneForm.expected_result} onChange={e => setCloneForm({...cloneForm, expected_result: e.target.value})} />
                <div style={{ marginTop: 12 }}>
                  <label className="form-label">Test Data (JSON)</label>
                  <textarea className="form-input" rows="4" style={{ fontFamily: 'monospace' }} value={cloneForm.test_data} onChange={e => setCloneForm({...cloneForm, test_data: e.target.value})} />
                </div>
              </div>
            </div>
            
            <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end', marginTop: 24, paddingTop: 16, borderTop: '1px solid var(--border)' }}>
              <button className="btn btn-outline" onClick={() => setCloningTc(null)} disabled={actionLoading}>Cancel</button>
              <button className="btn btn-primary" onClick={submitClone} disabled={actionLoading}>
                {actionLoading ? 'Saving...' : 'Clone Test Case'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
