"use client";

import { useEffect, useState } from "react";

import { AttentionStrip, hasAttentionSection } from "@/components/app/home/attention-strip";
import { SectionHead } from "@/components/app/home/widget-card";
import { WidgetAprovacoes } from "@/components/app/home/widget-aprovacoes";
import { WidgetFilaPagamento } from "@/components/app/home/widget-fila-pagamento";
import { WidgetFornecedores } from "@/components/app/home/widget-fornecedores";
import { WidgetMinhasRequisicoes } from "@/components/app/home/widget-minhas-requisicoes";
import { WidgetOrcamento } from "@/components/app/home/widget-orcamento";
import type { HomeCtrlCaps, HomeCtrlData } from "@/lib/home/ctrl-widgets";

interface Indicator {
  name: string;
  value: string;
  change: string;
  changeType: "up" | "down" | "neutral";
  color: string;
  label: string;
}
interface Alert {
  type: "error" | "warning" | "info";
  title: string;
  detail: string;
}
interface NewsItem {
  title: string;
  source: string;
  url: string;
  publishedAt: string;
}

interface HomeViewProps {
  userName: string;
  caps: HomeCtrlCaps;
  ctrlData: HomeCtrlData;
  /**
   * Alertas do Sistema (erro de sync, categorias sem mapeamento, falhas de
   * integração) são administração da plataforma: só o perfil Admin vê. Antes
   * bastava ter o módulo Financeiro, o que expunha pendência técnica a quem não
   * pode agir sobre ela. A geração dos alertas não mudou — só quem os enxerga.
   */
  isAdmin: boolean;
}

function getGreeting(): string {
  const hour = new Date().getHours();
  if (hour < 12) return "Bom dia";
  if (hour < 18) return "Boa tarde";
  return "Boa noite";
}

export function HomeView({ userName, caps, ctrlData, isAdmin }: HomeViewProps) {
  const [indicators, setIndicators] = useState<Indicator[]>([]);
  const [alerts, setAlerts] = useState<Alert[]>([]);
  const [news, setNews] = useState<NewsItem[]>([]);
  const [loadingIndicators, setLoadingIndicators] = useState(true);
  const [loadingAlerts, setLoadingAlerts] = useState(true);
  const [loadingNews, setLoadingNews] = useState(true);
  const [host, setHost] = useState("");

  useEffect(() => {
    setHost(window.location.host);
    // Indicadores e Notícias econômicas são de todos os perfis — nenhum gate.
    void fetch("/api/home/indicators")
      .then((r) => r.json())
      .then((d: { indicators: Indicator[] }) => setIndicators(d.indicators ?? []))
      .finally(() => setLoadingIndicators(false));
    void fetch("/api/home/news")
      .then((r) => r.json())
      .then((d: { news: NewsItem[] }) => setNews(d.news ?? []))
      .finally(() => setLoadingNews(false));
    // Alertas do Sistema é exclusivo do perfil Admin. O endpoint também recusa
    // não-admin (403); este gate evita a chamada inútil.
    if (!isAdmin) return;
    void fetch("/api/home/stats")
      .then((r) => r.json())
      .then((d: { alerts?: Alert[] }) => setAlerts(d.alerts ?? []))
      .finally(() => setLoadingAlerts(false));
  }, [isAdmin]);

  const currentDate = new Date().toLocaleDateString("pt-BR", {
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric",
  });

  return (
    <div>
      {/* 1. Saudação -------------------------------------------------
             Só a saudação. A contagem de aprovações vive na faixa
             "Precisa da sua atenção", logo abaixo — ter as duas deixava o
             mesmo alerta duas vezes na mesma dobra. */}
      <section className="ch-band">
        <p className="ch-kicker ch-kicker--accent">{currentDate}</p>
        <h1 className="ch-hello">
          {getGreeting()}, {userName}
        </h1>
      </section>

      {/* 2. Precisa da sua atenção — único campo vermelho cheio da tela.
             A faixa inteira some para quem não tem pendência sob sua
             responsabilidade (ver hasAttentionSection). */}
      {hasAttentionSection(caps) && (
        <section className="ch-band" data-tour="home-atencao">
          <AttentionStrip data={ctrlData} caps={caps} />
        </section>
      )}

      {/* 3. Alertas do sistema — exclusivo do Admin, é a única seção da
             home que é responsabilidade dele (sync, mapeamento, integração).
             Nunca parcial: ou aparece inteira, ou nem o pedido acontece. */}
      {isAdmin && (
        <section className="ch-band">
          <SectionHead title="Alertas do sistema" />
          {loadingAlerts ? (
            <div className="ch-2col">
              {Array.from({ length: 4 }).map((_, i) => (
                <div key={i}>
                  <span className="ch-skel" style={{ height: 12, width: "45%" }} />
                  <span
                    className="ch-skel"
                    style={{ height: 10, width: "70%", marginTop: 6 }}
                  />
                </div>
              ))}
            </div>
          ) : alerts.length === 0 ? (
            <p className="ch-empty">Nenhum alerta no momento.</p>
          ) : (
            <div className="ch-2col">
              {alerts.map((alert, i) => (
                <div key={i} className="ch-alert">
                  <span
                    className={`ch-alert__dot ${
                      alert.type === "error" ? "ch-alert__dot--critical" : ""
                    }`}
                  />
                  <div>
                    <p className="ch-alert__title">{alert.title}</p>
                    <p className="ch-alert__detail">{alert.detail}</p>
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>
      )}

      {/* 4. Fila de pagamento ---------------------------------------- */}
      {caps.canPay && ctrlData.payments && (
        <section className="ch-band" data-tour="home-fila-pagamento">
          <WidgetFilaPagamento data={ctrlData.payments} />
        </section>
      )}

      {/* 5. Aprovações pendentes ------------------------------------- */}
      {caps.canApprove && ctrlData.approvals && (
        <section className="ch-band" data-tour="home-aprovacoes">
          <WidgetAprovacoes data={ctrlData.approvals} />
        </section>
      )}

      {/* 6. Fornecedores a homologar + Minhas requisições ------------- */}
      {((caps.canHomologate && ctrlData.suppliers) ||
        (caps.canRequest && ctrlData.myRequests)) && (
        <section className="ch-band">
          <div
            className={
              caps.canHomologate && ctrlData.suppliers && caps.canRequest && ctrlData.myRequests
                ? "ch-split"
                : undefined
            }
          >
            {caps.canHomologate && ctrlData.suppliers && (
              <WidgetFornecedores data={ctrlData.suppliers} />
            )}
            {caps.canRequest && ctrlData.myRequests && (
              <div data-tour="home-minhas-requisicoes">
                <WidgetMinhasRequisicoes data={ctrlData.myRequests} />
              </div>
            )}
          </div>
        </section>
      )}

      {/* 7. Orçamento do setor --------------------------------------- */}
      {caps.canBudget && ctrlData.budget && (
        <section className="ch-band">
          <WidgetOrcamento data={ctrlData.budget} />
        </section>
      )}

      {/* 8. Indicadores econômicos — todos os perfis ------------------ */}
      <section className="ch-band" data-tour="home-indicadores">
        <SectionHead title="Indicadores econômicos" />
        {loadingIndicators ? (
          <div className="ch-cols">
            {Array.from({ length: 3 }).map((_, i) => (
              <div key={i}>
                <span className="ch-skel" style={{ height: 22, width: 90 }} />
                <span className="ch-skel" style={{ height: 10, width: 60, marginTop: 8 }} />
              </div>
            ))}
          </div>
        ) : indicators.length === 0 ? (
          <p className="ch-empty">Indicadores indisponíveis no momento.</p>
        ) : (
          <div className={`ch-cols ${indicators.length === 4 ? "ch-cols--4" : ""}`}>
            {indicators.map((ind) => (
              <div key={ind.name}>
                <p className="ch-metric">{ind.value}</p>
                <p className="ch-kicker" style={{ marginTop: 8 }}>
                  {ind.label}
                </p>
                <p
                  className={`ch-row__meta ${
                    ind.changeType === "down" ? "ch-change--down" : ""
                  }`}
                  style={{ marginTop: 4 }}
                >
                  {ind.change}
                </p>
              </div>
            ))}
          </div>
        )}
      </section>

      {/* 9. Notícias econômicas — todos os perfis --------------------- */}
      <section className="ch-band" data-tour="home-noticias">
        <SectionHead title="Notícias econômicas" />
        {loadingNews ? (
          <div className="ch-2col">
            {Array.from({ length: 4 }).map((_, i) => (
              <div key={i}>
                <span className="ch-skel" style={{ height: 12, width: "80%" }} />
                <span className="ch-skel" style={{ height: 10, width: 90, marginTop: 6 }} />
              </div>
            ))}
          </div>
        ) : news.length === 0 ? (
          <p className="ch-empty">Nenhuma notícia disponível no momento.</p>
        ) : (
          <div className="ch-2col">
            {news.map((item, i) => (
              <a
                key={i}
                href={item.url}
                target="_blank"
                rel="noopener noreferrer"
                className="ch-news"
              >
                <span className="ch-row__title">{item.title}</span>
                <span className="ch-kicker" style={{ display: "block", marginTop: 5 }}>
                  {item.source}
                  {item.publishedAt ? ` · ${item.publishedAt}` : ""}
                </span>
              </a>
            ))}
          </div>
        )}
      </section>

      <footer className="ch-footer">
        <span>Control Hub · Beta</span>
        <span>{host}</span>
      </footer>
    </div>
  );
}
