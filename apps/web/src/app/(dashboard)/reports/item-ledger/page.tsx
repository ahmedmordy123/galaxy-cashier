'use client'

import { Suspense } from 'react'
import ItemLedgerInner from './ItemLedgerInner'

export default function ItemLedgerPage() {
  return (
    <Suspense fallback={<div dir="rtl" className="p-4">جار التحميل...</div>}>
      <ItemLedgerInner />
    </Suspense>
  )
}
