'use client'

import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { useRef, useState, useTransition } from 'react'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
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
  completed_at: string | null
  error_message: string | null
}

interface Company {
  id: string
  name: string
}

const STATUS_LABEL: Record<string, string> = {
  pending: 'Aguardando',
  processing: 'Processando',
  completed: 'Concluído',
  failed: 'Falhou',
}

const STATUS_VARIANT: Record<string, 'default' | 'secondary' | 'destructive' | 'outline'> = {
  pending: 'outline',
  processing: 'secondary',
  completed: 'default',
  failed: 'destructive',
}

function formatDateTime(iso: string | null): string {
  if (!iso) return '—'
  try {
    return new Date(iso).toLocaleString('pt-BR')
  } catch {
    return iso
  }
}

export function ContractsListView({
  batches,
  companies,
}: {
  batches: Batch[]
  companies: Company[]
}) {
  const router = useRouter()
  const { showToast } = useToast()
  const [open, setOpen] = useState(false)
  const [uploading, setUploading] = useState(false)
  const [name, setName] = useState('')
  const [companyId, setCompanyId] = useState(companies[0]?.id ?? '')
  const fileRef = useRef<HTMLInputElement>(null)
  const [, startTransition] = useTransition()

  async function handleUpload(e: React.FormEvent) {
    e.preventDefault()
    const file = fileRef.current?.files?.[0]
    if (!file) {
      showToast({ title: 'Arquivo obrigatório', description: 'Selecione um .xlsx.' })
      return
    }
    setUploading(true)
    try {
      const formData = new FormData()
      formData.append('file', file)
      if (name) formData.append('name', name)
      if (companyId) formData.append('company_id', companyId)

      const res = await fetch('/api/contracts/batches', { method: 'POST', body: formData })
      const payload = await res.json()
      if (!res.ok) throw new Error(payload.error ?? 'Falha no upload')

      showToast({
        title: 'Lote criado',
        description: `${payload.total_items} requisições enviadas para validação.`,
      })
      setOpen(false)
      setName('')
      if (fileRef.current) fileRef.current.value = ''
      startTransition(() => router.refresh())
    } catch (err) {
      showToast({
        title: 'Erro no upload',
        description: (err as Error).message,
        variant: 'destructive',
      })
    } finally {
      setUploading(false)
    }
  }

  const canCreate = companies.length > 0

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h2 className="text-2xl font-semibold">Validação de Contratos</h2>
          <p className="text-sm text-muted-foreground">
            Faça o upload da planilha de requisições e o sistema valida cada contrato
            via LandingAI + Gemini, comparando os dados extraídos com a requisição.
          </p>
        </div>
        <Button onClick={() => setOpen(true)} disabled={!canCreate}>
          Novo lote
        </Button>
      </div>

      {!canCreate && (
        <Card>
          <CardHeader>
            <CardTitle>Recurso desabilitado</CardTitle>
            <CardDescription>
              Nenhuma empresa está marcada como habilitada para validação de contratos.
              Ative a flag <code>contract_validation_enabled</code> em pelo menos uma empresa.
            </CardDescription>
          </CardHeader>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle>Lotes recentes</CardTitle>
          <CardDescription>Últimos 100 lotes enviados.</CardDescription>
        </CardHeader>
        <CardContent>
          {batches.length === 0 ? (
            <p className="text-sm text-muted-foreground">Nenhum lote ainda.</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Nome</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Itens</TableHead>
                  <TableHead className="text-right">Aprov.</TableHead>
                  <TableHead className="text-right">Reprov.</TableHead>
                  <TableHead className="text-right">Erros</TableHead>
                  <TableHead className="text-right">Esp.</TableHead>
                  <TableHead className="text-right">Créditos</TableHead>
                  <TableHead>Criado</TableHead>
                  <TableHead>Concluído</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {batches.map((b) => (
                  <TableRow
                    key={b.id}
                    className="cursor-pointer"
                    onClick={() => router.push(`/contratos/${b.id}`)}
                  >
                    <TableCell className="font-medium">
                      <Link href={`/contratos/${b.id}`} className="hover:underline">
                        {b.name}
                      </Link>
                    </TableCell>
                    <TableCell>
                      <Badge variant={STATUS_VARIANT[b.status] ?? 'outline'}>
                        {STATUS_LABEL[b.status] ?? b.status}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-right">{b.total_items}</TableCell>
                    <TableCell className="text-right text-emerald-600">
                      {b.items_approved}
                    </TableCell>
                    <TableCell className="text-right text-red-600">{b.items_reproved}</TableCell>
                    <TableCell className="text-right">{b.items_failed}</TableCell>
                    <TableCell className="text-right">{b.items_specialist}</TableCell>
                    <TableCell className="text-right">
                      {Number(b.ai_credits_used).toFixed(2)}
                    </TableCell>
                    <TableCell className="text-xs">{formatDateTime(b.created_at)}</TableCell>
                    <TableCell className="text-xs">{formatDateTime(b.completed_at)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Novo lote de validação</DialogTitle>
            <DialogDescription>
              A planilha deve conter as colunas: REQUISIÇÃO, Fornecedor, Favorecido,
              CPF/CNPJ, Conta, valor, Link do Contrato.
            </DialogDescription>
          </DialogHeader>
          <form onSubmit={handleUpload} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="batch-name">Nome (opcional)</Label>
              <Input
                id="batch-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Ex: Contratos Maio/2026"
              />
            </div>
            {companies.length > 1 && (
              <div className="space-y-2">
                <Label>Empresa</Label>
                <Select value={companyId} onValueChange={setCompanyId}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {companies.map((c) => (
                      <SelectItem key={c.id} value={c.id}>
                        {c.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}
            <div className="space-y-2">
              <Label htmlFor="batch-file">Planilha (.xlsx)</Label>
              <Input id="batch-file" type="file" accept=".xlsx,.xls" ref={fileRef} required />
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setOpen(false)}>
                Cancelar
              </Button>
              <Button type="submit" disabled={uploading}>
                {uploading ? 'Enviando…' : 'Enviar'}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  )
}
