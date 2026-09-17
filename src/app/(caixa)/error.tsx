"use client";

export default function CaixaError({ reset }: { error: Error; reset: () => void }) {
  return (
    <div className="mx-auto max-w-md p-8 text-center">
      <h2 className="font-display text-lg font-semibold text-ink-primary">
        Não foi possível carregar o Caixa
      </h2>
      <p className="mt-1 text-sm text-ink-muted">
        Tente novamente. Se persistir, abra um chamado pelo menu Suporte.
      </p>
      <button
        onClick={reset}
        className="mt-4 rounded-viva-md bg-viva-500 px-4 py-2 text-sm font-medium text-white hover:bg-viva-600"
      >
        Tentar de novo
      </button>
    </div>
  );
}
