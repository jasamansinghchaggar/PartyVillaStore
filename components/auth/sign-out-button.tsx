"use client"

import { useSupabase } from '@/hooks/use-supabase'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/button'

export function SignOutButton() {
  const router = useRouter()
  const supabase = useSupabase()

  const handleSignOut = async () => {
    try {
      if (!supabase) {
        console.error('[Auth] Supabase client not initialized')
        return
      }
      await supabase.auth.signOut()
      router.refresh()
      router.push('/auth/login')
    } catch (error) {
      console.error('[Auth] Sign out failed:', error)
    }
  }

  return (
    <Button variant="ghost" onClick={handleSignOut}>
      Sign out
    </Button>
  )
}
