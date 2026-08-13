// ============================================================================
// Visão completa do módulo Compras (override nominal, por e-mail).
//
// Regra de negócio: alguns usuários lideram uma área e precisam ACOMPANHAR o
// módulo inteiro sem que o perfil deles mude. Hoje:
//   - Marcela de Souza (marcela@quokka.net.br) — perfil "Gerente Sócio"
//     (`gerente`), líder do setor Financeiro.
//
// O override libera:
//   - Requisições  → todas (não só as próprias);
//   - Aprovações   → todas (visão global, como o diretor), com a separação
//                    visual "Do seu setor" x "Demais setores" alimentada pelos
//                    setores vinculados ao usuário em Usuários (user_sectors);
//   - Contas a Pagar → a tela inteira COM as ações: enviar ao pagamento,
//                    devolver, pedir info e corrigir setor/tipo (as server
//                    actions usam requireCtrlRoleOrFullView, em ctrl/auth.ts);
//   - Orçamento, Relatórios e Fornecedores.
//
// O que ele NÃO muda (de propósito):
//   - ALÇADA DE APROVAÇÃO. Ver tudo não é poder aprovar tudo: quem tem o
//     override segue aprovando apenas os setores vinculados a ele (guarda no
//     servidor em actions/requests.ts + botões escondidos na tela). É o que
//     evita aprovar por engano algo de outro setor agora que a listagem mostra
//     o módulo inteiro. Sem nenhum setor vinculado, nada muda em relação ao
//     comportamento atual do perfil.
//   - Configurações do módulo (/ctrl/configuracoes e /ctrl/admin/*, incluindo
//     Editar Orçamento): seguem admin-only.
//   - Lembrete diário de aprovações por e-mail: quem recebe o quê continua
//     saindo de user_sectors + DIRECTOR_HIGHLIGHT_SECTORS (routing.ts). Este
//     override não coloca ninguém na rotina de e-mail.
//
// Identificamos por e-mail (chave natural estável), como em bi-validation.ts.
//
// ⚠️ AO INCLUIR UM E-MAIL AQUI, confira o catálogo em
//    `src/lib/auth/user-exceptions.ts` — ele já lê esta lista, mas é o que
//    mantém a exceção visível no botão "Regras especiais" da tela de Usuários.
// ============================================================================

/** E-mails com visão completa (leitura) do módulo Compras. Sempre minúsculos. */
export const CTRL_FULL_VIEW_EMAILS: ReadonlySet<string> = new Set([
  "marcela@quokka.net.br",
]);

/** O usuário tem visão completa (leitura) do módulo Compras? */
export function hasCtrlFullView(email: string | null | undefined): boolean {
  return CTRL_FULL_VIEW_EMAILS.has((email ?? "").trim().toLowerCase());
}
