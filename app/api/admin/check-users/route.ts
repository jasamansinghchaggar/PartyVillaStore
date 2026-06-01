import { createAdminClient } from '@/lib/database/supabase-server'
import { NextResponse } from 'next/server'
import type { Database } from "@/lib/database/database.types"

export async function GET() {
  try {
    const supabase = createAdminClient()

    // Check for existing users
    const { data, error } = await supabase.auth.admin.listUsers()

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 })
    }

    return NextResponse.json({
      userCount: data?.users?.length || 0
    })
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to check users' },
      { status: 500 }
    )
  }
}
