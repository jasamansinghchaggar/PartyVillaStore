'use client'

import { createContext, useContext, useEffect, useState, useRef } from 'react'
import { useSupabase } from '@/hooks/use-supabase'
import { useRouter } from 'next/navigation'
import { Session, AuthChangeEvent } from '@supabase/supabase-js'
import { validateSession, clearSessionStorage } from '@/lib/auth/session-validator'
import { getAuthConfig } from '@/lib/auth/session-storage'

type User = {
  id: string
  email: string
  role?: string
}

type AuthContextType = {
  user: User | null
  isLoading: boolean
  isAdmin: boolean
  signIn: (email: string, password: string) => Promise<void>
  signOut: () => Promise<void>
  refreshSession: () => Promise<void>
}

const AuthContext = createContext<AuthContextType | undefined>(undefined)

// Admin emails - hardcoded for development only
// In production, this would be configured via environment variables
const ADMIN_EMAILS = ['partyvilla.store@gmail.com']

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [isAdmin, setIsAdmin] = useState(false)
  const router = useRouter()
  const supabase = useSupabase()
  const subscriptionRef = useRef<any>(null)
  const isInitializedRef = useRef(false)
  const loadingTimeoutRef = useRef<NodeJS.Timeout | null>(null)
  const refreshInFlightRef = useRef<Promise<void> | null>(null)
  const userRef = useRef<User | null>(null)

  // Keep ref in sync
  useEffect(() => { userRef.current = user }, [user])

  // Safety timeout to prevent infinite loading
  const setLoadingWithTimeout = (loading: boolean) => {
    // Avoid resetting timer if already loading to prevent perpetual extension
    setIsLoading(prev => {
      if (loading && prev) return prev
      return loading
    })
    if (loading) {
      if (loadingTimeoutRef.current) clearTimeout(loadingTimeoutRef.current)
      loadingTimeoutRef.current = setTimeout(() => {
        console.warn('[Auth] Forced clear loading after timeout')
        setIsLoading(false)
      }, 10000)
    } else if (!loading && loadingTimeoutRef.current) {
      clearTimeout(loadingTimeoutRef.current)
      loadingTimeoutRef.current = null
    }
  }

  const recoverSession = async () => {
    try {
      // Use the enhanced session validator
      const { valid, session, needsRefresh } = await validateSession(supabase)
      
      if (!valid) {
        // Clear any invalid session data
        const authConfig = getAuthConfig()
        clearSessionStorage(authConfig.storageKey)
        return null
      }
      
      return session
    } catch (error) {
      return null
    }
  }

  const refreshSession = async (
    isFromTabReactivation = false,
    reason: string = 'manual',
    sessionOverride?: Session | null,
  ) => {
    if (refreshInFlightRef.current) {
      return refreshInFlightRef.current
    }
    const task = (async () => {
      try {
        const currentUser = userRef.current
        console.debug('[Auth] refreshSession start', { isFromTabReactivation, hasUser: !!currentUser, reason })
        // If we already have a user, keep this silent (no loading spinner) even if event was SIGNED_IN again
        if (!isFromTabReactivation && !currentUser) {
          setLoadingWithTimeout(true)
        }
        let timeoutId: NodeJS.Timeout | null = null
        if (sessionOverride === undefined) {
          timeoutId = setTimeout(() => {
            console.warn('[Auth] recoverSession slow, still waiting', { reason })
          }, 6000)
        }
        const session = sessionOverride === undefined ? await recoverSession() : sessionOverride
        if (timeoutId) {
          clearTimeout(timeoutId)
        }
        if (!session) {
          setUser(null)
          setIsAdmin(false)
          setLoadingWithTimeout(false)
          return
        }
        setUser({ id: session.user.id, email: session.user.email || '' })
        const userIsAdmin = ADMIN_EMAILS.includes(session.user.email || '')
        setIsAdmin(userIsAdmin)
        if (userIsAdmin) {
          // Optionally ensure role in background; ignore errors
          // void supabase.from('profiles').upsert({ id: session.user.id, role: 'admin' }, { onConflict: 'id' })
        }
        setLoadingWithTimeout(false)
      } catch (e) {
        console.warn('[Auth] refreshSession error', e)
        setLoadingWithTimeout(false)
      }
    })().finally(() => { refreshInFlightRef.current = null })
    refreshInFlightRef.current = task
    return task
  }

  const setupAuthListener = () => {
    // Clean up existing subscription
    if (subscriptionRef.current) {
      subscriptionRef.current.unsubscribe()
      subscriptionRef.current = null
    }

    // Set up new auth state change listener
    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      async (event: AuthChangeEvent, session: Session | null) => {
        console.debug('[Auth] onAuthStateChange', event, session?.user?.id)
        const currentUser = userRef.current
        if (event === 'SIGNED_OUT') {
          setUser(null)
          setIsAdmin(false)
          setLoadingWithTimeout(false)
          return
        }
        if (event === 'TOKEN_REFRESHED') {
          await refreshSession(true, 'token-refreshed', session ?? undefined)
          return
        }
        if (event === 'SIGNED_IN') {
          // If we already had a user and same id, treat as redundant
            if (currentUser && session?.user?.id === currentUser.id) {
              console.debug('[Auth] Ignoring redundant SIGNED_IN for existing user')
              return
            }
            await refreshSession(!!currentUser, 'signed-in', session ?? undefined)
            return
        }
        if (event === 'INITIAL_SESSION' || event === 'USER_UPDATED') {
          await refreshSession(!!currentUser, event.toLowerCase(), session ?? undefined)
        }
      }
    )
    
    subscriptionRef.current = subscription
    return subscription
  }

  // Removed reinitializeAuth (unused after refactor)

  // Single lightweight visibility revalidator
  useEffect(() => {
    const handler = () => {
      if (document.visibilityState !== 'visible') return
      if (!userRef.current) return
      // Proactively refresh if session is near expiry (within 2 mins)
      supabase.auth.getSession().then(({ data }: { data: { session: Session | null } }) => {
        const expires = data.session?.expires_at || 0
        const now = Math.floor(Date.now() / 1000)
        if (expires && expires - now < 120) {
          void refreshSession(true)
        }
      })
    }
    document.addEventListener('visibilitychange', handler)
    return () => document.removeEventListener('visibilitychange', handler)
  }, [user])

  useEffect(() => {
    // Initial session check and setup
    if (!isInitializedRef.current) {
      const initializeAuth = async () => {
        try {
          if (process.env.NODE_ENV !== 'production') console.debug('[Auth] initialize start')
          // First try to recover any existing session
          const session = await recoverSession()
          if (session) {
            await refreshSession(false, 'initial', session) // Initial load, show loading
          } else {
            setLoadingWithTimeout(false)
          }
          if (process.env.NODE_ENV !== 'production') console.debug('[Auth] initialize end')
        } catch (error) {
          setLoadingWithTimeout(false)
        }
      }
      
      initializeAuth()
      setupAuthListener()
      isInitializedRef.current = true
    }
    
    return () => {
      if (subscriptionRef.current) {
        subscriptionRef.current.unsubscribe()
        subscriptionRef.current = null
      }
      if (loadingTimeoutRef.current) {
        clearTimeout(loadingTimeoutRef.current)
        loadingTimeoutRef.current = null
      }
    }
  }, [])

  const signIn = async (email: string, password: string) => {
    try {
      setLoadingWithTimeout(true)
      
      const { data, error } = await supabase.auth.signInWithPassword({
        email: email.trim().toLowerCase(),
        password,
      })
      
      if (error) throw error
      
      await refreshSession(false, 'password-sign-in', data?.session ?? undefined)
      // router.refresh() removed to avoid unnecessary full tree reload churn
    } catch (error: any) {
      throw error
    } finally {
      setLoadingWithTimeout(false)
    }
  }

  const signOut = async () => {
    try {
      setLoadingWithTimeout(true)
      
      // Clear session from Supabase
      await supabase.auth.signOut()
      
      // Clear local session storage
      const authConfig = getAuthConfig()
      clearSessionStorage(authConfig.storageKey)
      
      // Clear local state
      setUser(null)
      setIsAdmin(false)
      
      // router.refresh() avoided here; local state already cleared
    } catch (error) {
      // Silent error handling
    } finally {
      setLoadingWithTimeout(false)
    }
  }

  return (
    <AuthContext.Provider
      value={{
        user,
        isLoading,
        isAdmin,
        signIn,
        signOut,
        refreshSession
      }}
    >
      {children}
    </AuthContext.Provider>
  )
}

export const useAuth = () => {
  const context = useContext(AuthContext)
  if (context === undefined) {
    throw new Error('useAuth must be used within an AuthProvider')
  }
  return context
}
