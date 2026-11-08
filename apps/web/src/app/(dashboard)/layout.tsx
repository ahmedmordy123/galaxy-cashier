'use client'

import { useEffect } from 'react'
import { useRouter, usePathname } from 'next/navigation'
import { useAuthContext } from '@/contexts/AuthContext'
import { DashboardShell } from '@/components/layout/DashboardShell'
import { UserRole } from '@ims-pro/types'

// Route prefix → allowed roles. First match wins.
const ROUTE_ROLES: Array<{ prefix: string; roles: UserRole[] }> = [
  { prefix: '/staff/advances', roles: ['ADMIN', 'MANAGER', 'ACCOUNTANT'] },
  { prefix: '/staff',          roles: ['ADMIN'] },
  { prefix: '/settings',       roles: ['ADMIN'] },
  { prefix: '/warehouses',     roles: ['ADMIN', 'MANAGER'] },
  { prefix: '/shifts',         roles: ['ADMIN', 'MANAGER', 'CASHIER', 'STAFF'] },
  { prefix: '/labels',         roles: ['ADMIN', 'MANAGER', 'STAFF'] },
  { prefix: '/serials',        roles: ['ADMIN', 'MANAGER', 'STAFF'] },
  { prefix: '/reports',        roles: ['ADMIN', 'MANAGER', 'ACCOUNTANT', 'VIEWER'] },
  { prefix: '/purchases',      roles: ['ADMIN', 'MANAGER', 'ACCOUNTANT'] },
  { prefix: '/stock',          roles: ['ADMIN', 'MANAGER'] },
  { prefix: '/inventory',      roles: ['ADMIN', 'MANAGER', 'VIEWER', 'ACCOUNTANT'] },
  { prefix: '/cash-statement', roles: ['ADMIN', 'MANAGER', 'ACCOUNTANT'] },
  { prefix: '/expenses',       roles: ['ADMIN', 'MANAGER', 'ACCOUNTANT'] },
  { prefix: '/vouchers',       roles: ['ADMIN', 'MANAGER', 'ACCOUNTANT'] },
  { prefix: '/suppliers',      roles: ['ADMIN', 'MANAGER', 'ACCOUNTANT'] },
  // /items/new before /items so CASHIER cannot open create form
  { prefix: '/items/new',     roles: ['ADMIN', 'MANAGER', 'STAFF'] },
  { prefix: '/sales',          roles: ['ADMIN', 'MANAGER', 'CASHIER', 'STAFF'] },
  { prefix: '/quotes',         roles: ['ADMIN', 'MANAGER', 'CASHIER', 'STAFF'] },
  { prefix: '/customers',      roles: ['ADMIN', 'MANAGER', 'CASHIER', 'STAFF', 'ACCOUNTANT'] },
  { prefix: '/items',          roles: ['ADMIN', 'MANAGER', 'CASHIER', 'STAFF'] },
]

function isItemEditPath(pathname: string): boolean {
  return /^\/items\/[^/]+\/edit\/?$/.test(pathname)
}

function isAllowed(pathname: string, role: UserRole): boolean {
  if (role === 'CASHIER' && isItemEditPath(pathname)) return false
  const rule = ROUTE_ROLES.find((r) => pathname === r.prefix || pathname.startsWith(r.prefix + '/'))
  if (!rule) return true
  return rule.roles.includes(role)
}

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  const { user, isLoading } = useAuthContext()
  const router = useRouter()
  const pathname = usePathname()

  useEffect(() => {
    if (isLoading) return
    if (!user) { router.replace('/login'); return }
    if (!isAllowed(pathname, user.role)) router.replace('/dashboard')
  }, [user, isLoading, router, pathname])

  if (isLoading || !user || !isAllowed(pathname, user.role)) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50 dark:bg-gray-900">
        <div className="text-gray-400 text-lg">جار التحميل...</div>
      </div>
    )
  }

  const isPrintView = /\/print\/?$/.test(pathname)
  if (isPrintView) {
    return <div className="print-document-root min-h-screen bg-white text-gray-900">{children}</div>
  }

  return <DashboardShell>{children}</DashboardShell>
}
