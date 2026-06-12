"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Loader2, Mail, Send, Trash2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { useToast } from "@/components/ui/toaster";

interface UserOption {
  id: string;
  name: string | null;
  email: string;
}

interface CompanyOption {
  id: string;
  name: string;
}

interface Subscription {
  id: string;
  user_id: string;
  company_id: string;
  active: boolean;
  created_at: string;
  user_name: string | null;
  user_email: string;
  company_name: string;
}

interface Props {
  users: UserOption[];
  companies: CompanyOption[];
}

export function BiSubscriptionsClient({ users, companies }: Props) {
  const { showToast } = useToast();
  const [subscriptions, setSubscriptions] = useState<Subscription[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [selectedUser, setSelectedUser] = useState<string>("");
  const [selectedCompanies, setSelectedCompanies] = useState<Set<string>>(new Set());
  const [sendingId, setSendingId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/bi-subscriptions");
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Erro ao carregar assinaturas.");
      setSubscriptions((data.subscriptions as Subscription[]).filter((s) => s.active));
    } catch (err) {
      showToast({
        title: "Erro",
        description: err instanceof Error ? err.message : "Erro ao carregar assinaturas.",
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  }, [showToast]);

  useEffect(() => {
    void load();
  }, [load]);

  // Empresas que o usuario selecionado ainda nao assina.
  const availableCompanies = useMemo(() => {
    if (!selectedUser) return companies;
    const already = new Set(
      subscriptions.filter((s) => s.user_id === selectedUser).map((s) => s.company_id),
    );
    return companies.filter((c) => !already.has(c.id));
  }, [companies, subscriptions, selectedUser]);

  function toggleCompany(id: string) {
    setSelectedCompanies((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function handleAdd() {
    if (!selectedUser || selectedCompanies.size === 0) return;
    setSaving(true);
    try {
      const res = await fetch("/api/bi-subscriptions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ user_id: selectedUser, company_ids: Array.from(selectedCompanies) }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Erro ao salvar.");
      showToast({ title: "Assinatura adicionada", description: "O gestor receberá o relatório no dia 5 de cada mês." });
      setSelectedCompanies(new Set());
      await load();
    } catch (err) {
      showToast({
        title: "Erro",
        description: err instanceof Error ? err.message : "Erro ao salvar.",
        variant: "destructive",
      });
    } finally {
      setSaving(false);
    }
  }

  async function handleSendNow(s: Subscription) {
    setSendingId(s.id);
    try {
      const res = await fetch("/api/bi-subscriptions/send", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: s.id }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Erro ao enviar.");
      showToast({
        title: "Relatório enviado",
        description: `Enviado para ${s.user_email} (${s.company_name}).`,
        variant: "success",
      });
    } catch (err) {
      showToast({
        title: "Erro ao enviar",
        description: err instanceof Error ? err.message : "Erro ao enviar.",
        variant: "destructive",
      });
    } finally {
      setSendingId(null);
    }
  }

  async function handleRemove(id: string) {
    try {
      const res = await fetch("/api/bi-subscriptions", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Erro ao remover.");
      setSubscriptions((prev) => prev.filter((s) => s.id !== id));
    } catch (err) {
      showToast({
        title: "Erro",
        description: err instanceof Error ? err.message : "Erro ao remover.",
        variant: "destructive",
      });
    }
  }

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Relatórios BI</h1>
        <p className="text-sm text-muted-foreground">
          Defina quais usuários recebem por email o relatório mensal de Business Intelligence de cada
          unidade. O envio acontece automaticamente no dia 5, referente ao mês anterior.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Nova assinatura</CardTitle>
          <CardDescription>Escolha o usuário e as unidades cujo relatório ele deve receber.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="max-w-md">
            <Select
              value={selectedUser}
              onValueChange={(v) => {
                setSelectedUser(v);
                setSelectedCompanies(new Set());
              }}
            >
              <SelectTrigger>
                <SelectValue placeholder="Selecione o usuário" />
              </SelectTrigger>
              <SelectContent>
                {users.map((u) => (
                  <SelectItem key={u.id} value={u.id}>
                    {u.name ? `${u.name} — ${u.email}` : u.email}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {selectedUser && (
            <div className="flex flex-wrap gap-2">
              {availableCompanies.length === 0 && (
                <p className="text-sm text-muted-foreground">
                  Este usuário já assina todas as unidades.
                </p>
              )}
              {availableCompanies.map((c) => {
                const checked = selectedCompanies.has(c.id);
                return (
                  <button
                    key={c.id}
                    type="button"
                    onClick={() => toggleCompany(c.id)}
                    className={
                      checked
                        ? "rounded-full border border-primary bg-primary px-3 py-1 text-xs font-medium text-primary-foreground"
                        : "rounded-full border border-input bg-background px-3 py-1 text-xs font-medium text-foreground hover:bg-accent"
                    }
                  >
                    {c.name}
                  </button>
                );
              })}
            </div>
          )}

          <Button onClick={handleAdd} disabled={!selectedUser || selectedCompanies.size === 0 || saving}>
            {saving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Mail className="mr-2 h-4 w-4" />}
            Adicionar assinatura
          </Button>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Assinaturas ativas</CardTitle>
          <CardDescription>
            {loading ? "Carregando..." : `${subscriptions.length} assinatura(s) ativa(s).`}
          </CardDescription>
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="flex items-center justify-center py-8 text-muted-foreground">
              <Loader2 className="h-5 w-5 animate-spin" />
            </div>
          ) : subscriptions.length === 0 ? (
            <p className="py-4 text-sm text-muted-foreground">
              Nenhuma assinatura cadastrada. Ninguém receberá o relatório mensal até que uma assinatura
              seja criada.
            </p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Usuário</TableHead>
                  <TableHead>Email</TableHead>
                  <TableHead>Unidade</TableHead>
                  <TableHead className="w-44 text-right">Ações</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {subscriptions.map((s) => (
                  <TableRow key={s.id}>
                    <TableCell className="font-medium">{s.user_name ?? "—"}</TableCell>
                    <TableCell className="text-muted-foreground">{s.user_email}</TableCell>
                    <TableCell>{s.company_name}</TableCell>
                    <TableCell className="text-right">
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => void handleSendNow(s)}
                        disabled={sendingId !== null}
                        title="Gera e envia agora o relatório do mês anterior para este gestor"
                      >
                        {sendingId === s.id ? (
                          <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" />
                        ) : (
                          <Send className="mr-2 h-3.5 w-3.5" />
                        )}
                        Enviar agora
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => void handleRemove(s.id)}
                        disabled={sendingId !== null}
                        title="Remover assinatura"
                      >
                        <Trash2 className="h-4 w-4 text-destructive" />
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
