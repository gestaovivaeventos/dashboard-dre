// Conteúdo do Manual do módulo Compras (Control Hub).
//
// FONTE ÚNICA: esta é a única definição do manual. A tela (/ctrl/manual) e o
// arquivo Word (scripts/gen-manual-doc.ts → docs/) renderizam exatamente estes
// blocos — não escreva o texto do manual em nenhum outro lugar, senão as duas
// versões divergem em silêncio.
//
// Módulo PURO de dados: sem imports, sem "use server", sem React. É o que
// permite gerar o .doc por script (npx tsx) sem carregar o app inteiro.
//
// ⚠️ AO MUDAR UMA REGRA DO MÓDULO (fluxo, alçada, status, campo obrigatório),
//    atualize a seção correspondente aqui. O manual é lido pelo usuário final
//    como se fosse a regra; um manual desatualizado gera mais chamado do que
//    manual nenhum.

export const MANUAL_TITLE = "Manual do Módulo Compras";
export const MANUAL_SUBTITLE =
  "Requisições, aprovações e contas a pagar no Control Hub";
export const MANUAL_ORG = "Grupo Viva · Control Hub";
export const MANUAL_VERSION = "1.0";
export const MANUAL_UPDATED_AT = "13/08/2026";

// ─── Perfis (público-alvo de cada seção) ─────────────────────────────────────

export type ManualAudience =
  | "solicitante"
  | "gerente"
  | "diretor"
  | "contas_a_pagar";

export const MANUAL_AUDIENCES: Array<{
  id: ManualAudience;
  label: string;
  short: string;
  description: string;
}> = [
  {
    id: "solicitante",
    label: "Solicitante",
    short: "Solicitante",
    description: "Cria e acompanha as próprias requisições.",
  },
  {
    id: "gerente",
    label: "Gerente",
    short: "Gerente",
    description: "Aprova a primeira etapa das requisições dos seus setores.",
  },
  {
    id: "diretor",
    label: "Diretor",
    short: "Diretor",
    description: "Aprova a etapa final do que está fora do orçamento.",
  },
  {
    id: "contas_a_pagar",
    label: "Contas a Pagar",
    short: "Contas a Pagar",
    description: "Confere as aprovadas e envia o pagamento ao Omie.",
  },
];

// ─── Blocos de conteúdo ──────────────────────────────────────────────────────
//
// O texto aceita **negrito** inline (marcação simples, resolvida pelos dois
// renderizadores). Não use HTML cru aqui.

export type ManualTone = "info" | "sucesso" | "atencao" | "critico";

export type ManualBlock =
  | { kind: "p"; text: string }
  | { kind: "list"; items: string[]; ordered?: boolean }
  | { kind: "steps"; items: Array<{ title: string; text: string }> }
  | { kind: "table"; headers: string[]; rows: string[][] }
  | { kind: "callout"; tone: ManualTone; title: string; text: string }
  | {
      kind: "flow";
      items: Array<{ actor: string; title: string; status: string; text: string }>;
    }
  | {
      kind: "statuses";
      items: Array<{ label: string; tone: ManualTone; where: string; meaning: string }>;
    }
  | { kind: "faq"; items: Array<{ q: string; a: string }> };

export interface ManualSection {
  id: string;
  title: string;
  summary: string;
  /** Perfis para quem a seção é relevante. Vazio = todos. */
  audiences: ManualAudience[];
  blocks: ManualBlock[];
}

// ─── Seções ──────────────────────────────────────────────────────────────────

export const MANUAL_SECTIONS: ManualSection[] = [
  // ───────────────────────────────────────────────────────────── visão geral
  {
    id: "visao-geral",
    title: "Visão geral",
    summary: "O que é o módulo, quem participa e o que cada perfil enxerga.",
    audiences: [],
    blocks: [
      {
        kind: "p",
        text:
          "O módulo **Compras** organiza todo o caminho de uma despesa: da solicitação até o pagamento lançado no Omie. Toda compra ou pagamento a fornecedor deve nascer aqui — é o que garante controle de orçamento, aprovação da pessoa certa e rastro de quem pediu, quem aprovou e quando.",
      },
      {
        kind: "p",
        text: "Cada pessoa vê e faz apenas o que cabe ao seu perfil.",
      },
      {
        kind: "table",
        headers: ["Perfil", "O que faz"],
        rows: [
          [
            "Solicitante",
            "Cria requisições nos setores vinculados e acompanha as suas.",
          ],
          [
            "Gerente",
            "Aprova a etapa gerencial das requisições dos seus setores. Também pode criar requisições.",
          ],
          [
            "Diretor",
            "Aprova a etapa final (fora do orçamento e casos direcionados). Enxerga todos os setores.",
          ],
          [
            "Contas a Pagar",
            "Confere as requisições aprovadas, resolve pendências e envia o pagamento ao Omie.",
          ],
        ],
      },
      {
        kind: "callout",
        tone: "atencao",
        title: "Não está vendo os setores na hora de criar?",
        text:
          "A lista de setores mostra apenas os setores vinculados ao seu usuário. Se ela vier vazia, seu usuário ainda não foi vinculado a nenhum setor — peça o vínculo ao administrador do Control Hub.",
      },
    ],
  },

  // ──────────────────────────────────────────────────────────────── o fluxo
  {
    id: "fluxo",
    title: "O caminho de uma requisição",
    summary: "As seis etapas entre o pedido e o pagamento, e os desvios possíveis.",
    audiences: [],
    blocks: [
      {
        kind: "p",
        text:
          "Toda requisição percorre o mesmo caminho. O que muda de uma para a outra é **quantas aprovações** ela precisa — e isso é decidido pelo orçamento do setor, automaticamente, no momento da criação.",
      },
      {
        kind: "flow",
        items: [
          {
            actor: "Solicitante",
            title: "1. Criação",
            status: "Aguardando Gerente",
            text:
              "Preenche a requisição, anexa os documentos e roda a verificação orçamentária (passo obrigatório).",
          },
          {
            actor: "Sistema",
            title: "2. Verificação orçamentária",
            status: "automático",
            text:
              "Compara o valor com o saldo anual do setor + tipo de despesa. Dentro do orçamento: só o gerente. Fora do orçamento: gerente e depois diretor, com justificativa obrigatória.",
          },
          {
            actor: "Gerente",
            title: "3. Aprovação gerencial",
            status: "Aprovado ou Aguardando Diretor",
            text:
              "O gerente do setor aprova, rejeita ou pede informação. Dentro do orçamento, a aprovação dele encerra o fluxo de aprovação.",
          },
          {
            actor: "Diretor",
            title: "4. Aprovação do diretor",
            status: "Aprovado",
            text:
              "Etapa que existe apenas quando a requisição está fora do orçamento ou vem de um setor/solicitante direcionado ao diretor por regra.",
          },
          {
            actor: "Contas a Pagar",
            title: "5. Conferência e envio",
            status: "Enviado Pgto",
            text:
              "Confere dados de pagamento e fornecedor, escolhe a empresa pagadora e envia. O sistema lança o título no Omie.",
          },
          {
            actor: "Omie",
            title: "6. Pagamento",
            status: "Pago",
            text:
              "Quando o título é baixado (pago) no Omie, o Control Hub reconhece a baixa e marca a requisição como Pago.",
          },
        ],
      },
      {
        kind: "p",
        text: "**Desvios possíveis em qualquer ponto da aprovação:**",
      },
      {
        kind: "list",
        items: [
          "**Pedir Info** — o aprovador devolve uma pergunta ao solicitante. A requisição vai para *Complementação* e volta à mesma etapa quando o aprovador decide.",
          "**Rejeitar** — encerra a requisição com motivo obrigatório. O valor volta a ficar disponível no orçamento.",
          "**Devolver** (Contas a Pagar) — traz a requisição de volta para correção; se já havia título no Omie, ele é excluído lá antes.",
        ],
      },
    ],
  },

  // ─────────────────────────────────────────────────────────────── status
  {
    id: "status",
    title: "Os status e o que cada um significa",
    summary: "Como ler a etiqueta colorida da requisição em qualquer tela.",
    audiences: [],
    blocks: [
      {
        kind: "p",
        text:
          "O status aparece como etiqueta colorida nas telas de Requisições, Aprovações e Contas a Pagar. É a resposta rápida para “onde está minha requisição?”.",
      },
      {
        kind: "statuses",
        items: [
          {
            label: "Aguardando Gerente",
            tone: "atencao",
            where: "Aprovações › Pendentes",
            meaning:
              "Aguarda a decisão do gerente do setor. É o estado inicial da maior parte das requisições.",
          },
          {
            label: "Aguardando Diretor",
            tone: "atencao",
            where: "Aprovações › Pendentes",
            meaning:
              "O gerente já aprovou (ou a requisição nasceu direcionada ao diretor) e falta a aprovação da diretoria.",
          },
          {
            label: "Complementação",
            tone: "info",
            where: "Aprovações › Complementação e Requisições",
            meaning:
              "Um aprovador pediu informação. O solicitante responde pelo botão **Responder**; a requisição continua nesta etapa até o aprovador decidir.",
          },
          {
            label: "Aprovado",
            tone: "sucesso",
            where: "Contas a Pagar › Aguardando Envio",
            meaning:
              "Aprovação concluída. A requisição está na fila do Contas a Pagar, aguardando conferência e envio.",
          },
          {
            label: "Info pendente",
            tone: "atencao",
            where: "Contas a Pagar › Info Pendente",
            meaning:
              "O time de Contas a Pagar pediu um esclarecimento antes de pagar. O envio fica bloqueado até a resposta do solicitante.",
          },
          {
            label: "Enviado Pgto",
            tone: "info",
            where: "Contas a Pagar › Enviados",
            meaning:
              "O título já foi lançado no Omie como conta a pagar. Lançado não é pago: é o financeiro que efetua a baixa.",
          },
          {
            label: "Pago",
            tone: "sucesso",
            where: "Requisições e Contas a Pagar",
            meaning:
              "O título foi baixado no Omie. É o único status que confirma pagamento de fato.",
          },
          {
            label: "Rejeitado",
            tone: "critico",
            where: "Aprovações › Rejeitadas",
            meaning:
              "Encerrada por um aprovador, sempre com motivo registrado. Para seguir com a despesa, crie uma nova requisição corrigida.",
          },
        ],
      },
      {
        kind: "callout",
        tone: "info",
        title: "Etiqueta “NÃO ORÇADO”",
        text:
          "Requisições fora do orçamento recebem o prefixo **NÃO ORÇADO** no título e na descrição já na criação. Ele acompanha a requisição em todas as telas e chega até a observação do lançamento no Omie.",
      },
    ],
  },

  // ────────────────────────────────────────────────────────── solicitante
  {
    id: "solicitante",
    title: "Manual do Solicitante",
    summary: "Como criar uma requisição correta e acompanhar até o pagamento.",
    audiences: ["solicitante", "gerente", "diretor", "contas_a_pagar"],
    blocks: [
      {
        kind: "p",
        text:
          "Sua autonomia: **criar requisições nos setores vinculados ao seu usuário e acompanhar as suas**. Você não aprova, não altera valor depois de enviada e não envia pagamento. Na tela **Requisições** você enxerga apenas o que você mesmo solicitou.",
      },
      {
        kind: "steps",
        items: [
          {
            title: "Abra Requisições › Nova Requisição",
            text:
              "O botão fica no canto superior direito da tela de Requisições.",
          },
          {
            title: "Descreva a despesa",
            text:
              "A **Descrição** é o que o aprovador lê primeiro. Escreva o que é, para quem e o período — ex.: “Serviço de limpeza — referência maio/2026”. Evite “pagamento”, “serviço”, “compra”.",
          },
          {
            title: "Escolha Setor e Tipo de Despesa",
            text:
              "É esse par que define de qual orçamento a despesa sai e qual categoria será usada no Omie. Errar aqui é o motivo mais comum de devolução.",
          },
          {
            title: "Selecione o Fornecedor",
            text:
              "Busque por nome ou CNPJ. Se não existir, cadastre pelo botão em **Fornecedores** (veja a seção Fornecedores).",
          },
          {
            title: "Selecione o Evento",
            text:
              "Obrigatório quando há eventos cadastrados. Se a despesa não pertence a nenhum, escolha explicitamente **Nenhum evento**.",
          },
          {
            title: "Escolha o método de pagamento e preencha os dados",
            text:
              "Cada método pede campos diferentes (veja a tabela abaixo). Quando o fornecedor já tem dados cadastrados, eles vêm preenchidos e travados — é o cadastro que manda.",
          },
          {
            title: "Informe valor, vencimento e competência",
            text:
              "**Vencimento** é a data em que o pagamento precisa sair. **Competência** (mês/ano) é o mês a que a despesa se refere — nem sempre é o mesmo mês do vencimento.",
          },
          {
            title: "Anexe os documentos",
            text:
              "Boleto, nota fiscal, contrato, cupom, pedido. Cada arquivo até 10 MB, nos formatos PDF, JPG, PNG, DOC ou XLS. Os anexos seguem para o Omie junto com o pagamento.",
          },
          {
            title: "Clique em Verificar Orçamento",
            text:
              "Passo obrigatório: sem ele o botão de envio não libera. O sistema mostra o saldo do setor e informa se a requisição precisará também do diretor.",
          },
          {
            title: "Responda “O fornecedor emite nota fiscal?” e envie",
            text:
              "Se a resposta for **Sim**, anexe a nota — o número é lido automaticamente do arquivo.",
          },
        ],
      },
      {
        kind: "table",
        headers: ["Método de pagamento", "O que o sistema pede"],
        rows: [
          [
            "Boleto",
            "Anexo do boleto (obrigatório) + linha digitável. O sistema lê o código de barras, o favorecido, o valor e o vencimento do arquivo e valida a linha digitável.",
          ],
          [
            "PIX",
            "Tipo de chave, chave e favorecido. Com fornecedor cadastrado, vêm preenchidos.",
          ],
          [
            "PIX Copia e Cola",
            "O código copia e cola completo. Editável mesmo com fornecedor selecionado.",
          ],
          [
            "Transferência",
            "Favorecido, CPF/CNPJ, banco, agência, conta e dígito.",
          ],
          [
            "Cartão de Crédito",
            "Número de parcelas (até 12x) e se você precisa receber o cartão físico. O vencimento é o da fatura (dia 05) e não é editável.",
          ],
          ["Cartão Pré-Pago", "Vencimento normal, sem parcelamento."],
          ["Dinheiro", "Valor e vencimento."],
        ],
      },
      {
        kind: "callout",
        tone: "atencao",
        title: "Prazo do vencimento",
        text:
          "Requisição cadastrada **até as 12h** pode ter vencimento no mesmo dia. Depois das 12h, o vencimento mínimo é o dia seguinte. Datas anteriores a esse limite não são aceitas pelo formulário.",
      },
      {
        kind: "p",
        text: "**Recursos que economizam trabalho:**",
      },
      {
        kind: "list",
        items: [
          "**Parcelamento** — só no cartão de crédito, até 12x. O sistema cria uma requisição por parcela (“Parcela 2/6”), todas com vencimento no dia 05, e verifica o orçamento de cada mês separadamente.",
          "**Recorrência mensal** — marque os outros meses em que a mesma despesa se repete. É criada uma requisição por mês, com o mesmo dia de vencimento. Não é combinável com parcelamento.",
          "**Rateio entre setores** — uma única requisição dividida entre dois ou mais setores, cada um com seu valor. Cada setor tem a sua própria aprovação, e a requisição só fica aprovada quando **todos** os setores aprovarem. Não combina com parcelamento, recorrência nem compra em dólar.",
          "**Compra em dólar** — marque *Compra em dólar (US$)*, informe o valor em dólar e o sistema converte para reais aplicando o câmbio e o IOF vigentes. O valor em reais é o que vale para orçamento e pagamento. Indisponível nos métodos PIX e PIX Copia e Cola e no rateio.",
        ],
      },
      {
        kind: "callout",
        tone: "critico",
        title: "Rejeição de rateio vale para tudo",
        text:
          "Num rateio, a rejeição feita por qualquer aprovador rejeita a requisição inteira, incluindo os setores que já haviam aprovado.",
      },
      {
        kind: "p",
        text: "**Depois de enviar — o que você precisa acompanhar:**",
      },
      {
        kind: "list",
        items: [
          "Acompanhe pela tela **Requisições**: a coluna Status mostra em que etapa está e a busca aceita número (#), título ou status.",
          "Se aparecer **Complementação**, existe uma pergunta esperando você: clique em **Responder**. Enquanto não responder, a requisição fica parada.",
          "Se aparecer **Info pendente**, quem está perguntando é o time de Contas a Pagar, já na fase de pagamento. Mesmo botão, mesma urgência.",
          "Depois do pagamento lançado, o botão **Anexos** abre os documentos que estão no Omie.",
          "Toda mudança gera notificação no sino do topo e na tela **Notificações**.",
        ],
      },
      {
        kind: "callout",
        tone: "atencao",
        title: "Fornecedor ainda não homologado",
        text:
          "Você pode criar a requisição normalmente com um fornecedor pendente — ela segue toda a aprovação. O bloqueio acontece só no fim: o pagamento não é enviado enquanto o cadastro não for homologado. Se a despesa é urgente, peça a homologação em paralelo.",
      },
      {
        kind: "callout",
        tone: "info",
        title: "Preciso corrigir uma requisição já enviada",
        text:
          "O solicitante não edita a requisição depois do envio. Peça ao aprovador para rejeitar (e crie uma nova corrigida) ou, se ela já estiver em Contas a Pagar, peça ao time para **Devolver**. Setor, tipo de despesa e método de pagamento também podem ser corrigidos pelo próprio Contas a Pagar.",
      },
    ],
  },

  // ───────────────────────────────────────────────────────────────── gerente
  {
    id: "gerente",
    title: "Manual do Gerente",
    summary: "Alçada, tela de Aprovações, aprovação em lote e o que checar antes de aprovar.",
    audiences: ["gerente", "diretor", "contas_a_pagar"],
    blocks: [
      {
        kind: "p",
        text:
          "Sua autonomia: **aprovar, rejeitar ou pedir informação nas requisições dos setores vinculados ao seu usuário**. Dentro do orçamento, a sua aprovação encerra o fluxo e a requisição segue direto para pagamento. Fora do orçamento, você aprova e a requisição segue para o diretor.",
      },
      {
        kind: "table",
        headers: ["Situação da requisição", "Quem precisa aprovar", "Resultado da sua aprovação"],
        rows: [
          [
            "Dentro do orçamento anual do setor",
            "Somente o gerente",
            "Vai direto para Aprovado (segue ao Contas a Pagar).",
          ],
          [
            "Fora do orçamento (saldo anual insuficiente)",
            "Gerente e depois Diretor",
            "Passa para Aguardando Diretor e notifica a diretoria.",
          ],
          [
            "Setor ou solicitante direcionado à diretoria por regra",
            "Somente o Diretor",
            "Não aparece para você — nasce direto na etapa do diretor.",
          ],
        ],
      },
      {
        kind: "p",
        text: "**Como trabalhar a tela Aprovações:**",
      },
      {
        kind: "steps",
        items: [
          {
            title: "Aba Pendentes",
            text:
              "Reúne o que aguarda decisão. Você só vê o que é dos seus setores, e o botão de ação só aparece nas requisições em que você tem alçada naquela etapa.",
          },
          {
            title: "Abra Detalhes antes de decidir",
            text:
              "O detalhe traz valor, setor, tipo, fornecedor, dados de pagamento, justificativa, anexos e o histórico completo de aprovação.",
          },
          {
            title: "Decida",
            text:
              "**Aprovar** encaminha à etapa seguinte. **Pedir Info** abre uma conversa com o solicitante sem perder a etapa. **Rejeitar** encerra e exige motivo — o texto vai para o solicitante.",
          },
          {
            title: "Use a aprovação em lote quando fizer sentido",
            text:
              "Marque as caixas (ou *Selecionar todas*) e aprove até 50 de uma vez. O lote respeita os filtros de coluna aplicados e ignora o que estiver fora da sua alçada.",
          },
          {
            title: "Acompanhe a aba Complementação",
            text:
              "Quando o solicitante responde, a aba mostra um alerta vermelho com a contagem. Você decide ali mesmo: aprovar, rejeitar ou perguntar de novo.",
          },
        ],
      },
      {
        kind: "callout",
        tone: "atencao",
        title: "Confira antes de aprovar",
        text:
          "Setor e tipo de despesa corretos (é o que consome o orçamento certo), valor batendo com o anexo, fornecedor certo e vencimento viável. Corrigir depois do pagamento lançado exige acerto no Omie.",
      },
      {
        kind: "p",
        text: "**Regras de alçada que valem a pena conhecer:**",
      },
      {
        kind: "list",
        items: [
          "Sua visibilidade em Aprovações vem dos setores vinculados ao seu usuário. Usuário sem nenhum setor vinculado enxerga todas as requisições — situação de cadastro incompleto, que deve ser corrigida pelo administrador do Control Hub.",
          "Alguns gerentes criam requisições em vários setores mas só aprovam alguns: existe uma restrição nominal de alçada configurada no sistema para esses casos. Se você não encontra uma requisição que esperava aprovar, é provavelmente isso — fale com o administrador.",
          "Existem direcionamentos fixos: um tipo de despesa pode ter a etapa gerencial dirigida a um gerente específico, e um setor pode ir sempre direto à diretoria.",
          "**Autoaprovação gerencial:** quando o próprio gerente é o solicitante e a despesa está prevista em orçamento, a etapa gerencial é dispensada e a requisição nasce aprovada, com registro no histórico. Fora do orçamento isso não vale — o diretor continua obrigatório.",
        ],
      },
      {
        kind: "p",
        text:
          "Na tela **Orçamento** você acompanha orçado, realizado, pendente e disponível por tipo de despesa; clique na linha para abrir o detalhamento por setor. É a mesma base usada na verificação orçamentária da requisição.",
      },
    ],
  },

  // ───────────────────────────────────────────────────────────────── diretor
  {
    id: "diretor",
    title: "Manual do Diretor",
    summary: "Quando a diretoria entra, visão de todos os setores e leitura do orçamento.",
    audiences: ["diretor", "contas_a_pagar"],
    blocks: [
      {
        kind: "p",
        text:
          "Sua autonomia: **aprovar a etapa final das requisições que exigem a diretoria e enxergar todos os setores**. Você aprova requisições de qualquer setor; os setores vinculados ao seu usuário servem para destacar o que é da sua área e para direcionar o e-mail diário de pendências.",
      },
      {
        kind: "p",
        text: "**A diretoria entra em três situações:**",
      },
      {
        kind: "list",
        ordered: true,
        items: [
          "**Fora do orçamento** — o saldo anual do setor + tipo de despesa não cobre o valor. A requisição chega com justificativa obrigatória e com o prefixo NÃO ORÇADO no título.",
          "**Setor direcionado à diretoria** — requisições desse setor nascem direto na sua etapa, mesmo dentro do orçamento.",
          "**Solicitante direcionado** — regra nominal em que as requisições de uma pessoa específica vão direto ao diretor determinado.",
        ],
      },
      {
        kind: "callout",
        tone: "info",
        title: "“Do seu setor” × “Demais setores”",
        text:
          "A tela de Aprovações separa visualmente as requisições dos setores sob sua responsabilidade das demais. As duas seções sempre aparecem — inclusive vazias — para deixar claro quando não há nada seu pendente.",
      },
      {
        kind: "p",
        text: "**O que checar na sua etapa:**",
      },
      {
        kind: "list",
        items: [
          "A **justificativa** do solicitante: ela é obrigatória justamente porque a despesa estoura o previsto.",
          "O quadro de orçamento em **Detalhes** e a tela **Orçamento**: quanto do ano já foi consumido naquele tipo de despesa.",
          "Se a despesa é pontual ou vai se repetir — recorrências criam uma requisição por mês e todas consomem orçamento.",
        ],
      },
      {
        kind: "p",
        text:
          "Você também pode concluir a etapa gerencial de uma requisição parada. Se ela estiver fora do orçamento, a aprovação a leva para a etapa do diretor — será preciso aprovar novamente para concluir.",
      },
      {
        kind: "p",
        text:
          "A tela **Relatórios** dá a visão consolidada: filtre por qualquer coluna, ordene pelo cabeçalho e exporte em XLSX para análise fora do sistema.",
      },
    ],
  },

  // ────────────────────────────────────────────────────────── contas a pagar
  {
    id: "contas-a-pagar",
    title: "Manual do Contas a Pagar",
    summary: "Conferência, envio ao Omie, devolução, pedido de informação e baixa.",
    audiences: ["contas_a_pagar"],
    blocks: [
      {
        kind: "p",
        text:
          "Sua autonomia: **receber tudo que foi aprovado, conferir, corrigir o que for de rota (setor, tipo, método), pedir esclarecimento, devolver e enviar o pagamento ao Omie**. É a última barreira antes do dinheiro sair.",
      },
      {
        kind: "table",
        headers: ["Aba", "O que tem nela", "O que fazer"],
        rows: [
          [
            "Aguardando Envio",
            "Requisições aprovadas, ainda sem título no Omie.",
            "Conferir, editar rota, pedir info, devolver ou enviar para pagamento.",
          ],
          [
            "Info Pendente",
            "Requisições com pergunta em aberto ao solicitante.",
            "Acompanhar a resposta; o envio fica bloqueado até ela chegar.",
          ],
          [
            "Enviados",
            "Requisições com título já lançado no Omie.",
            "Acompanhar o lançamento e a baixa; reenviar em caso de falha; devolver se ainda não foi paga.",
          ],
        ],
      },
      {
        kind: "steps",
        items: [
          {
            title: "Confira antes de selecionar",
            text:
              "Em **Detalhes** estão dados bancários/PIX, anexos, fornecedor, categoria Omie prevista e histórico. A coluna de pagamento mostra os dados que serão usados.",
          },
          {
            title: "Corrija a rota, se necessário",
            text:
              "O botão **Editar** ajusta setor, tipo de despesa, método de pagamento e os dados do pagamento (vencimento, linha digitável, chave PIX) antes do envio. Alterar setor ou tipo **devolve a requisição à aprovação** para nova validação orçamentária — é intencional. Alterar só o pagamento não devolve.",
          },
          {
            title: "Selecione e escolha a empresa pagadora",
            text:
              "Marque as requisições e clique em **Enviar para Pagamento**. A empresa pagadora define em qual Omie o título será criado.",
          },
          {
            title: "Decida sobre as previsões encontradas",
            text:
              "Quando existe uma previsão compatível no Omie (mesmo fornecedor, valor e vencimento), o sistema pergunta se deve atualizar a previsão existente ou criar um título novo — evita duplicidade.",
          },
          {
            title: "Acompanhe a fila",
            text:
              "O envio é assíncrono: as requisições ficam marcadas como **Enviando ao Omie** e o sistema lança uma por empresa a cada minuto (a Omie recusa chamadas repetidas em sequência). Não é preciso manter a tela aberta.",
          },
          {
            title: "Trate as falhas",
            text:
              "Falha no lançamento aparece com a etiqueta **Falha no envio ao Omie** e o motivo. Corrija a causa e use o botão para recolocar na fila.",
          },
        ],
      },
      {
        kind: "callout",
        tone: "critico",
        title: "Fornecedor não homologado trava o lote inteiro",
        text:
          "Se qualquer requisição selecionada usar fornecedor não homologado, **nada é enviado** — para não gerar envio parcial silencioso. Homologue o cadastro em Fornecedores ou desmarque a requisição e siga com o restante.",
      },
      {
        kind: "p",
        text: "**Pedir info e devolver — quando usar cada um:**",
      },
      {
        kind: "list",
        items: [
          "**Pedir info** é para dúvida pontual (dado bancário, documento faltando). A requisição vai para *Info pendente*, o solicitante responde e ela volta sozinha para Aguardando Envio.",
          "**Devolver** é para quando a requisição precisa ser refeita ou reaprovada. Exige motivo. Se ela ainda não tinha título no Omie, volta à aprovação (gerente ou diretor, conforme o nível). Se já tinha, o sistema **exclui o título no Omie** e ela volta para Aguardando Envio — devolver de novo aí a leva à aprovação.",
          "Requisição **já paga no Omie não pode ser devolvida**: o acerto precisa ser feito primeiro no Omie.",
        ],
      },
      {
        kind: "callout",
        tone: "info",
        title: "Lançado não é pago",
        text:
          "**Enviado Pgto** significa apenas que o título foi criado no Omie. O status **Pago** só aparece quando o título é baixado lá. A conferência é feita automaticamente na sincronização diária e pode ser antecipada pelo botão **Atualizar pagamentos**, na tela de Requisições.",
      },
      {
        kind: "p",
        text:
          "O orçamento se ajusta sozinho: rejeitar, devolver ou excluir uma requisição libera o valor na próxima leitura da tela Orçamento — não existe lançamento manual de consumo.",
      },
    ],
  },

  // ──────────────────────────────────────────────────────────── fornecedores
  {
    id: "fornecedores",
    title: "Fornecedores",
    summary: "Cadastro, homologação e o que trava o pagamento.",
    audiences: [],
    blocks: [
      {
        kind: "p",
        text:
          "A tela **Fornecedores** é colaborativa: qualquer perfil do módulo pode consultar e cadastrar. A **homologação** (aprovação do cadastro) é feita pelo gerente ou pelo Contas a Pagar.",
      },
      {
        kind: "list",
        items: [
          "**CNPJ ou CPF é obrigatório** — é o que identifica o fornecedor e evita cadastro duplicado no Omie.",
          "**Endereço completo é obrigatório** no cadastro nacional: a Omie recusa o cadastro sem ele.",
          "**Fornecedor estrangeiro** dispensa CNPJ/CPF, mas exige País e Estado.",
          "Se marcar PIX ou transferência como **método padrão**, todos os dados daquele método precisam estar completos — é por ali que o pagamento vai sair sem ninguém perguntar nada depois.",
          "Fornecedor novo entra como **pendente**. Ele já pode ser usado em requisições; o que fica bloqueado é o envio do pagamento.",
        ],
      },
      {
        kind: "callout",
        tone: "info",
        title: "Métodos de pagamento disponíveis dependem do cadastro",
        text:
          "Na nova requisição, PIX só aparece se o fornecedor tiver chave cadastrada, e Transferência só se tiver banco e conta. Se o método que você precisa estiver esmaecido, o cadastro do fornecedor está incompleto.",
      },
    ],
  },

  // ────────────────────────────────────────────────────────────── orçamento
  {
    id: "orcamento",
    title: "Como o orçamento é calculado",
    summary: "De onde vem o saldo que decide se a requisição precisa do diretor.",
    audiences: ["gerente", "diretor", "contas_a_pagar"],
    blocks: [
      {
        kind: "p",
        text:
          "O orçamento é controlado por **setor × tipo de despesa × ano**. A verificação feita na criação da requisição compara o valor pedido com o **saldo anual** dessa combinação.",
      },
      {
        kind: "table",
        headers: ["Coluna", "O que entra"],
        rows: [
          ["Orçado", "O valor planejado para o ano, importado do orçamento cadastrado."],
          [
            "Realizado",
            "O realizado importado + as requisições aprovadas e enviadas ao pagamento.",
          ],
          [
            "Pendente",
            "As requisições ainda em aprovação — já reservam saldo, mesmo sem decisão.",
          ],
          ["Disponível", "Orçado − Realizado − Pendente."],
        ],
      },
      {
        kind: "list",
        items: [
          "O consumo é **calculado na hora**, nunca gravado: aprovar, rejeitar, devolver ou excluir uma requisição move o saldo automaticamente na próxima abertura da tela.",
          "O que conta para o ano é a **data de vencimento** da requisição (parcelas e recorrências entram cada uma no seu mês).",
          "**Saldo anual ≥ valor** → aprovação só do gerente. **Saldo anual < valor** → gerente + diretor, com justificativa obrigatória.",
          "Tipo de despesa **sem orçamento cadastrado** no setor aparece como “Nenhum orçamento cadastrado” na verificação — a requisição segue, mas sem previsão para se apoiar.",
          "No **rateio**, a verificação é feita por setor, com a parcela daquele setor. Basta um setor estourar para a requisição inteira exigir o diretor.",
        ],
      },
    ],
  },

  // ───────────────────────────────────────────────────────── notificações
  {
    id: "notificacoes",
    title: "Notificações e e-mails",
    summary: "Como o sistema avisa cada perfil.",
    audiences: [],
    blocks: [
      {
        kind: "p",
        text:
          "Dentro do sistema, o **sino** no topo mostra o número de avisos não lidos e a tela **Notificações** guarda o histórico. Clicar no aviso leva direto à tela onde a ação acontece.",
      },
      {
        kind: "table",
        headers: ["Quem recebe", "Quando"],
        rows: [
          [
            "Gerentes do setor",
            "Quando uma requisição do setor entra na etapa gerencial.",
          ],
          [
            "Diretores",
            "Quando uma requisição avança para a etapa da diretoria.",
          ],
          [
            "Solicitante",
            "Aprovação, rejeição, pedido de informação, devolução e resposta do time de pagamento.",
          ],
          [
            "Contas a Pagar",
            "Fornecedor não homologado usado em requisição e respostas às perguntas do pagamento.",
          ],
        ],
      },
      {
        kind: "callout",
        tone: "info",
        title: "E-mail diário de pendências",
        text:
          "Todo dia útil, às 10h, cada aprovador com requisições pendentes recebe **um único e-mail** com a lista do que depende dele. Quem não tem pendência não recebe nada. Não há disparo em fins de semana.",
      },
    ],
  },

  // ────────────────────────────────────────────────────────────────── FAQ
  {
    id: "duvidas",
    title: "Dúvidas frequentes",
    summary: "As perguntas que mais aparecem no dia a dia.",
    audiences: [],
    blocks: [
      {
        kind: "faq",
        items: [
          {
            q: "Criei a requisição e ela não aparece para ninguém aprovar. O que houve?",
            a: "Verifique o status. Se estiver *Aprovado*, a etapa gerencial foi dispensada pela autoaprovação (você é gerente e a despesa estava prevista em orçamento). Se estiver *Aguardando Diretor*, ela foi direcionada à diretoria e não passa pelo gerente.",
          },
          {
            q: "Por que minha requisição virou “NÃO ORÇADO”?",
            a: "Porque o saldo anual do setor + tipo de despesa não cobria o valor no momento da criação. Ela precisa de justificativa e da aprovação do diretor, além do gerente.",
          },
          {
            q: "O botão de enviar a requisição está desabilitado.",
            a: "Falta rodar a **Verificação Orçamentária**. Preencha setor, tipo de despesa e valor, clique em *Verificar Orçamento* e o envio libera. Se a requisição for fora do orçamento, a justificativa também é obrigatória.",
          },
          {
            q: "Posso pagar um fornecedor que ainda não foi homologado?",
            a: "A requisição pode ser criada e aprovada normalmente, mas o pagamento não é enviado enquanto o cadastro não for homologado na tela Fornecedores.",
          },
          {
            q: "Errei o setor ou o tipo de despesa. Como corrijo?",
            a: "Antes da aprovação, peça a rejeição e crie a requisição corrigida. Já em Contas a Pagar, o time corrige pelo botão **Editar** — e a requisição volta automaticamente à aprovação, porque o orçamento consumido muda.",
          },
          {
            q: "A requisição está “Enviado Pgto” há dias. Já foi paga?",
            a: "Não necessariamente. *Enviado Pgto* significa que o título foi criado no Omie; o status muda para **Pago** quando o título é baixado lá.",
          },
          {
            q: "Preciso cancelar uma requisição já enviada ao pagamento.",
            a: "O time de Contas a Pagar usa **Devolver**: o título é excluído no Omie e a requisição volta ao fluxo. Se ela já estiver paga, o acerto precisa ser feito primeiro no Omie.",
          },
          {
            q: "Aprovei sem querer. Dá para desfazer?",
            a: "Não existe botão de desfazer aprovação. Enquanto a requisição estiver em Aguardando Envio, o Contas a Pagar consegue devolvê-la à aprovação; depois de paga, o acerto é no Omie.",
          },
          {
            q: "Comprei parcelado. Preciso criar uma requisição por parcela?",
            a: "Não. Escolha cartão de crédito, informe o número de parcelas e o sistema cria uma requisição por parcela, com vencimento no dia 05 e verificação de orçamento mês a mês.",
          },
          {
            q: "Não encontro a tela que preciso no menu.",
            a: "O menu mostra apenas o que o seu perfil acessa. Se você deveria enxergar uma tela e ela não aparece, o ajuste é no seu perfil ou nos seus setores vinculados — fale com o administrador do Control Hub.",
          },
        ],
      },
    ],
  },
];
