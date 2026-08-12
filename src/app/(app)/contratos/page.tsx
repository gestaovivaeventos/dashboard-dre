import { redirect } from 'next/navigation'

import { ContractsListView } from '@/components/app/contracts-list-view'
import { getCurrentSessionContext } from '@/lib/auth/session'
import { createAdminClientIfAvailable } from '@/lib/supabase/admin'

export const dynamic = 'force-dynamic'

export default async function ContratosPage() {
  const { supabase, user, profile } = await getCurrentSessionContext()
  if (!user) redirect('/login')
  // Acesso pelo MÓDULO Validação de Contratos (ver @/lib/auth/contratos) —
  // admin e o perfil validador já entram por ele.
  if (!profile || profile.can_contratos !== true) {
    redirect('/dashboard')
  }

  // As policies das tabelas de contrato só reconhecem admin/gestor_hero, e o
  // módulo agora pode ser concedido a qualquer perfil. Lê com service role
  // (mesmo padrão de /api/contracts/batches) — a permissão já foi checada
  // acima, no middleware e no menu.
  const db = createAdminClientIfAvailable() ?? supabase

  const [{ data: batches }, { data: companies }] = await Promise.all([
    db
      .from('contract_validation_batches')
      .select(
        'id, name, status, total_items, items_approved, items_reproved, items_failed, items_specialist, items_verificar_saldo, ai_credits_used, created_at, completed_at, error_message',
      )
      .order('created_at', { ascending: false })
      .limit(100),
    db
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
