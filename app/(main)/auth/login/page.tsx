import { createServerClient } from '@supabase/ssr'
import { cookies } from 'next/headers'
import { redirect } from 'next/navigation'
import LoginForm from '@/components/auth/login-form'

export default async function LoginPage() {
  const cookieStore = await cookies()
  const supabase = createServerClient(
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

  const {
    data: { session },
  } = await supabase.auth.getSession()

  if (session) {
    redirect('/admin')
  }

  return <LoginForm />
}
