"use client";

import Link from "next/link";

import { FORNECEDORES_NOVOS_HREF, type HomeCtrlCaps, type HomeCtrlData } from "@/lib/home/ctrl-widgets";

interface AttentionItem {
  /** Número grande do cartão — a contagem da pendência. */
  count: number;
  /** Descrição em duas linhas, abaixo do número. */
  label: string;
  href: string;
}

/**
 * Cada item é um par "existe pendência" + "esta pendência é responsabilidade
 * deste perfil" (caps.alerts, montado em deriveCtrlCaps). Os dois gates são
 * necessários: um widget pode estar carregado para acompanhamento sem que o
 * alerta correspondente pertença ao usuário — é o caso do Contas a Pagar, que
 * vê o quadro de aprovações mas não é avisado delas porque não aprova.
 */
function buildItems(data: HomeCtrlData, caps: HomeCtrlCaps): AttentionItem[] {
  const items: AttentionItem[] = [];
  const alerts = caps.alerts;

  if (alerts.approvals && data.approvals && data.approvals.total > 0) {
    items.push({
      count: data.approvals.total,
      label: "aprovações aguardando você",
      href: "/ctrl/aprovacoes",
    });
  }
  if (alerts.omieErrors && data.payments && data.payments.omieErrors > 0) {
    items.push({
      count: data.payments.omieErrors,
      label: "falhas no envio ao Omie",
      href: "/ctrl/contas-a-pagar",
    });
  }
  // Só `aguardando_complementacao`: é a pendência que está de fato com o
  // solicitante (o aprovador perguntou algo antes de decidir).
  if (
    alerts.ownComplement &&
    data.myRequests &&
    data.myRequests.aguardandoComplementacao > 0
  ) {
    items.push({
      count: data.myRequests.aguardandoComplementacao,
      label: "requisições aguardando complementação",
      href: "/ctrl/requisicoes",
    });
  }
  if (alerts.ownRejected && data.myRequests && data.myRequests.rejeitadas > 0) {
    items.push({
      count: data.myRequests.rejeitadas,
      label: "requisições rejeitadas",
      href: "/ctrl/requisicoes",
    });
  }
  // Homologação de fornecedor. `suppliers` só é carregado para o perfil Contas
  // a Pagar (caps.canHomologate), então é null para todo o resto.
  if (alerts.suppliers && data.suppliers && data.suppliers.bloqueadasTotal > 0) {
    items.push({
      count: data.suppliers.bloqueadasTotal,
      label: "requisições com fornecedor não homologado",
      href: "/ctrl/contas-a-pagar",
    });
  }
  // O link carrega o recorte (aba Pendentes + cadastros novos): a listagem abre
  // em Aprovados e tem mais de mil linhas, então sem os parâmetros o cartão
  // entregava o usuário numa tela onde ele teria que achar os N sozinho.
  if (alerts.suppliers && data.suppliers && data.suppliers.novosTotal > 0) {
    items.push({
      count: data.suppliers.novosTotal,
      label: "fornecedores aguardando homologação",
      href: FORNECEDORES_NOVOS_HREF,
    });
  }
  return items;
}

/**
 * A faixa se aplica a este perfil?
 *
 * Perfil sem nenhum tipo de pendência sob sua responsabilidade (Visão
 * Financeira, CSC, Validação de Contratos) não tem a seção: "Tudo em dia"
 * prometeria um acompanhamento que essa tela não faz para eles. Quem decide
 * é o HomeView, para não sobrar uma faixa vazia entre duas réguas.
 */
export function hasAttentionSection(caps: HomeCtrlCaps): boolean {
  return Object.values(caps.alerts).some(Boolean);
}

/**
 * Único campo vermelho cheio da tela. É onde o vermelho significa
 * "ação/atenção" no seu grau máximo — por isso não se repete em mais
 * nenhum painel.
 */
export function AttentionStrip({
  data,
  caps,
}: {
  data: HomeCtrlData;
  caps: HomeCtrlCaps;
}) {
  const items = buildItems(data, caps);

  if (!hasAttentionSection(caps)) return null;

  if (items.length === 0) {
    return (
      <p className="ch-attention--clear">
        Tudo em dia. Nada precisa da sua atenção agora.
      </p>
    );
  }

  return (
    <div className="ch-attention">
      <div className="ch-attention__head">Precisa da sua atenção</div>
      <div className="ch-attention__grid">
        {items.map((it) => (
          <Link key={it.href + it.label} href={it.href} className="ch-attention__card">
            <span className="ch-metric ch-metric--accent">{it.count}</span>
            <p>{it.label}</p>
          </Link>
        ))}
      </div>
    </div>
  );
}
