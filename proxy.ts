import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'
import { createServerClient } from '@supabase/ssr'

// Load admin emails from environment variables for better security
const ADMIN_EMAILS: string[] = process.env.ADMIN_EMAILS
  ? process.env.ADMIN_EMAILS.split(',').map(email => email.trim())
  : [
    // Fallback for development - remove in production
    "partyvilla.store@gmail.com"
  ]

export async function proxy(req: NextRequest) {
  let res = NextResponse.next()

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL || '',
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || '',
    {
      cookies: {
        get(name: string) {
          return req.cookies.get(name)?.value
        },
        set(name: string, value: string, options: any) {
          res.cookies.set(name, value, options)
        },
        remove(name: string, options: any) {
          res.cookies.delete(name)
        },
      },
    }
  )

  // Add security headers to all responses
  const secureHeaders = {
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'DENY',
    'X-XSS-Protection': '1; mode=block',
    'Referrer-Policy': 'strict-origin-when-cross-origin',
    'Permissions-Policy': 'camera=(), microphone=(), geolocation=()',
    'Content-Security-Policy': "default-src 'self'; script-src 'self' 'unsafe-inline' 'unsafe-eval' https://vercel.live https://*.vercel-analytics.com https://va.vercel-scripts.com blob:; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com https://r2cdn.perplexity.ai; img-src 'self' data: blob: https:; font-src 'self' data: https://fonts.gstatic.com https://r2cdn.perplexity.ai; connect-src 'self' https://*.supabase.co https://*.vercel-analytics.com https://vitals.vercel-insights.com; frame-src 'self'; object-src 'none';"
  }

  Object.entries(secureHeaders).forEach(([key, value]) => {
    res.headers.set(key, value)
  })

  // Only check session for protected routes to minimize API calls
  if (
    req.nextUrl.pathname.startsWith('/admin') ||
    req.nextUrl.pathname === '/account' ||
    req.nextUrl.pathname.startsWith('/auth')
  ) {
    try {
      const {
        data: { session },
      } = await supabase.auth.getSession()

      // Protect admin routes
      if (req.nextUrl.pathname.startsWith('/admin')) {
        if (!session) {
          return NextResponse.redirect(new URL('/auth/login', req.url))
        }

        // Check if user's email is in the admin list
        const isAdmin = ADMIN_EMAILS.includes(session.user.email || '')

        if (!isAdmin) {
          return NextResponse.redirect(new URL('/', req.url))
        }
      }

      // Protect account page
      if (req.nextUrl.pathname === '/account') {
        if (!session) {
          return NextResponse.redirect(new URL('/auth/login', req.url))
        }
      }

      // Redirect to home if logged in and trying to access auth pages
      if (session && (req.nextUrl.pathname === '/auth/login' || req.nextUrl.pathname === '/auth/signup')) {
        return NextResponse.redirect(new URL('/', req.url))
      }
    } catch (error) {
      console.error('[Proxy] Session check failed:', error)
      // On error, redirect to login for protected routes
      if (req.nextUrl.pathname.startsWith('/admin') || req.nextUrl.pathname === '/account') {
        return NextResponse.redirect(new URL('/auth/login', req.url))
      }
    }
  }

  // Protect setup page without checking session to reduce API calls
  if (req.nextUrl.pathname.startsWith('/setup')) {
    return NextResponse.redirect(new URL('/', req.url))
  }

  return res
}

export const config = {
  matcher: [
    '/admin/:path*',
    '/auth/:path*',
    '/setup/:path*',
    '/setup',
    '/account'
  ],
}
