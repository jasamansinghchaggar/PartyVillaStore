import { createServerClient as createSsrServerClient } from '@supabase/ssr'
import { createClient as createSupabaseClient } from '@supabase/supabase-js'
import { createGenericClient } from './supabase'
import type { Database } from './database.types'

// For use in server components and route handlers
export const createServerClient_NextJs = async () => {
  // Import only when called (server context)
  const { cookies } = await import('next/headers')

  try {
    const cookieStore = await cookies()

    const client = createSsrServerClient<Database>(
      process.env.NEXT_PUBLIC_SUPABASE_URL || '',
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || '',
      {
        cookies: {
          getAll() {
            return cookieStore.getAll()
          },
          setAll(cookiesToSet) {
            try {
              cookiesToSet.forEach(({ name, value, options }) => {
                cookieStore.set(name, value, options)
              })
            } catch {
              // cookies() is read-only in some contexts
            }
          },
        },
      }
    )

    return client
  } catch (e) {
    console.error('[Supabase] Server client creation failed', e)
    // Fallback for non-server environments
    return createGenericClient()
  }
}

// Backward compatibility - createServerClient is now async
export const createServerClient = createServerClient_NextJs

// For use in API route handlers (backwards compatible name)
export const createRouteHandler = createServerClient_NextJs

// Create server client only when needed
export const getServerClient = () => createServerClient_NextJs()

// For admin operations that require service role key
export function createAdminClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY

  if (!url || !serviceKey) {
    throw new Error('NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY env variables are required for admin operations!')
  }

  return createSupabaseClient<Database>(url, serviceKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false
    }
  })
}
