"use client";

import Link from "next/link";

/**
 * Cabeçalho de seção da home: título com a barra vermelha à esquerda e,
 * opcionalmente, o link para a tela onde o assunto é resolvido.
 *
 * Os quadros da home deixaram de ser cartões: cada um é uma FAIXA de
 * largura total (`.ch-band`, aplicada pelo HomeView), separada da
 * seguinte por uma régua de 1px. A hierarquia vem do espaçamento.
 */
export function SectionHead({
  title,
  href,
  hrefLabel = "Ver tudo",
}: {
  title: string;
  href?: string;
  hrefLabel?: string;
}) {
  return (
    <div className="ch-sec-row">
      <h2 className="ch-sec">{title}</h2>
      {href && (
        <Link href={href} className="ch-link">
          {hrefLabel} →
        </Link>
      )}
    </div>
  );
}

export function WidgetEmpty({ children }: { children: React.ReactNode }) {
  return <p className="ch-empty">{children}</p>;
}
