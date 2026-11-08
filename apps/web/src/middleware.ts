import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'

const PUBLIC_PATHS = ['/login']

function safeNextPath(raw: string | null): string | null {
  if (!raw) return null
  if (!raw.startsWith('/') || raw.startsWith('//')) return null
  if (raw.startsWith('/login')) return null
  return raw
}

export function middleware(request: NextRequest) {
  const { pathname, search } = request.nextUrl
  const hasRefreshCookie = request.cookies.has('__refresh_token')

  if (PUBLIC_PATHS.some((p) => pathname.startsWith(p))) {
    if (hasRefreshCookie) {
      const next = safeNextPath(request.nextUrl.searchParams.get('next'))
      return NextResponse.redirect(new URL(next || '/dashboard', request.url))
    }
    return NextResponse.next()
  }

  if (!hasRefreshCookie) {
    const loginUrl = new URL('/login', request.url)
    const dest = `${pathname}${search || ''}`
    if (dest && dest !== '/') loginUrl.searchParams.set('next', dest)
    return NextResponse.redirect(loginUrl)
  }

  return NextResponse.next()
}

export const config = {
  matcher: ['/((?!api|_next/static|_next/image|favicon.ico).*)'],
}
