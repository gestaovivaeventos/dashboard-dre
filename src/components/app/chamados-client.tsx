"use client";

import { useRef, useState } from "react";
import { Eye, Loader2, Paperclip, Plus, X } from "lucide-react";

import {
  addTicketMessage,
  createTicket,
  getTicket,
  getTickets,
  setTicketAssignee,
  setTicketPriority,
  updateTicketStatus,
} from "@/lib/support/actions";
import {
  TICKET_STATUS_LABEL,
  type SupportAdmin,
  type TicketAttachment,
  type TicketCategory,
  type TicketDetail,
  type TicketListItem,
  type TicketMessage,
  type TicketPriority,
  type TicketStatus,
} from "@/lib/support/types";
import {
  MAX_SUPPORT_ATTACHMENT_SIZE,
  uploadSupportAttachment,
  type SupportUpload,
} from "@/lib/support/attachment-upload";

const INPUT_CLS =
  "w-full rounded-md border bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-ring";

const CATEGORY_LABEL: Record<TicketCategory, string> = { melhoria: "Melhoria", bug: "Bug" };
const STATUS_LABEL: Record<TicketStatus, string> = {
  aberto: "Aberto",
  em_analise: "Em análise",
  aguardando_resposta: "Aguardando resposta",
  resolvido: "Resolvido",
  fechado: "Fechado",
};
const PRIORITY_LABEL: Record<TicketPriority, string> = { baixa: "Baixa", media: "Média", alta: "Alta" };

function fmtDate(iso: string): string {
  return new Date(iso).toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit", year: "numeric" });
}

function CategoryBadge({ value }: { value: TicketCategory }) {
  const cls =
    value === "bug"
      ? "bg-red-100 text-red-800 dark:bg-red-950/40 dark:text-red-300"
      : "bg-sky-100 text-sky-800 dark:bg-sky-950/40 dark:text-sky-300";
  return <span className={`inline-flex rounded-full px-2 py-0.5 text-xs font-semibold ${cls}`}>{CATEGORY_LABEL[value]}</span>;
}

function StatusBadge({ value }: { value: TicketStatus }) {
  const map: Record<TicketStatus, string> = {
    aberto: "bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300",
    em_analise: "bg-amber-100 text-amber-800 dark:bg-amber-950/40 dark:text-amber-300",
    aguardando_resposta: "bg-violet-100 text-violet-800 dark:bg-violet-950/40 dark:text-violet-300",
    resolvido: "bg-green-100 text-green-800 dark:bg-green-950/40 dark:text-green-300",
    fechado: "bg-gray-200 text-gray-600 dark:bg-gray-800 dark:text-gray-400",
  };
  return <span className={`inline-flex rounded-full px-2 py-0.5 text-xs font-semibold ${map[value]}`}>{STATUS_LABEL[value]}</span>;
}

function PriorityBadge({ value }: { value: TicketPriority | null }) {
  if (!value) return <span className="text-xs text-muted-foreground">—</span>;
  const map: Record<TicketPriority, string> = {
    baixa: "bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300",
    media: "bg-amber-100 text-amber-800 dark:bg-amber-950/40 dark:text-amber-300",
    alta: "bg-red-100 text-red-800 dark:bg-red-950/40 dark:text-red-300",
  };
  return <span className={`inline-flex rounded-full px-2 py-0.5 text-xs font-semibold ${map[value]}`}>{PRIORITY_LABEL[value]}</span>;
}

export function ChamadosClient({
  initialTickets,
  isAdmin,
  admins,
}: {
  initialTickets: TicketListItem[];
  isAdmin: boolean;
  admins: SupportAdmin[];
}) {
  const [tickets, setTickets] = useState<TicketListItem[]>(initialTickets);

  // Filtros da lista (aplicados no cliente sobre os chamados já carregados).
  const [q, setQ] = useState("");
  const [statusF, setStatusF] = useState<"" | TicketStatus>("");
  const [catF, setCatF] = useState<"" | TicketCategory>("");
  const [prioF, setPrioF] = useState<"" | TicketPriority | "sem">("");
  const [respF, setRespF] = useState<string>(""); // "", "none", ou id do admin

  const filtered = tickets.filter((t) => {
    if (statusF && t.status !== statusF) return false;
    if (catF && t.category !== catF) return false;
    if (prioF === "sem" ? t.priority !== null : prioF && t.priority !== prioF) return false;
    if (respF === "none" ? t.assignee_id !== null : respF && t.assignee_id !== respF) return false;
    if (q.trim()) {
      const term = q.trim().toLowerCase();
      const hay = [
        `#${t.ticket_number}`,
        String(t.ticket_number),
        t.title,
        t.author?.name ?? "",
        t.author?.email ?? "",
      ]
        .join(" ")
        .toLowerCase();
      if (!hay.includes(term)) return false;
    }
    return true;
  });

  // Novo chamado
  const [showNew, setShowNew] = useState(false);
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [category, setCategory] = useState<TicketCategory>("melhoria");
  const [attachments, setAttachments] = useState<SupportUpload[]>([]);
  const [uploading, setUploading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement | null>(null);

  // Detalhe
  const [detailLoading, setDetailLoading] = useState(false);
  const [detail, setDetail] = useState<{
    ticket: TicketDetail;
    attachments: TicketAttachment[];
    messages: TicketMessage[];
  } | null>(null);
  const [detailError, setDetailError] = useState<string | null>(null);
  const [replyText, setReplyText] = useState("");
  const [busy, setBusy] = useState(false); // resposta/status/prioridade em andamento

  async function refresh() {
    const res = await getTickets();
    if ("ok" in res) setTickets(res.tickets);
  }

  async function addFiles(files: FileList | null) {
    setFormError(null);
    if (!files || files.length === 0) return;
    const picked = Array.from(files);
    const tooBig = picked.find((f) => f.size > MAX_SUPPORT_ATTACHMENT_SIZE);
    if (tooBig) {
      setFormError(`"${tooBig.name}" excede o limite de 10 MB.`);
      if (fileRef.current) fileRef.current.value = "";
      return;
    }
    setUploading(true);
    try {
      const uploaded: SupportUpload[] = [];
      for (const f of picked) uploaded.push(await uploadSupportAttachment(f));
      setAttachments((prev) => [...prev, ...uploaded]);
    } catch (e) {
      setFormError(`Falha ao enviar anexo: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  }

  function resetNew() {
    setShowNew(false);
    setTitle("");
    setDescription("");
    setCategory("melhoria");
    setAttachments([]);
    setFormError(null);
  }

  async function submitNew() {
    if (!title.trim() || !description.trim()) return;
    setSubmitting(true);
    setFormError(null);
    const res = await createTicket({ title, description, category, attachments });
    setSubmitting(false);
    if ("error" in res) {
      setFormError(res.error);
      return;
    }
    resetNew();
    await refresh();
  }

  async function openDetail(id: string) {
    setDetailLoading(true);
    setDetailError(null);
    setDetail(null);
    setReplyText("");
    const res = await getTicket(id);
    setDetailLoading(false);
    if ("error" in res) {
      setDetailError(res.error);
      return;
    }
    setDetail({ ticket: res.ticket, attachments: res.attachments, messages: res.messages });
  }

  async function reloadDetail(id: string) {
    const res = await getTicket(id);
    if ("ok" in res) {
      setDetail({ ticket: res.ticket, attachments: res.attachments, messages: res.messages });
    }
  }

  async function sendReply() {
    if (!detail || !replyText.trim()) return;
    setBusy(true);
    const res = await addTicketMessage(detail.ticket.id, replyText);
    setBusy(false);
    if ("error" in res) {
      setDetailError(res.error);
      return;
    }
    setReplyText("");
    await reloadDetail(detail.ticket.id);
    await refresh();
  }

  async function changeStatus(status: TicketStatus) {
    if (!detail) return;
    setBusy(true);
    const res = await updateTicketStatus(detail.ticket.id, status);
    setBusy(false);
    if ("error" in res) {
      setDetailError(res.error);
      return;
    }
    await reloadDetail(detail.ticket.id);
    await refresh();
  }

  async function changePriority(priority: TicketPriority | null) {
    if (!detail) return;
    setBusy(true);
    const res = await setTicketPriority(detail.ticket.id, priority);
    setBusy(false);
    if ("error" in res) {
      setDetailError(res.error);
      return;
    }
    await reloadDetail(detail.ticket.id);
    await refresh();
  }

  async function changeAssignee(assigneeId: string | null) {
    if (!detail) return;
    setBusy(true);
    const res = await setTicketAssignee(detail.ticket.id, assigneeId);
    setBusy(false);
    if ("error" in res) {
      setDetailError(res.error);
      return;
    }
    await reloadDetail(detail.ticket.id);
    await refresh();
  }

  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <button
          type="button"
          onClick={() => setShowNew(true)}
          className="inline-flex items-center gap-2 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90"
        >
          <Plus className="h-4 w-4" />
          Novo chamado
        </button>
      </div>

      {tickets.length === 0 ? (
        <div className="rounded-lg border border-dashed p-12 text-center text-sm text-muted-foreground">
          {isAdmin ? "Nenhum chamado aberto ainda." : "Você ainda não abriu nenhum chamado."}
        </div>
      ) : (
        <>
          {/* Filtros — aplicados no cliente sobre os chamados carregados */}
          <div className="flex flex-wrap items-center gap-2">
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Buscar por código, título ou autor…"
              className="min-w-[220px] flex-1 rounded-md border bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-ring"
            />
            <select value={statusF} onChange={(e) => setStatusF(e.target.value as "" | TicketStatus)} className="rounded-md border bg-background px-2 py-2 text-sm outline-none focus:ring-2 focus:ring-ring">
              <option value="">Status: todos</option>
              {(Object.keys(TICKET_STATUS_LABEL) as TicketStatus[]).map((s) => (
                <option key={s} value={s}>{TICKET_STATUS_LABEL[s]}</option>
              ))}
            </select>
            <select value={catF} onChange={(e) => setCatF(e.target.value as "" | TicketCategory)} className="rounded-md border bg-background px-2 py-2 text-sm outline-none focus:ring-2 focus:ring-ring">
              <option value="">Categoria: todas</option>
              <option value="melhoria">Melhoria</option>
              <option value="bug">Bug</option>
            </select>
            <select value={prioF} onChange={(e) => setPrioF(e.target.value as "" | TicketPriority | "sem")} className="rounded-md border bg-background px-2 py-2 text-sm outline-none focus:ring-2 focus:ring-ring">
              <option value="">Prioridade: todas</option>
              <option value="alta">Alta</option>
              <option value="media">Média</option>
              <option value="baixa">Baixa</option>
              <option value="sem">Sem prioridade</option>
            </select>
            {isAdmin && (
              <select value={respF} onChange={(e) => setRespF(e.target.value)} className="rounded-md border bg-background px-2 py-2 text-sm outline-none focus:ring-2 focus:ring-ring">
                <option value="">Responsável: todos</option>
                <option value="none">Não atribuído</option>
                {admins.map((a) => (
                  <option key={a.id} value={a.id}>{a.name ?? a.email ?? "—"}</option>
                ))}
              </select>
            )}
            {(q || statusF || catF || prioF || respF) && (
              <button
                type="button"
                onClick={() => { setQ(""); setStatusF(""); setCatF(""); setPrioF(""); setRespF(""); }}
                className="inline-flex items-center gap-1 rounded-md border px-2.5 py-2 text-xs font-medium text-muted-foreground hover:bg-muted hover:text-foreground"
              >
                <X className="h-3.5 w-3.5" /> Limpar
              </button>
            )}
          </div>

          {filtered.length === 0 ? (
            <div className="rounded-lg border border-dashed p-10 text-center text-sm text-muted-foreground">
              Nenhum chamado para esse filtro.
            </div>
          ) : (
            <div className="rounded-lg border overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b bg-muted/50 text-left text-xs font-semibold text-muted-foreground">
                    <th className="px-3 py-3">Código</th>
                    <th className="px-3 py-3">Título</th>
                    <th className="px-3 py-3">Categoria</th>
                    <th className="px-3 py-3">Status</th>
                    <th className="px-3 py-3">Prioridade</th>
                    {isAdmin && <th className="px-3 py-3">Autor</th>}
                    {isAdmin && <th className="px-3 py-3">Responsável</th>}
                    <th className="px-3 py-3">Aberto em</th>
                    <th className="px-3 py-3 text-right">Ações</th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {filtered.map((t) => (
                    <tr key={t.id} className="hover:bg-muted/20 transition-colors">
                      <td className="px-3 py-3 font-mono text-muted-foreground whitespace-nowrap">#{t.ticket_number}</td>
                      <td className="px-3 py-3">
                        <p className="line-clamp-1 max-w-[22rem] font-medium" title={t.title}>{t.title}</p>
                      </td>
                      <td className="px-3 py-3"><CategoryBadge value={t.category} /></td>
                      <td className="px-3 py-3"><StatusBadge value={t.status} /></td>
                      <td className="px-3 py-3"><PriorityBadge value={t.priority} /></td>
                      {isAdmin && (
                        <td className="px-3 py-3 text-muted-foreground">
                          <p className="line-clamp-1 max-w-[12rem]" title={t.author?.name ?? t.author?.email ?? ""}>
                            {t.author?.name ?? t.author?.email ?? "—"}
                          </p>
                        </td>
                      )}
                      {isAdmin && (
                        <td className="px-3 py-3 text-muted-foreground">
                          <p className="line-clamp-1 max-w-[12rem]" title={t.assignee?.name ?? t.assignee?.email ?? ""}>
                            {t.assignee?.name ?? t.assignee?.email ?? "—"}
                          </p>
                        </td>
                      )}
                      <td className="px-3 py-3 text-muted-foreground whitespace-nowrap">{fmtDate(t.created_at)}</td>
                      <td className="px-3 py-3 text-right">
                        <button
                          type="button"
                          onClick={() => openDetail(t.id)}
                          className="inline-flex items-center gap-1 rounded-md border px-2.5 py-1 text-xs font-medium hover:bg-muted"
                        >
                          <Eye className="h-3.5 w-3.5" />
                          Ver
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}

      {/* Novo chamado */}
      {showNew && (
        <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-background/80 p-4 backdrop-blur-sm" onClick={() => !submitting && resetNew()}>
          <div className="my-10 w-full max-w-lg rounded-lg border bg-background shadow-lg" onClick={(e) => e.stopPropagation()}>
            <div className="border-b px-6 py-4">
              <h2 className="text-lg font-semibold">Novo chamado</h2>
            </div>
            <div className="space-y-4 px-6 py-5">
              {formError && (
                <p className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">{formError}</p>
              )}
              <div className="space-y-1.5">
                <label className="text-sm font-medium">Título <span className="text-destructive">*</span></label>
                <input value={title} onChange={(e) => setTitle(e.target.value)} maxLength={140} placeholder="Resumo do problema ou melhoria" className={INPUT_CLS} autoFocus />
              </div>
              <div className="space-y-1.5">
                <label className="text-sm font-medium">Categoria</label>
                <select value={category} onChange={(e) => setCategory(e.target.value as TicketCategory)} className={INPUT_CLS}>
                  <option value="melhoria">Melhoria</option>
                  <option value="bug">Bug</option>
                </select>
              </div>
              <div className="space-y-1.5">
                <label className="text-sm font-medium">Descrição <span className="text-destructive">*</span></label>
                <textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={5} placeholder="Descreva o que aconteceu (ou a melhoria), passos para reproduzir, telas envolvidas…" className={`${INPUT_CLS} resize-none`} />
              </div>
              <div className="space-y-2">
                <label className="text-sm font-medium">Anexos <span className="text-muted-foreground">(opcional — inclui prints)</span></label>
                <input
                  ref={fileRef}
                  type="file"
                  multiple
                  accept=".pdf,.jpg,.jpeg,.png,.webp,.gif,.doc,.docx,.xls,.xlsx,.txt"
                  onChange={(e) => addFiles(e.target.files)}
                  className="hidden"
                />
                <button
                  type="button"
                  onClick={() => fileRef.current?.click()}
                  disabled={uploading}
                  className="inline-flex items-center gap-2 rounded-md border border-dashed px-4 py-2 text-sm font-medium hover:bg-muted disabled:opacity-50"
                >
                  {uploading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Paperclip className="h-4 w-4" />}
                  {uploading ? "Enviando…" : "Adicionar anexos"}
                </button>
                {attachments.length > 0 && (
                  <ul className="space-y-2">
                    {attachments.map((a, i) => (
                      <li key={`${a.path}-${i}`} className="flex items-center justify-between gap-2 rounded-md border bg-muted/30 px-3 py-2">
                        <div className="flex min-w-0 items-center gap-2 text-sm">
                          <Paperclip className="h-4 w-4 shrink-0 text-muted-foreground" />
                          <span className="truncate">{a.name}</span>
                          <span className="shrink-0 text-xs text-muted-foreground">({(a.size / 1024 / 1024).toFixed(2)} MB)</span>
                        </div>
                        <button type="button" onClick={() => setAttachments((prev) => prev.filter((_, j) => j !== i))} className="shrink-0 text-muted-foreground hover:text-destructive" aria-label={`Remover ${a.name}`}>
                          <X className="h-4 w-4" />
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </div>
            <div className="flex justify-end gap-2 border-t px-6 py-4">
              <button type="button" onClick={resetNew} disabled={submitting} className="rounded-md border bg-background px-4 py-2 text-sm font-medium hover:bg-muted disabled:opacity-50">Cancelar</button>
              <button type="button" onClick={submitNew} disabled={submitting || uploading || !title.trim() || !description.trim()} className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50 disabled:cursor-not-allowed">
                {submitting ? "Abrindo…" : "Abrir chamado"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Detalhe do chamado */}
      {(detailLoading || detail || detailError) && (
        <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-background/80 p-4 backdrop-blur-sm" onClick={() => { setDetail(null); setDetailError(null); }}>
          <div className="my-10 w-full max-w-2xl rounded-lg border bg-background shadow-lg" onClick={(e) => e.stopPropagation()}>
            {detailLoading ? (
              <div className="flex items-center justify-center gap-2 px-6 py-16 text-sm text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin" /> Carregando…
              </div>
            ) : detailError ? (
              <div className="px-6 py-8">
                <p className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">{detailError}</p>
                <div className="mt-4 flex justify-end">
                  <button type="button" onClick={() => setDetailError(null)} className="rounded-md border px-4 py-2 text-sm font-medium hover:bg-muted">Fechar</button>
                </div>
              </div>
            ) : detail ? (
              <>
                <div className="flex items-start justify-between gap-4 border-b px-6 py-4">
                  <div className="min-w-0">
                    <h2 className="text-lg font-semibold">
                      <span className="font-mono text-muted-foreground">#{detail.ticket.ticket_number}</span>{" "}
                      {detail.ticket.title}
                    </h2>
                    <p className="text-xs text-muted-foreground">
                      Aberto em {fmtDate(detail.ticket.created_at)}
                      {isAdmin && detail.ticket.author ? ` · ${detail.ticket.author.name ?? detail.ticket.author.email}` : ""}
                    </p>
                  </div>
                  <button type="button" onClick={() => setDetail(null)} className="shrink-0 text-muted-foreground hover:text-foreground" aria-label="Fechar">
                    <X className="h-5 w-5" />
                  </button>
                </div>
                <div className="space-y-4 px-6 py-5">
                  <div className="flex flex-wrap gap-2">
                    <CategoryBadge value={detail.ticket.category} />
                    <StatusBadge value={detail.ticket.status} />
                    <PriorityBadge value={detail.ticket.priority} />
                  </div>

                  {isAdmin && (
                    <div className="flex flex-wrap items-end gap-3 rounded-lg border bg-muted/30 p-3">
                      <div className="space-y-1">
                        <label className="block text-xs font-medium text-muted-foreground">Status</label>
                        <select
                          value={detail.ticket.status}
                          onChange={(e) => changeStatus(e.target.value as TicketStatus)}
                          disabled={busy}
                          className={INPUT_CLS}
                        >
                          {(Object.keys(TICKET_STATUS_LABEL) as TicketStatus[]).map((s) => (
                            <option key={s} value={s}>{TICKET_STATUS_LABEL[s]}</option>
                          ))}
                        </select>
                      </div>
                      <div className="space-y-1">
                        <label className="block text-xs font-medium text-muted-foreground">Prioridade</label>
                        <select
                          value={detail.ticket.priority ?? ""}
                          onChange={(e) => changePriority((e.target.value || null) as TicketPriority | null)}
                          disabled={busy}
                          className={INPUT_CLS}
                        >
                          <option value="">— definir —</option>
                          <option value="baixa">Baixa</option>
                          <option value="media">Média</option>
                          <option value="alta">Alta</option>
                        </select>
                      </div>
                      <div className="space-y-1">
                        <label className="block text-xs font-medium text-muted-foreground">Responsável</label>
                        <select
                          value={detail.ticket.assignee_id ?? ""}
                          onChange={(e) => changeAssignee(e.target.value || null)}
                          disabled={busy}
                          className={INPUT_CLS}
                        >
                          <option value="">— não atribuído —</option>
                          {admins.map((a) => (
                            <option key={a.id} value={a.id}>{a.name ?? a.email ?? "—"}</option>
                          ))}
                        </select>
                        <p className="text-[11px] text-muted-foreground">Só o responsável recebe os e-mails deste chamado.</p>
                      </div>
                    </div>
                  )}
                  <div>
                    <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Descrição</p>
                    <p className="whitespace-pre-wrap text-sm">{detail.ticket.description}</p>
                  </div>
                  {detail.attachments.length > 0 && (
                    <div>
                      <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Anexos</p>
                      <div className="flex flex-wrap gap-3">
                        {detail.attachments.map((a) =>
                          a.url && (a.mime ?? "").startsWith("image/") ? (
                            <a key={a.id} href={a.url} target="_blank" rel="noopener noreferrer" className="block" title={a.name}>
                              {/* eslint-disable-next-line @next/next/no-img-element */}
                              <img src={a.url} alt={a.name} className="h-24 w-24 rounded-md border object-cover" />
                            </a>
                          ) : (
                            <a key={a.id} href={a.url ?? "#"} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1.5 rounded-md border px-3 py-2 text-sm hover:bg-muted">
                              <Paperclip className="h-4 w-4 text-muted-foreground" />
                              <span className="max-w-[14rem] truncate">{a.name}</span>
                            </a>
                          ),
                        )}
                      </div>
                    </div>
                  )}
                  <div>
                    <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Conversa</p>
                    {detail.messages.length === 0 ? (
                      <p className="text-sm text-muted-foreground">Nenhuma mensagem ainda.</p>
                    ) : (
                      <ul className="space-y-3">
                        {detail.messages.map((m) => (
                          <li
                            key={m.id}
                            className={`rounded-lg border px-3 py-2 ${
                              m.fromRequester
                                ? "bg-background"
                                : "border-violet-200 bg-violet-50 dark:border-violet-900/40 dark:bg-violet-950/20"
                            }`}
                          >
                            <div className="mb-1 flex items-center justify-between gap-2 text-xs text-muted-foreground">
                              <span className="font-medium text-foreground">
                                {m.author?.name ?? m.author?.email ?? "—"}
                                {!m.fromRequester && (
                                  <span className="ml-1 rounded-full bg-violet-100 px-1.5 py-0.5 text-[10px] font-semibold text-violet-800 dark:bg-violet-950/40 dark:text-violet-300">
                                    Equipe
                                  </span>
                                )}
                              </span>
                              <span>{new Date(m.created_at).toLocaleString("pt-BR")}</span>
                            </div>
                            <p className="whitespace-pre-wrap text-sm">{m.body}</p>
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>

                  {detail.ticket.status === "fechado" ? (
                    <p className="rounded-md bg-muted/50 px-3 py-2 text-xs text-muted-foreground">
                      Chamado fechado.{isAdmin ? " Reabra pelo status acima se precisar." : ""}
                    </p>
                  ) : (
                    <div className="space-y-2">
                      <textarea
                        value={replyText}
                        onChange={(e) => setReplyText(e.target.value)}
                        rows={3}
                        placeholder="Escreva uma resposta…"
                        className={`${INPUT_CLS} resize-none`}
                      />
                      <div className="flex justify-end">
                        <button
                          type="button"
                          onClick={sendReply}
                          disabled={busy || !replyText.trim()}
                          className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-50"
                        >
                          {busy ? "Enviando…" : "Responder"}
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              </>
            ) : null}
          </div>
        </div>
      )}
    </div>
  );
}
