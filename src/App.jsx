import { useState, lazy, Suspense } from 'react'
import { Routes, Route, Navigate } from 'react-router-dom'
import { ProviderContext } from './context/ProviderContext'
import { AuthProvider } from './context/AuthContext'
import Sidebar from './components/Sidebar'
import TopBar from './components/TopBar'
import ProtectedRoute from './components/ProtectedRoute'

const Dashboard        = lazy(() => import('./pages/Dashboard'))
const Generate         = lazy(() => import('./pages/Generate'))
const History          = lazy(() => import('./pages/History'))
const Settings         = lazy(() => import('./pages/Settings'))
const ViewPlan         = lazy(() => import('./pages/ViewPlan'))
const TestCaseDashboard = lazy(() => import('./pages/TestCaseDashboard'))
const TestGenerator    = lazy(() => import('./pages/TestGenerator'))
const Login            = lazy(() => import('./pages/Login'))
const UserManagement   = lazy(() => import('./pages/UserManagement'))

function PageLoader() {
  return (
    <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', minHeight: '60vh' }}>
      <div className="spinner" style={{ width: 36, height: 36 }} />
    </div>
  )
}

function AppLayout() {
  const [activeProvider, setActiveProvider] = useState('')

  return (
    <ProviderContext.Provider value={{ activeProvider, setActiveProvider }}>
      <div className="app-shell">
        <Sidebar />
        <div className="main-wrapper">
          <TopBar />
          <main className="main-content" id="main-content">
            <Suspense fallback={<PageLoader />}>
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
            </Suspense>
          </main>
        </div>
      </div>
    </ProviderContext.Provider>
  )
}

export default function App() {
  return (
    <AuthProvider>
      <Suspense fallback={<PageLoader />}>
        <Routes>
          <Route path="/login" element={<Login />} />
          <Route path="/*" element={<AppLayout />} />
        </Routes>
      </Suspense>
    </AuthProvider>
  )
}
