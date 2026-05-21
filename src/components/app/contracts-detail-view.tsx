'use client'

import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { Fragment, useMemo, useState, useTransition } from 'react'
import { ArrowDown, ArrowUp, ArrowUpDown, ChevronDown, ChevronRight } from 'lucide-react'

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
  assinatura_contratante: string | null
  assinatura_contratado: string | null
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

// Custom className overrides so the badge palette matches the user's mental
// model (green = good, yellow = needs attention) instead of the default
// shadcn variants.
const STATUS_CLASS: Record<string, string> = {
  aprovada: 'bg-emerald-500 hover:bg-emerald-500 text-white border-transparent',
  analise_especialista:
    'bg-amber-500 hover:bg-amber-500 text-white border-transparent',
}

// Numeric weight for sorting by Status — keeps the most actionable items
// (errors, reprovadas) at the top when sorting ascending.
const STATUS_RANK: Record<string, number> = {
  erro: 0,
  reprovada: 1,
  analise_especialista: 2,
  pending: 3,
  processing: 4,
  aprovada: 5,
}

type SortKey =
  | 'requisicao_codigo'
  | 'status'
  | 'fornecedor'
  | 'valor'
  | 'docs'
type SortDir = 'asc' | 'desc'

// One row per requisition (the unit of validation). Documents are kept
// inside so the user can expand and inspect each one.
interface RequisitionRow {
  requisicao_codigo: string
  fornecedor: string | null
  favorecido: string | null
  cpf_cnpj: string | null
  valor: number | string | null
  status: string
  status_resumo: string | null
  motivos: string[]
  tipos: string[]
  ai_credits: number
  ultima_atualizacao: string | null
  documentos: Item[]
}

function groupByRequisicao(items: Item[]): RequisitionRow[] {
  const map = new Map<string, RequisitionRow>()
  for (const it of items) {
    let row = map.get(it.requisicao_codigo)
    if (!row) {
      row = {
        requisicao_codigo: it.requisicao_codigo,
        fornecedor: it.fornecedor,
        favorecido: it.favorecido,
        cpf_cnpj: it.cpf_cnpj,
        valor: it.valor,
        status: it.status,
        status_resumo: it.status_resumo,
        motivos: it.status_motivos ?? [],
        tipos: [],
        ai_credits: 0,
        ultima_atualizacao: it.processed_at,
        documentos: [],
      }
      map.set(it.requisicao_codigo, row)
    }
    row.documentos.push(it)
    if (it.tipo_documento && !row.tipos.includes(it.tipo_documento)) {
      row.tipos.push(it.tipo_documento)
    }
    const credits = Number(it.ai_credits) || 0
    row.ai_credits += credits
    if (it.processed_at && (!row.ultima_atualizacao || it.processed_at > row.ultima_atualizacao)) {
      row.ultima_atualizacao = it.processed_at
    }
  }
  return Array.from(map.values())
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
  const [sortKey, setSortKey] = useState<SortKey>('status')
  const [sortDir, setSortDir] = useState<SortDir>('asc')
  const [expanded, setExpanded] = useState<Set<string>>(new Set())
  const [, startTransition] = useTransition()

  function toggleExpand(reqCodigo: string) {
    setExpanded((prev) => {
      const next = new Set(prev)
      if (next.has(reqCodigo)) next.delete(reqCodigo)
      else next.add(reqCodigo)
      return next
    })
  }

  function toggleSort(key: SortKey) {
    if (key === sortKey) {
      setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'))
    } else {
      setSortKey(key)
      setSortDir('asc')
    }
  }

  const filtered = useMemo(() => {
    const rows = groupByRequisicao(items)
    const term = search.trim().toLowerCase()
    const filteredRows = rows.filter((r) => {
      if (filterStatus !== 'all' && r.status !== filterStatus) return false
      if (!term) return true
      return (
        r.requisicao_codigo.toLowerCase().includes(term) ||
        (r.fornecedor ?? '').toLowerCase().includes(term) ||
        (r.favorecido ?? '').toLowerCase().includes(term) ||
        (r.status_resumo ?? '').toLowerCase().includes(term) ||
        r.motivos.some((m) => m.toLowerCase().includes(term))
      )
    })

    const direction = sortDir === 'asc' ? 1 : -1
    const sortValue = (r: RequisitionRow): string | number => {
      switch (sortKey) {
        case 'requisicao_codigo':
          return r.requisicao_codigo
        case 'status':
          return STATUS_RANK[r.status] ?? 99
        case 'fornecedor':
          return (r.fornecedor ?? r.favorecido ?? '').toLowerCase()
        case 'valor':
          return Number(r.valor) || 0
        case 'docs':
          return r.documentos.length
      }
    }

    return [...filteredRows].sort((a, b) => {
      const va = sortValue(a)
      const vb = sortValue(b)
      const aEmpty = va === '' || va === 0
      const bEmpty = vb === '' || vb === 0
      if (aEmpty !== bEmpty) return aEmpty ? 1 : -1
      if (va < vb) return -1 * direction
      if (va > vb) return 1 * direction
      return 0
    })
  }, [items, filterStatus, search, sortKey, sortDir])

  function SortableHead({
    column,
    children,
    align,
  }: {
    column: SortKey
    children: React.ReactNode
    align?: 'left' | 'right'
  }) {
    const active = sortKey === column
    const Icon = !active ? ArrowUpDown : sortDir === 'asc' ? ArrowUp : ArrowDown
    return (
      <TableHead className={align === 'right' ? 'text-right' : undefined}>
        <button
          type="button"
          onClick={() => toggleSort(column)}
          className={`inline-flex items-center gap-1 hover:text-foreground ${
            active ? 'text-foreground' : 'text-muted-foreground'
          }`}
        >
          {children}
          <Icon className="h-3 w-3" />
        </button>
      </TableHead>
    )
  }

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
                    <TableHead className="w-8"></TableHead>
                    <SortableHead column="requisicao_codigo">Req</SortableHead>
                    <SortableHead column="status">Status</SortableHead>
                    <SortableHead column="fornecedor">Fornecedor</SortableHead>
                    <SortableHead column="valor" align="right">Valor</SortableHead>
                    <SortableHead column="docs" align="right">Docs</SortableHead>
                    <TableHead>Resumo / Motivos</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filtered.map((r) => {
                    const isOpen = expanded.has(r.requisicao_codigo)
                    return (
                      <Fragment key={r.requisicao_codigo}>
                        <TableRow
                          className="cursor-pointer"
                          onClick={() => toggleExpand(r.requisicao_codigo)}
                        >
                          <TableCell className="text-muted-foreground">
                            {isOpen ? (
                              <ChevronDown className="h-3 w-3" />
                            ) : (
                              <ChevronRight className="h-3 w-3" />
                            )}
                          </TableCell>
                          <TableCell className="font-mono text-xs">{r.requisicao_codigo}</TableCell>
                          <TableCell>
                            <Badge
                              variant={STATUS_VARIANT[r.status] ?? 'outline'}
                              className={STATUS_CLASS[r.status]}
                            >
                              {STATUS_LABEL[r.status] ?? r.status}
                            </Badge>
                          </TableCell>
                          <TableCell className="max-w-[240px] truncate text-xs">
                            {r.fornecedor ?? r.favorecido ?? '—'}
                          </TableCell>
                          <TableCell className="text-right text-xs">
                            {formatValor(r.valor)}
                          </TableCell>
                          <TableCell className="text-right text-xs">
                            <Badge variant="outline" className="font-mono">
                              📎 {r.documentos.length}
                            </Badge>
                          </TableCell>
                          <TableCell className="max-w-[480px] text-xs">
                            {r.motivos.length > 0 ? (
                              <ul className="list-disc pl-4">
                                {r.motivos.map((m, i) => (
                                  <li key={i}>{m}</li>
                                ))}
                              </ul>
                            ) : (
                              r.status_resumo ?? '—'
                            )}
                          </TableCell>
                        </TableRow>
                        {isOpen && (
                          <TableRow className="bg-muted/30">
                            <TableCell></TableCell>
                            <TableCell colSpan={6} className="py-3">
                              <div className="space-y-2">
                                <p className="text-xs font-medium text-muted-foreground">
                                  Documentos da requisição
                                </p>
                                <div className="overflow-x-auto">
                                  <Table>
                                    <TableHeader>
                                      <TableRow>
                                        <TableHead className="text-xs">Tipo</TableHead>
                                        <TableHead className="text-xs">Fornecedor (extraído)</TableHead>
                                        <TableHead className="text-xs">CNPJ (extraído)</TableHead>
                                        <TableHead className="text-xs text-right">Valor (extraído)</TableHead>
                                        <TableHead className="text-xs">Assin. contratante</TableHead>
                                        <TableHead className="text-xs">Assin. contratado</TableHead>
                                        <TableHead className="text-xs">Link</TableHead>
                                      </TableRow>
                                    </TableHeader>
                                    <TableBody>
                                      {r.documentos.map((d) => (
                                        <TableRow key={d.id}>
                                          <TableCell className="text-xs">{d.tipo_documento ?? '—'}</TableCell>
                                          <TableCell className="max-w-[160px] truncate text-xs">
                                            {d.extracted_fornecedor ?? '—'}
                                          </TableCell>
                                          <TableCell className="text-xs">{d.extracted_cpf_cnpj ?? '—'}</TableCell>
                                          <TableCell className="text-right text-xs">
                                            {formatValor(d.extracted_valor_contrato)}
                                          </TableCell>
                                          <TableCell className="text-xs">{d.assinatura_contratante ?? '—'}</TableCell>
                                          <TableCell className="text-xs">{d.assinatura_contratado ?? '—'}</TableCell>
                                          <TableCell className="text-xs">
                                            <a
                                              href={d.link_contrato}
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
                              </div>
                            </TableCell>
                          </TableRow>
                        )}
                      </Fragment>
                    )
                  })}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
