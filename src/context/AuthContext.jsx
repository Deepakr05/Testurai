import { createContext, useContext, useState, useEffect } from 'react'
import axios from 'axios'

export const AuthContext = createContext({
  user: null,
  token: null,
  login: async () => {},
  logout: () => {},
  hasRole: () => false,
  loading: true,
})

const ROLE_LEVELS = { normal: 0, developer: 1, admin: 2 }

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null)
  const [token, setToken] = useState(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    const storedToken = localStorage.getItem('tm_token')
    const storedUser = localStorage.getItem('tm_user')
    if (storedToken && storedUser) {
      try {
        const parsedUser = JSON.parse(storedUser)
        setToken(storedToken)
        setUser(parsedUser)
        axios.defaults.headers.common['Authorization'] = `Bearer ${storedToken}`
      } catch {
        localStorage.removeItem('tm_token')
        localStorage.removeItem('tm_user')
      }
    }
    setLoading(false)
  }, [])

  // Redirect to login on any 401 (expired token)
  useEffect(() => {
    const id = axios.interceptors.response.use(
      r => r,
      err => {
        if (err.response?.status === 401 && !window.location.pathname.includes('/login')) {
          _clear()
          window.location.href = '/login'
        }
        return Promise.reject(err)
      }
    )
    return () => axios.interceptors.response.eject(id)
  }, [])

  function _clear() {
    setToken(null)
    setUser(null)
    localStorage.removeItem('tm_token')
    localStorage.removeItem('tm_user')
    delete axios.defaults.headers.common['Authorization']
  }

  async function login(email, password) {
    const r = await axios.post('/api/auth/login', { email, password })
    const { access_token, user: userData } = r.data.data
    setToken(access_token)
    setUser(userData)
    localStorage.setItem('tm_token', access_token)
    localStorage.setItem('tm_user', JSON.stringify(userData))
    axios.defaults.headers.common['Authorization'] = `Bearer ${access_token}`
    return userData
  }

  function logout() {
    _clear()
  }

  function hasRole(minRole) {
    if (!user) return false
    return (ROLE_LEVELS[user.role] ?? -1) >= (ROLE_LEVELS[minRole] ?? 999)
  }

  return (
    <AuthContext.Provider value={{ user, token, login, logout, hasRole, loading }}>
      {children}
    </AuthContext.Provider>
  )
}

export function useAuth() {
  return useContext(AuthContext)
}
