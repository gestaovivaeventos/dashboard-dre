import { redirect } from 'next/navigation'

import { ContractsListView } from '@/components/app/contracts-list-view'
import { getCurrentSessionContext } from '@/lib/auth/session'

export const dynamic = 'force-dynamic'

export default async function ContratosPage() {
  const { supabase, user, profile } = await getCurrentSessionContext()
  if (!user) redirect('/login')
  if (!profile || (profile.role !== 'admin' && profile.role !== 'gestor_hero')) {
    redirect('/dashboard')
  }

  const [{ data: batches }, { data: companies }] = await Promise.all([
    supabase
      .from('contract_validation_batches')
      .select(
        'id, name, status, total_items, items_approved, items_reproved, items_failed, items_specialist, ai_credits_used, created_at, completed_at, error_message',
      )
      .order('created_at', { ascending: false })
      .limit(100),
    supabase
      .from('companies')
      .select('id, name')
      .eq('contract_validation_enabled', true)
      .eq('active', true)
      .order('name'),
  ])

  return (
    <ContractsListView
      batches={batches ?? []}
      companies={companies ?? []}
    />
  )
}
