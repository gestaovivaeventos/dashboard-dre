'use client'

import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useMemo, useState, useTransition } from 'react'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { useToast } from '@/components/ui/toaster'

interface Batch {
  id: string
  name: string
  status: string
  total_items: number
  items_approved: number
  items_reproved: number
  items_failed: number
  items_specialist: number
  ai_credits_used: number | string
  created_at: string
  started_at: string | null
  completed_at: string | null
  error_message: string | null
}

interface Item {
  id: string
  requisicao_codigo: string
  fornecedor: string | null
  favorecido: string | null
  cpf_cnpj: string | null
  conta: string | null
  valor: number | string | null
  link_contrato: string
  tipo_documento: string | null
  data_baile: string | null
  extracted_fornecedor: string | null
  extracted_cpf_cnpj: string | null
  extracted_conta: string | null
  extracted_valor_contrato: number | string | null
  status: string
  status_motivos: string[] | null
  status_resumo: string | null
  ai_credits: number | string
  error_log: string | null
  processed_at: string | null
}

const STATUS_LABEL: Record<string, string> = {
  pending: 'Aguardando',
  processing: 'Processando',
  aprovada: 'Aprovada',
  reprovada: 'Reprovada',
  analise_especialista: 'Análise especialista',
  erro: 'Erro',
}

const STATUS_VARIANT: Record<string, 'default' | 'secondary' | 'destructive' | 'outline'> = {
  pending: 'outline',
  processing: 'secondary',
  aprovada: 'default',
  reprovada: 'destructive',
  analise_especialista: 'secondary',
  erro: 'destructive',
}

function formatDateTime(iso: string | null): string {
  if (!iso) return '—'
  try {
    return new Date(iso).toLocaleString('pt-BR')
  } catch {
    return iso
  }
}

function formatValor(v: number | string | null): string {
  if (v === null || v === undefined || v === '') return '—'
  const num = Number(v)
  if (!Number.isFinite(num)) return String(v)
  return num.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
}

export function ContractsDetailView({ batch, items }: { batch: Batch; items: Item[] }) {
  const router = useRouter()
  const { showToast } = useToast()
  const [filterStatus, setFilterStatus] = useState<string>('all')
  const [search, setSearch] = useState('')
  const [running, setRunning] = useState(false)
  const [, startTransition] = useTransition()

  const filtered = useMemo(() => {
    const term = search.trim().toLowerCase()
    return items.filter((it) => {
      if (filterStatus !== 'all' && it.status !== filterStatus) return false
      if (!term) return true
      return (
        it.requisicao_codigo.toLowerCase().includes(term) ||
        (it.fornecedor ?? '').toLowerCase().includes(term) ||
        (it.favorecido ?? '').toLowerCase().includes(term) ||
        (it.status_resumo ?? '').toLowerCase().includes(term)
      )
    })
  }, [items, filterStatus, search])

  const isRunning = batch.status === 'processing' || batch.status === 'pending'

  async function refresh() {
    startTransition(() => router.refresh())
  }

  async function runNow() {
    setRunning(true)
    try {
      const res = await fetch('/api/contracts/batches/' + batch.id + '/run', {
        method: 'POST',
      })
      const payload = await res.json()
      if (!res.ok) throw new Error(payload.error ?? 'Falha ao processar')
      const remaining = (batch.total_items ?? 0) - (payload.extracted ?? 0)
      showToast({
        title: 'Fatia processada',
        description:
          payload.status === 'completed'
            ? `Lote concluído: ${payload.extracted} extraídos, ${payload.validated} validados.`
            : `${payload.extracted} extraídos. O cron continua o restante automaticamente (~2 min).`,
      })
      void remaining
      await refresh()
    } catch (err) {
      showToast({
        title: 'Erro',
        description: (err as Error).message,
        variant: 'destructive',
      })
    } finally {
      setRunning(false)
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h2 className="text-2xl font-semibold">{batch.name}</h2>
          <p className="text-sm text-muted-foreground">
            <Link href="/contratos" className="hover:underline">
              ← Voltar
            </Link>
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" onClick={refresh}>
            Atualizar
          </Button>
          <Button onClick={runNow} disabled={running || !isRunning}>
            {running ? 'Disparando…' : 'Processar agora'}
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3 md:grid-cols-6">
        <Card>
          <CardHeader className="pb-2">
            <CardDescription>Total</CardDescription>
            <CardTitle className="text-2xl">{batch.total_items}</CardTitle>
          </CardHeader>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardDescription>Status</CardDescription>
            <CardTitle className="text-lg">
              <Badge variant={STATUS_VARIANT[batch.status] ?? 'outline'}>
                {STATUS_LABEL[batch.status] ?? batch.status}
              </Badge>
            </CardTitle>
          </CardHeader>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardDescription>Aprovadas</CardDescription>
            <CardTitle className="text-2xl text-emerald-600">{batch.items_approved}</CardTitle>
          </CardHeader>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardDescription>Reprovadas</CardDescription>
            <CardTitle className="text-2xl text-red-600">{batch.items_reproved}</CardTitle>
          </CardHeader>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardDescription>Erros / Especialista</CardDescription>
            <CardTitle className="text-2xl">
              {batch.items_failed} / {batch.items_specialist}
            </CardTitle>
          </CardHeader>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardDescription>Créditos LandingAI</CardDescription>
            <CardTitle className="text-2xl">
              {Number(batch.ai_credits_used).toFixed(2)}
            </CardTitle>
          </CardHeader>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Itens</CardTitle>
          <CardDescription>
            Criado em {formatDateTime(batch.created_at)} · Concluído em{' '}
            {formatDateTime(batch.completed_at)}
          </CardDescription>
          <div className="flex flex-wrap gap-2 pt-3">
            <Input
              placeholder="Buscar por requisição, fornecedor, motivo…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="max-w-xs"
            />
            <Select value={filterStatus} onValueChange={setFilterStatus}>
              <SelectTrigger className="w-48">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Todos os status</SelectItem>
                <SelectItem value="pending">Aguardando</SelectItem>
                <SelectItem value="processing">Processando</SelectItem>
                <SelectItem value="aprovada">Aprovadas</SelectItem>
                <SelectItem value="reprovada">Reprovadas</SelectItem>
                <SelectItem value="analise_especialista">Especialista</SelectItem>
                <SelectItem value="erro">Erros</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </CardHeader>
        <CardContent>
          {filtered.length === 0 ? (
            <p className="text-sm text-muted-foreground">Nada para mostrar.</p>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Req</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Tipo</TableHead>
                    <TableHead>Fornecedor (req)</TableHead>
                    <TableHead>Fornecedor (doc)</TableHead>
                    <TableHead className="text-right">Valor (req)</TableHead>
                    <TableHead className="text-right">Valor (doc)</TableHead>
                    <TableHead>Resumo</TableHead>
                    <TableHead>Contrato</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filtered.map((it) => (
                    <TableRow key={it.id}>
                      <TableCell className="font-mono text-xs">{it.requisicao_codigo}</TableCell>
                      <TableCell>
                        <Badge variant={STATUS_VARIANT[it.status] ?? 'outline'}>
                          {STATUS_LABEL[it.status] ?? it.status}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-xs">{it.tipo_documento ?? '—'}</TableCell>
                      <TableCell className="max-w-[200px] truncate text-xs">
                        {it.fornecedor ?? it.favorecido ?? '—'}
                      </TableCell>
                      <TableCell className="max-w-[200px] truncate text-xs">
                        {it.extracted_fornecedor ?? '—'}
                      </TableCell>
                      <TableCell className="text-right text-xs">
                        {formatValor(it.valor)}
                      </TableCell>
                      <TableCell className="text-right text-xs">
                        {formatValor(it.extracted_valor_contrato)}
                      </TableCell>
                      <TableCell className="max-w-[320px] text-xs">
                        {it.status_resumo ?? it.error_log ?? '—'}
                      </TableCell>
                      <TableCell className="text-xs">
                        <a
                          href={it.link_contrato}
                          target="_blank"
                          rel="noreferrer"
                          className="text-primary hover:underline"
                        >
                          abrir
                        </a>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
