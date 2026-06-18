import { useState, useEffect, useMemo, useContext } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import axios from 'axios'
import { ProviderContext } from '../context/ProviderContext'
import { AuthContext } from '../context/AuthContext'

export default function TestGenerator() {
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const paramTc = searchParams.get('tc') || ''
  const { activeProvider } = useContext(ProviderContext)
  const { hasRole } = useContext(AuthContext)
  const readOnly = !hasRole('developer')

  const [testCases, setTestCases] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  // Filters
  const [jiraFilter, setJiraFilter] = useState('')
  const [searchFilter, setSearchFilter] = useState(paramTc)
  const [statusFilter, setStatusFilter] = useState('all') // all, has_script, needs_script

  // CRUD & Generate State
  const [editingId, setEditingId] = useState(null)
  const [editScriptContent, setEditScriptContent] = useState('')
  const [actionLoading, setActionLoading] = useState(false)
  const [generateLoading, setGenerateLoading] = useState(null)

  const genAbortRef       = useRef(null)
  const batchCancelledRef = useRef(false)
  const batchAbortRef     = useRef(null)

  // Selection
  const [selectedIds, setSelectedIds] = useState(new Set())
  const [expandedScripts, setExpandedScripts] = useState(new Set())
  const [batchGenStatus, setBatchGenStatus] = useState(null)
  
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(10)
  
  const [toast, setToast] = useState(null)
  function showToast(msg, type = 'info') {
    setToast({ msg, type })
    setTimeout(() => setToast(null), 3000)
  }

  const fetchCases = () => {
    axios.get('/api/test-cases')
      .then(r => { setTestCases(r.data.data); setLoading(false) })
      .catch(e => { setError('Failed to load test cases'); setLoading(false) })
  }

  useEffect(() => {
    fetchCases()
  }, [])

  useEffect(() => {
    if (paramTc && testCases.length > 0) {
      const match = testCases.find(tc => tc.id === paramTc)
      if (match && match.playwright_script) {
        setExpandedScripts(prev => new Set(prev).add(`${match.plan_id}-${match.id}`))
      }
    }
  }, [paramTc, testCases])

  function handleGenerateScript(plan_id, tc_id) {
    const ctrl = new AbortController()
    genAbortRef.current = ctrl
    setGenerateLoading(tc_id)
    axios.post(`/api/generate-script/${plan_id}/${tc_id}`, { provider: activeProvider }, { signal: ctrl.signal })
      .then(() => { fetchCases(); showToast('Script generated successfully!', 'success') })
      .catch(e => { if (!axios.isCancel(e)) showToast(e.response?.data?.error || 'Failed to generate script', 'error') })
      .finally(() => setGenerateLoading(null))
  }

  function cancelGenerateScript() {
    genAbortRef.current?.abort()
    setGenerateLoading(null)
    showToast('Script generation cancelled.', 'info')
  }

  function startEdit(tc) {
    setEditingId(`${tc.plan_id}-${tc.id}`)
    setEditScriptContent(tc.playwright_script || '')
  }

  function handleSave(tc, scriptContent) {
    setActionLoading(true)
    // Update the tc object
    const updatedTc = { ...tc, playwright_script: scriptContent }
    
    axios.put(`/api/test-cases/${tc.plan_id}/${tc.id}`, updatedTc)
      .then(() => {
        setEditingId(null)
        fetchCases()
        if (!scriptContent) showToast('Script deleted', 'success')
        else showToast('Script updated successfully!', 'success')
      })
      .catch(e => showToast(e.response?.data?.error || 'Failed to update script', 'error'))
      .finally(() => setActionLoading(false))
  }

  function handleDeleteScript(tc) {
    if(!window.confirm(`Delete generated script for ${tc.id}?`)) return
    handleSave(tc, '')
  }

  // Derived filtered list
  const filteredCases = useMemo(() => {
    return testCases.filter(tc => {
      const matchJira = !jiraFilter || tc.jira_id.toLowerCase().includes(jiraFilter.toLowerCase())
      const matchSearch = !searchFilter || tc.title.toLowerCase().includes(searchFilter.toLowerCase()) || tc.id.toLowerCase().includes(searchFilter.toLowerCase())
      let matchStatus = true
      if (statusFilter === 'has_script') matchStatus = !!tc.playwright_script
      if (statusFilter === 'needs_script') matchStatus = !tc.playwright_script

      return matchJira && matchSearch && matchStatus
    })
  }, [testCases, jiraFilter, searchFilter, statusFilter])

  // Get unique Jira IDs for autocomplete/dropdown (optional, but good for UX)
  const uniqueJiras = useMemo(() => {
    const ids = new Set(testCases.map(tc => tc.jira_id).filter(Boolean))
    return Array.from(ids)
  }, [testCases])

  // Multi-select handlers
  const handleSelectAll = (e) => {
    if (e.target.checked) {
      const allIds = testCases.map(tc => `${tc.plan_id}-${tc.id}`)
      setSelectedIds(new Set(allIds))
    } else {
      setSelectedIds(new Set())
    }
  }

  const handleBatchGenerate = async () => {
    const toGenerate = testCases.filter(tc => selectedIds.has(`${tc.plan_id}-${tc.id}`))
    if (toGenerate.length === 0) return showToast('No tests selected.', 'error')

    batchCancelledRef.current = false
    setBatchGenStatus(`0/${toGenerate.length}`)
    let successCount = 0
    let failCount = 0

    for (let i = 0; i < toGenerate.length; i++) {
      if (batchCancelledRef.current) break
      const tc = toGenerate[i]
      const ctrl = new AbortController()
      batchAbortRef.current = ctrl
      try {
        await axios.post(`/api/generate-script/${tc.plan_id}/${tc.id}`, { provider: activeProvider }, { signal: ctrl.signal })
        successCount++
        setBatchGenStatus(`${i + 1}/${toGenerate.length}`)
      } catch (e) {
        if (axios.isCancel(e)) break
        failCount++
      }
    }

    setBatchGenStatus(null)
    fetchCases()
    if (batchCancelledRef.current) {
      showToast(`Cancelled. ${successCount} script(s) generated before stopping.`, 'info')
    } else {
      showToast(`Batch complete. ${successCount} succeeded, ${failCount} failed.`, failCount > 0 ? 'error' : 'success')
    }
  }

  function cancelBatchGenerate() {
    batchCancelledRef.current = true
    batchAbortRef.current?.abort()
  }

  const toggleAllExpanded = () => {
      const selectedWithScripts = testCases.filter(tc => selectedIds.has(`${tc.plan_id}-${tc.id}`) && tc.playwright_script)
      if (selectedWithScripts.length === 0) return showToast('No tests with scripts selected.', 'error')
      
      const allKeys = selectedWithScripts.map(tc => `${tc.plan_id}-${tc.id}`)
      const allAreExpanded = allKeys.every(k => expandedScripts.has(k))
      
      if (allAreExpanded) {
          const newSet = new Set(expandedScripts)
          allKeys.forEach(k => newSet.delete(k))
          setExpandedScripts(newSet)
      } else {
          const newSet = new Set(expandedScripts)
          allKeys.forEach(k => newSet.add(k))
          setExpandedScripts(newSet)
      }
  }

  const handleSelectOne = (id, checked) => {
    const newSet = new Set(selectedIds)
    if (checked) newSet.add(id)
    else newSet.delete(id)
    setSelectedIds(newSet)
  }

  const handleCopySelected = () => {
    const selectedTcs = testCases.filter(tc => selectedIds.has(`${tc.plan_id}-${tc.id}`) && tc.playwright_script)
    if (selectedTcs.length === 0) return showToast('No tests with scripts selected.', 'error')
    
    let combined = "import { test, expect } from '@playwright/test';\n\n"
    selectedTcs.forEach(tc => {
      combined += `// ==========================================\n`
      combined += `// Test Case: ${tc.id} - ${tc.title}\n`
      combined += `// ==========================================\n\n`
      
      const script = tc.playwright_script || ""
      const cleanLines = script.split("\n").filter(l => !l.startsWith("import { test"))
      combined += cleanLines.join("\n").trim()
      combined += "\n\n"
    })
    
    navigator.clipboard.writeText(combined)
    showToast(`Copied ${selectedTcs.length} scripts to clipboard!`, 'success')
  }

  const handleExportSelected = () => {
    const selectedTcs = testCases.filter(tc => selectedIds.has(`${tc.plan_id}-${tc.id}`) && tc.playwright_script)
    if (selectedTcs.length === 0) return showToast('No tests with scripts selected.', 'error')
    
    const payload = selectedTcs.map(tc => ({
      tc_id: tc.id,
      jira_id: tc.jira_id,
      title: tc.title,
      playwright_script: tc.playwright_script
    }))
    
    axios.post('/api/export-scripts', { scripts: payload }, { responseType: 'blob' })
      .then(response => {
        const url = window.URL.createObjectURL(new Blob([response.data]))
        const link = document.createElement('a')
        link.href = url
        link.setAttribute('download', 'playwright_scripts.zip')
        document.body.appendChild(link)
        link.click()
        document.body.removeChild(link)
      })
      .catch(err => {
        console.error("Export failed:", err)
        showToast('Failed to export scripts.', 'error')
      })
  }

  const allSelected = filteredCases.length > 0 && selectedIds.size === filteredCases.length

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
          <h1 className="page-title">Playwright Test Generator</h1>
          <p className="page-subtitle">{readOnly ? 'View and export automated e2e tests' : 'Generate, manage, and export automated e2e tests'}</p>
        </div>
        <div style={{ display: 'flex', gap: 12 }}>
          <button
            className="btn btn-outline"
            onClick={handleCopySelected}
            disabled={selectedIds.size === 0}
          >
            📋 Copy Selected
          </button>
          <button
            className="btn btn-primary"
            onClick={handleExportSelected}
            disabled={selectedIds.size === 0}
          >
            📦 Export Zip
          </button>
        </div>
      </div>

      {readOnly && (
        <div className="card" style={{ marginBottom: 16, padding: '10px 16px', background: 'var(--orange-bg, rgba(251,146,60,0.1))', border: '1px solid var(--orange, #fb923c)', color: 'var(--orange, #fb923c)', fontSize: 13, display: 'flex', alignItems: 'center', gap: 8 }}>
          <span>👁</span> Read-only mode — you can view and export scripts but generating or editing requires a developer account.
        </div>
      )}

      <div className="card" style={{ marginBottom: 20 }}>
        <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0,1fr) minmax(0,1fr) 200px', gap: 16 }}>
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
            <label className="form-label">Search TC / Title</label>
            <div className="search-bar">
              <span className="search-icon">🔍</span>
              <input 
                placeholder="Search..." 
                value={searchFilter} 
                onChange={e => setSearchFilter(e.target.value)} 
              />
            </div>
          </div>
          <div className="form-group" style={{ marginBottom: 0 }}>
            <label className="form-label">Script Status</label>
            <select className="form-select" value={statusFilter} onChange={e=>setStatusFilter(e.target.value)}>
              <option value="all">All</option>
              <option value="has_script">Has Script</option>
              <option value="needs_script">Needs Script</option>
            </select>
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

      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          {!readOnly && batchGenStatus === null && (
            <button className="btn btn-outline" style={{ padding: '4px 8px', fontSize: 12 }} onClick={handleBatchGenerate} disabled={selectedIds.size === 0}>
              🤖 Generate Scripts
            </button>
          )}
          {!readOnly && batchGenStatus !== null && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <span className="spinner" style={{ width: 13, height: 13, borderWidth: 2 }} />
              <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>Generating {batchGenStatus}...</span>
              <button className="btn btn-outline" style={{ padding: '3px 8px', fontSize: 11, color: 'var(--red,#ef4444)', borderColor: 'var(--red,#ef4444)' }} onClick={cancelBatchGenerate}>
                ✕ Stop
              </button>
            </div>
          )}
          <button className="btn btn-outline" style={{ padding: '4px 8px', fontSize: 12 }} onClick={toggleAllExpanded} disabled={selectedIds.size === 0}>
             👁️ {(() => {
               const selectedWithScripts = testCases.filter(tc => selectedIds.has(`${tc.plan_id}-${tc.id}`) && tc.playwright_script);
               const allAreExpanded = selectedWithScripts.length > 0 && selectedWithScripts.every(tc => expandedScripts.has(`${tc.plan_id}-${tc.id}`));
               return allAreExpanded ? 'Hide Scripts' : 'View Scripts';
             })()}
          </button>
          <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer' }}>
            <input 
              type="checkbox" 
              checked={testCases.length > 0 && selectedIds.size === testCases.length} 
              onChange={handleSelectAll} 
            />
            <span style={{ fontWeight: 600 }}>Select All</span>
          </label>
        </div>
        
        <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, color: 'var(--text-muted)' }}>
              <span>Show</span>
              <select className="form-select" style={{ padding: '4px 24px 4px 8px', fontSize: 13 }} value={pageSize} onChange={e => { setPageSize(e.target.value === 'All' ? 'All' : Number(e.target.value)); setPage(1) }}>
                <option value={10}>10</option>
                <option value={20}>20</option>
                <option value={50}>50</option>
                <option value="All">All</option>
              </select>
            </div>
            <button className="btn btn-ghost" style={{ padding: '4px 8px', fontSize: 12 }} disabled={page === 1} onClick={() => setPage(p => Math.max(1, p - 1))}>Previous</button>
            <span style={{ fontSize: 13 }}>Page {page} of {pageSize === 'All' ? 1 : Math.ceil(filteredCases.length / pageSize) || 1}</span>
            <button className="btn btn-ghost" style={{ padding: '4px 8px', fontSize: 12 }} disabled={page >= (pageSize === 'All' ? 1 : Math.ceil(filteredCases.length / pageSize))} onClick={() => setPage(p => Math.min(Math.ceil(filteredCases.length / pageSize), p + 1))}>Next</button>
        </div>
      </div>

      {filteredCases.length === 0 ? (
        <div className="empty-state card">
          <div className="empty-icon">🤖</div>
          <div className="empty-title">No test cases found</div>
          <div className="empty-desc">Try clearing your filters or generating a test plan.</div>
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
              const checked = selectedIds.has(uniqueKey)
              const isExpanded = expandedScripts.has(uniqueKey)
              const toggleExpanded = () => setExpandedScripts(prev => {
                const next = new Set(prev); next.has(uniqueKey) ? next.delete(uniqueKey) : next.add(uniqueKey); return next;
              })

            return (
              <div key={uniqueKey} className="tc-card slide-in" style={{ padding: '16px', display: 'flex', gap: 16 }}>
                <div style={{ paddingTop: 4 }}>
                  <input 
                    type="checkbox" 
                    checked={checked} 
                    onChange={e => handleSelectOne(uniqueKey, e.target.checked)} 
                    style={{ transform: 'scale(1.2)' }}
                  />
                </div>
                
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div className="tc-header" style={{ justifyContent: 'space-between', marginBottom: 8 }}>
                    <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                      <span className="badge badge-gray" style={{ cursor: 'pointer' }} onClick={() => navigate(`/plan/${tc.plan_id}`)}>
                        {tc.jira_id}
                      </span>
                      <span className="tc-id">{tc.id}</span>
                      <span style={{ fontWeight: 600, color: 'var(--text)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{tc.title}</span>
                      {!tc.playwright_script && <span className="badge badge-orange">Needs Script</span>}
                      {tc.playwright_script && <span className="badge badge-blue">Ready</span>}
                    </div>
                    <div style={{ display: 'flex', gap: 8 }}>
                      {!readOnly && generateLoading === tc.id && (
                        <button
                          className="btn btn-outline"
                          style={{ fontSize: 11, padding: '4px 10px', color: 'var(--red,#ef4444)', borderColor: 'var(--red,#ef4444)', display: 'flex', alignItems: 'center', gap: 5 }}
                          onClick={cancelGenerateScript}
                        >
                          <span className="spinner" style={{ width: 11, height: 11, borderWidth: 2 }} /> Cancel
                        </button>
                      )}
                      {!readOnly && generateLoading !== tc.id && (
                        <button
                          className="btn btn-primary"
                          style={{ fontSize: 11, padding: '4px 10px' }}
                          onClick={() => handleGenerateScript(tc.plan_id, tc.id)}
                          disabled={generateLoading !== null || actionLoading}
                        >
                          {tc.playwright_script ? '🔄 Regenerate' : '🤖 Generate'}
                        </button>
                      )}
                      {tc.playwright_script && (
                        <button
                          className="btn btn-ghost"
                          style={{ fontSize: 11, padding: '4px 8px' }}
                          onClick={toggleExpanded}
                        >
                          👁️ {isExpanded ? 'Hide Script' : 'View Script'}
                        </button>
                      )}
                      {!readOnly && tc.playwright_script && !isEditing && (
                        <button
                          className="btn btn-ghost"
                          style={{ fontSize: 11, padding: '4px 8px' }}
                          onClick={() => startEdit(tc)}
                          disabled={actionLoading}
                        >
                          ✏️ Edit
                        </button>
                      )}
                      {!readOnly && tc.playwright_script && (
                        <button
                          className="btn btn-ghost"
                          style={{ fontSize: 11, padding: '4px 8px', color: 'var(--red)' }}
                          onClick={() => handleDeleteScript(tc)}
                          disabled={actionLoading}
                        >
                          🗑️
                        </button>
                      )}
                    </div>
                  </div>
                  
                  {isEditing ? (
                    <div style={{ marginTop: 12 }}>
                      <textarea 
                        className="form-input" 
                        style={{ fontFamily: 'monospace', minHeight: 200, fontSize: 13, background: 'var(--surface-sunken)', color: 'var(--cyan)' }}
                        value={editScriptContent}
                        onChange={e => setEditScriptContent(e.target.value)}
                        placeholder="Write Playwright test logic here..."
                        spellCheck="false"
                      />
                      <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 12 }}>
                         <button className="btn btn-outline" onClick={() => setEditingId(null)} disabled={actionLoading}>Cancel</button>
                         <button className="btn btn-primary" onClick={() => handleSave(tc, editScriptContent)} disabled={actionLoading}>
                           💾 Save Script
                         </button>
                      </div>
                    </div>
                  ) : (
                    tc.playwright_script && isExpanded && (
                      <div style={{ marginTop: 12, background: 'var(--surface-sunken)', padding: 12, borderRadius: 8, fontSize: 12, overflowX: 'auto' }}>
                        <pre style={{ margin: 0, fontFamily: 'monospace', color: 'var(--cyan)' }}>
                          {tc.playwright_script}
                        </pre>
                      </div>
                    )
                  )}
                  
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
    </div>
  )
}
