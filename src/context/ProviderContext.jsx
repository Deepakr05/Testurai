import { createContext } from 'react'

export const ProviderContext = createContext({
  activeProvider: '',
  setActiveProvider: () => {},
})
