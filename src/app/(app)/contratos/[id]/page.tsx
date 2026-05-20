import { redirect } from 'next/navigation'

import { ContractsDetailView } from '@/components/app/contracts-detail-view'
import { getCurrentSessionContext } from '@/lib/auth/session'

export const dynamic = 'force-dynamic'

interface Params {
  params: { id: string }
}

export default async function ContratoBatchPage({ params }: Params) {
  const { supabase, user, profile } = await getCurrentSessionContext()
  if (!user) redirect('/login')
  if (!profile || (profile.role !== 'admin' && profile.role !== 'gestor_hero')) {
    redirect('/dashboard')
  }

  const { data: batch } = await supabase
    .from('contract_validation_batches')
    .select(
      'id, name, status, total_items, items_approved, items_reproved, items_failed, items_specialist, ai_credits_used, created_at, started_at, completed_at, error_message',
    )
    .eq('id', params.id)
    .maybeSingle()

  if (!batch) redirect('/contratos')

  const { data: items } = await supabase
    .from('contract_validation_items')
    .select(
      'id, requisicao_codigo, fornecedor, favorecido, cpf_cnpj, conta, valor, link_contrato, tipo_documento, data_baile, extracted_fornecedor, extracted_cpf_cnpj, extracted_conta, extracted_valor_contrato, status, status_motivos, status_resumo, ai_credits, error_log, processed_at',
    )
    .eq('batch_id', params.id)
    .order('created_at', { ascending: true })

  return <ContractsDetailView batch={batch} items={items ?? []} />
}
