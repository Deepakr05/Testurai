import { useState, useEffect } from 'react'
import { Routes, Route, Navigate } from 'react-router-dom'
import axios from 'axios'
import { ProviderContext } from './context/ProviderContext'
import { AuthProvider } from './context/AuthContext'
import Sidebar from './components/Sidebar'
import TopBar from './components/TopBar'
import ProtectedRoute from './components/ProtectedRoute'
import Dashboard from './pages/Dashboard'
import Generate from './pages/Generate'
import History from './pages/History'
import Settings from './pages/Settings'
import ViewPlan from './pages/ViewPlan'
import TestCaseDashboard from './pages/TestCaseDashboard'
import TestGenerator from './pages/TestGenerator'
import Login from './pages/Login'
import UserManagement from './pages/UserManagement'

function AppLayout() {
  const [activeProvider, setActiveProvider] = useState('')

  useEffect(() => {
    axios.get('/api/settings/providers')
      .then(r => setActiveProvider(r.data.data.active_provider || 'openai'))
      .catch(() => {})
  }, [])

  return (
    <ProviderContext.Provider value={{ activeProvider, setActiveProvider }}>
      <div className="app-shell">
        <Sidebar />
        <div className="main-wrapper">
          <TopBar />
          <main className="main-content">
            <Routes>
              <Route path="/"               element={<Navigate to="/dashboard" replace />} />
              <Route path="/dashboard"      element={<ProtectedRoute><Dashboard /></ProtectedRoute>} />
              <Route path="/generate"       element={<ProtectedRoute><Generate /></ProtectedRoute>} />
              <Route path="/history"        element={<ProtectedRoute><History /></ProtectedRoute>} />
              <Route path="/test-cases"     element={<ProtectedRoute><TestCaseDashboard /></ProtectedRoute>} />
              <Route path="/test-generator" element={<ProtectedRoute><TestGenerator /></ProtectedRoute>} />
              <Route path="/plan/:id"       element={<ProtectedRoute><ViewPlan /></ProtectedRoute>} />
              <Route path="/settings"       element={<ProtectedRoute minRole="developer"><Settings /></ProtectedRoute>} />
              <Route path="/users"          element={<ProtectedRoute minRole="admin"><UserManagement /></ProtectedRoute>} />
            </Routes>
          </main>
        </div>
      </div>
    </ProviderContext.Provider>
  )
}

export default function App() {
  return (
    <AuthProvider>
      <Routes>
        <Route path="/login" element={<Login />} />
        <Route path="/*" element={<AppLayout />} />
      </Routes>
    </AuthProvider>
  )
}
