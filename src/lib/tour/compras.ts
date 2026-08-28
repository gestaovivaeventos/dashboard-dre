// Conteúdo do tour guiado do módulo COMPRAS.
//
// FONTE ÚNICA dos passos. Convive com o **manual** (`@/lib/ctrl/manual`), que é
// a fonte única das REGRAS: o manual explica alçada, status e trava; o tour
// mostra onde ficam os botões e em que ordem usá-los. Quando uma regra do
// módulo mudar, o manual é o texto obrigatório a atualizar — aqui só entra o
// que o usuário precisa saber para se localizar na tela.
//
// ⚠️ Passo cujo `data-tour` não existe na tela é PULADO em silêncio. Isso é o
//    que permite um mesmo roteiro servir cinco perfis: o botão que o perfil não
//    tem simplesmente não vira passo. O outro lado da moeda é que renomear uma
//    âncora sem atualizar este arquivo apaga o passo sem erro nenhum.
//
// QUEM VÊ CADA TELA não está escrito aqui: cada tela traz o `navKey` do item
// correspondente no menu, e o provider recebe as chaves que o menu daquele
// usuário realmente montou. Mexer na permissão de uma tela (navigation.ts) leva
// o tour junto. O campo `audiences` dos passos é outra coisa — é variação de
// TEXTO para quem enxerga a mesma tela com autonomia diferente.

import type { TourModule } from "@/lib/tour/types";

/** Quem decide requisições — as duas etapas de aprovação. */
const APROVADORES = ["gerente", "gerente_setor", "diretor", "admin"] as const;

export const COMPRAS_TOUR: TourModule = {
  id: "compras",
  navGroupId: "compras",
  label: "Compras",
  summary:
    "O caminho de uma despesa: requisição, orçamento, aprovações e o pagamento lançado no Omie.",
  screens: [
    // ─────────────────────────────────────────────────────────────── início
    {
      id: "home",
      label: "Início",
      scope: "global",
      path: "/home",
      steps: [
        {
          anchor: null,
          title: "Bem-vindo ao módulo Compras",
          body:
            "Um passeio rápido pelo caminho de uma compra: de quem pede até o pagamento lançado no Omie. Leva uns 4 minutos, e o roteiro mostra só as telas que o seu acesso abre. Você pode sair quando quiser em “Pular tour”.",
        },
        {
          anchor: null,
          title: "O caminho de toda requisição",
          body:
            "São seis etapas, sempre na mesma ordem. 1) O solicitante cria a requisição. 2) O sistema faz a verificação orçamentária e decide quantas aprovações ela precisa. 3) O gerente do setor aprova. 4) O diretor aprova — etapa que só existe quando a despesa está fora do orçamento ou o setor é direcionado à diretoria. 5) O Contas a Pagar confere e envia o pagamento ao Omie. 6) Quando o título é baixado no Omie, a requisição vira Pago.",
        },
        {
          anchor: null,
          title: "Onde você entra nesse caminho",
          body:
            "Você faz a etapa 1: cria a requisição e acompanha. Depois de enviar, ela fica aguardando a aprovação do gerente — e do diretor também, se estiver fora do orçamento. Você não aprova, não altera valor depois do envio e não envia pagamento; o que cabe a você é responder rápido quando alguém pedir informação.",
          audiences: ["solicitante"],
        },
        {
          anchor: null,
          title: "Onde você entra nesse caminho",
          body:
            "Você faz a etapa 3: aprova, rejeita ou pede informação nas requisições dos setores vinculados ao seu usuário. Dentro do orçamento, a sua aprovação encerra o fluxo e a requisição segue direto para pagamento. Fora do orçamento, você aprova e ela ainda passa pelo diretor. Você também pode criar requisições.",
          audiences: ["gerente", "gerente_setor"],
        },
        {
          anchor: null,
          title: "Onde você entra nesse caminho",
          body:
            "Você faz a etapa 4, a aprovação final. Ela existe em três situações: despesa fora do orçamento, setor direcionado à diretoria e solicitante direcionado por regra. Você enxerga todos os setores em Aprovações — os setores vinculados ao seu usuário servem para destacar o que é da sua área e para direcionar o e-mail diário de pendências.",
          audiences: ["diretor"],
        },
        {
          anchor: null,
          title: "Onde você entra nesse caminho",
          body:
            "Você faz a etapa 5 — e é o único perfil que envia o pagamento ao Omie. Recebe tudo que já foi aprovado, confere, corrige rota (setor, tipo, método), pede esclarecimento, devolve o que precisa voltar e envia. É a última barreira antes de o dinheiro sair.",
          audiences: ["contas_a_pagar"],
        },
        {
          anchor: null,
          title: "Onde você entra nesse caminho",
          body:
            "Como administrador você enxerga o módulo inteiro: todas as telas, todos os setores e todas as etapas. O roteiro a seguir passa por cada uma delas.",
          audiences: ["admin"],
        },
        {
          anchor: "nav-menu",
          title: "O menu lateral",
          body:
            "As telas do módulo ficam agrupadas em COMPRAS. Você enxerga as que o seu perfil usa — por isso o menu de duas pessoas com perfis diferentes não é igual. O último item, Manual, é a referência completa das regras.",
          placement: "right",
        },
        {
          anchor: "home-atencao",
          title: "Precisa da sua atenção",
          body:
            "A faixa vermelha reúne o que está parado esperando VOCÊ. Ela só aparece quando existe pendência sua — tela sem faixa é tela sem nada travado no seu nome.",
          placement: "bottom",
        },
        {
          anchor: "home-aprovacoes",
          title: "Aprovações pendentes",
          body:
            "Resumo do que aguarda a sua decisão, com atalho para a tela de Aprovações. Todo dia útil, às 10h, você também recebe um e-mail com essa mesma lista.",
          placement: "top",
        },
        {
          anchor: "home-fila-pagamento",
          title: "Fila de pagamento",
          body: "O que já foi aprovado e espera conferência e envio ao Omie.",
          placement: "top",
        },
        {
          anchor: "home-minhas-requisicoes",
          title: "Minhas requisições",
          body: "As suas últimas requisições e em que etapa cada uma está, sem precisar abrir a tela cheia.",
          placement: "top",
        },
        {
          anchor: "topbar-sino",
          title: "Notificações",
          body:
            "Toda mudança na sua requisição — aprovação, pedido de informação, rejeição, pagamento — vira notificação aqui. O número é o que você ainda não leu.",
          placement: "bottom",
        },
        {
          anchor: "tour-btn-compras",
          title: "Este botão traz o tour de volta",
          body:
            "O “?” ao lado do nome do módulo reabre esta explicação a qualquer momento, começando pela tela em que você estiver. Não precisa decorar nada agora.",
          placement: "right",
        },
      ],
    },

    // ────────────────────────────────────────────────────────── requisições
    {
      id: "requisicoes",
      label: "Requisições",
      scope: "global",
      path: "/ctrl/requisicoes",
      navKey: "ct-req",
      steps: [
        {
          anchor: null,
          title: "Requisições",
          body:
            "A sua tela de acompanhamento: aqui estão as requisições que você criou e o status de cada uma. É onde você descobre em que etapa a sua despesa parou.",
          audiences: ["solicitante"],
        },
        {
          anchor: null,
          title: "Requisições",
          body:
            "Além das que você mesmo criou, esta tela lista todas as requisições dos setores sob sua responsabilidade, em qualquer status — inclusive aprovadas, pagas e rejeitadas. É acompanhamento e histórico; decidir é na tela Aprovações.",
          audiences: ["gerente", "gerente_setor", "diretor"],
        },
        {
          anchor: null,
          title: "Requisições",
          body:
            "A visão completa: todas as requisições do módulo, em qualquer status. É a tela para procurar uma requisição específica pelo número ou pelo título.",
          audiences: ["contas_a_pagar", "admin"],
        },
        {
          anchor: "req-nova",
          title: "Nova Requisição",
          body:
            "Abre o formulário onde a despesa nasce. Toda compra ou pagamento a fornecedor deve começar por aqui — é o que garante orçamento controlado e o rastro de quem pediu e quem aprovou.",
          placement: "left",
        },
        {
          anchor: "req-busca",
          title: "Busca",
          body: "Aceita o número da requisição (com ou sem #), o título, o valor ou o status. Os cabeçalhos da tabela também filtram e ordenam coluna a coluna.",
          placement: "bottom",
        },
        {
          anchor: "req-tabela",
          title: "A coluna Status é a resposta rápida",
          body:
            "“Aguardando Gerente” e “Aguardando Diretor” são etapas de aprovação; “Aprovado” quer dizer que já está na fila do Contas a Pagar; “Enviado Pgto” é título criado no Omie; “Pago” é o único status que confirma pagamento de fato. Em Detalhes você vê o histórico completo, e Anexos abre os documentos.",
          placement: "top",
        },
        {
          anchor: "req-tabela",
          title: "Quando aparecer Responder, é com você",
          body:
            "“Complementação” significa que um aprovador fez uma pergunta; “Info pendente” é o time de Contas a Pagar perguntando, já na fase de pagamento. Nos dois casos a requisição fica PARADA até você responder pelo botão Responder.",
          placement: "top",
          audiences: ["solicitante"],
        },
        {
          anchor: "req-atualizar-pagamentos",
          title: "Atualizar pagamentos",
          body:
            "Consulta no Omie quais títulos já foram baixados e marca as requisições como Pago. A conferência também roda sozinha na sincronização diária — este botão só antecipa.",
          placement: "left",
        },
      ],
    },

    // ────────────────────────────────────────────────────── nova requisição
    {
      id: "nova-requisicao",
      label: "Nova Requisição",
      scope: "global",
      path: "/ctrl/requisicoes/nova",
      navKey: "ct-req",
      steps: [
        {
          anchor: null,
          title: "O formulário da requisição",
          body:
            "Os campos abaixo definem de qual orçamento a despesa sai, quem vai aprovar e como o pagamento será feito. Vamos passar pelos que mais geram devolução.",
        },
        {
          anchor: "nova-descricao",
          title: "Descrição",
          body:
            "É o que o aprovador lê primeiro. Escreva o que é, para quem e o período — “Serviço de limpeza — referência maio/2026”. Evite “pagamento”, “compra”, “serviço”.",
          placement: "bottom",
        },
        {
          anchor: "nova-setor-tipo",
          title: "Setor e Tipo de Despesa",
          body:
            "É esse par que define de qual orçamento a despesa sai, quem aprova e qual categoria será usada no Omie. Errar aqui é o motivo mais comum de devolução. A lista de setores mostra só os vinculados ao seu usuário — se vier vazia, peça o vínculo ao administrador.",
          placement: "bottom",
        },
        {
          anchor: "nova-fornecedor",
          title: "Fornecedor",
          body:
            "Busque por nome ou CNPJ. Se não existir, cadastre na tela Fornecedores. Fornecedor ainda não homologado pode ser usado normalmente: a requisição percorre toda a aprovação — o que trava é o envio do pagamento lá no fim.",
          placement: "bottom",
        },
        {
          anchor: "nova-evento",
          title: "Evento",
          body: "Obrigatório quando há eventos cadastrados. Se a despesa não pertence a nenhum, escolha explicitamente “Nenhum evento”.",
          placement: "bottom",
        },
        {
          anchor: "nova-metodo",
          title: "Método de pagamento",
          body:
            "Cada método pede campos diferentes. Boleto exige o anexo e lê o código de barras do arquivo; PIX e Transferência só aparecem se o fornecedor tiver esses dados cadastrados — método esmaecido é cadastro de fornecedor incompleto.",
          placement: "bottom",
        },
        {
          anchor: "nova-valor",
          title: "Valor, vencimento e competência",
          body:
            "Vencimento é a data em que o pagamento precisa sair — requisição cadastrada até as 12h pode vencer no mesmo dia; depois disso, o mínimo é o dia seguinte. Logo abaixo, a Competência (mês/ano) é o mês a que a despesa se refere, que nem sempre é o do vencimento.",
          placement: "top",
        },
        {
          anchor: "nova-anexos",
          title: "Anexos",
          body:
            "Boleto, nota fiscal, contrato, cupom. Até 10 MB por arquivo, em PDF, JPG, PNG, DOC ou XLS. Os anexos seguem para o Omie junto com o pagamento — anexar aqui evita a pergunta depois.",
          placement: "top",
        },
        {
          anchor: "nova-verificar",
          title: "Verificar Orçamento — passo obrigatório",
          body:
            "Este clique compara o valor com o saldo anual do setor e do tipo de despesa, e é ele que decide o caminho: dentro do orçamento, só o gerente aprova; fora, a requisição ganha o prefixo NÃO ORÇADO, exige justificativa e passa também pelo diretor. Sem verificar, o botão de envio não libera.",
          placement: "top",
        },
        {
          anchor: "nova-enviar",
          title: "Enviar Requisição",
          body:
            "A partir daqui a requisição é sua só para acompanhar: o solicitante não edita depois do envio. Para corrigir, peça ao aprovador para rejeitar e crie uma nova — ou, se já estiver em Contas a Pagar, peça para devolver.",
          placement: "top",
        },
      ],
    },

    // ────────────────────────────────────────────────────────── aprovações
    {
      id: "aprovacoes",
      label: "Aprovações",
      scope: "global",
      path: "/ctrl/aprovacoes",
      navKey: "ct-apr",
      steps: [
        {
          anchor: null,
          title: "Aprovações",
          body:
            "A sua fila de decisão. Você vê as requisições dos setores vinculados ao seu usuário, e o botão de ação só aparece naquelas em que você tem alçada na etapa atual — requisição já na etapa do diretor você acompanha, mas não decide.",
          audiences: ["gerente", "gerente_setor"],
        },
        {
          anchor: null,
          title: "Aprovações",
          body:
            "Aqui você enxerga todos os setores, e a tela separa visualmente “Do seu setor” de “Demais setores”. As duas seções sempre aparecem, mesmo vazias, para deixar claro quando não há nada seu pendente.",
          audiences: ["diretor"],
        },
        {
          anchor: null,
          title: "Aprovações",
          body:
            "A fila de decisão do módulo. O botão de ação só aparece nas requisições em que você tem alçada naquela etapa; o resto é acompanhamento.",
          audiences: ["contas_a_pagar", "admin"],
        },
        {
          anchor: "apr-abas",
          title: "As abas",
          body:
            "“Pendentes” reúne o que aguarda decisão — as duas etapas juntas. “Complementação” são as requisições com pergunta em aberto: quando o solicitante responde, a aba mostra um alerta vermelho com a contagem. “Aprovadas” e “Rejeitadas” são o histórico.",
          placement: "bottom",
        },
        {
          anchor: "apr-tabela",
          title: "Decidir: as três ações",
          body:
            "Abra Detalhes antes — lá estão valor, fornecedor, dados de pagamento, justificativa, anexos e o histórico. Depois: Aprovar encaminha à etapa seguinte; Pedir informação abre uma conversa com o solicitante sem perder a etapa; Rejeitar encerra e exige motivo, que vai para o solicitante.",
          placement: "top",
        },
        {
          anchor: "apr-lote",
          title: "Aprovação em lote",
          body:
            "Marque as caixas (ou “Selecionar todas”) e aprove até 50 de uma vez. O lote respeita os filtros aplicados nas colunas e ignora o que estiver fora da sua alçada.",
          placement: "bottom",
        },
        {
          anchor: null,
          title: "Confira antes de aprovar",
          body:
            "Setor e tipo de despesa corretos — é o que consome o orçamento certo —, valor batendo com o anexo, fornecedor certo e vencimento viável. Depois que o pagamento é lançado, corrigir exige acerto no Omie.",
          audiences: [...APROVADORES],
        },
      ],
    },

    // ────────────────────────────────────────────────────── contas a pagar
    {
      id: "contas-a-pagar",
      label: "Contas a Pagar",
      scope: "global",
      path: "/ctrl/contas-a-pagar",
      navKey: "ct-cap",
      steps: [
        {
          anchor: null,
          title: "Contas a Pagar",
          body:
            "Tudo que terminou a aprovação chega aqui. É onde a requisição vira título no Omie — a última conferência antes de o dinheiro sair.",
        },
        {
          anchor: "cap-abas",
          title: "As três abas",
          body:
            "“Aguardando Envio” são as aprovadas ainda sem título no Omie. “Info Pendente” são as que têm pergunta em aberto ao solicitante — o envio fica bloqueado até a resposta. “Enviados” já têm título lançado.",
          placement: "bottom",
        },
        {
          anchor: "cap-tabela",
          title: "Conferir, editar e devolver",
          body:
            "Em Detalhes estão dados bancários, anexos, fornecedor e a categoria Omie prevista. Editar ajusta setor, tipo, método e dados do pagamento — mudar setor ou tipo DEVOLVE a requisição à aprovação para nova validação orçamentária, e isso é intencional. Devolver exige motivo: sem título no Omie ela volta à aprovação; com título, o sistema exclui o título lá antes.",
          placement: "top",
        },
        {
          anchor: "cap-enviar",
          title: "Enviar para Pagamento",
          body:
            "Marque as requisições e envie. Você escolhe a empresa pagadora, que define em qual Omie o título será criado. O envio é assíncrono: elas ficam como “Enviando ao Omie” e o sistema lança uma por empresa a cada minuto — não precisa manter a tela aberta.",
          placement: "top",
        },
        {
          anchor: null,
          title: "Duas coisas que travam ou confundem",
          body:
            "Fornecedor não homologado trava o LOTE INTEIRO: nada é enviado, para não gerar envio parcial em silêncio — homologue o cadastro ou desmarque a requisição. E “Enviado Pgto” não é pago: significa apenas que o título foi criado no Omie. O status Pago só aparece quando o título é baixado lá.",
        },
      ],
    },

    // ────────────────────────────────────────────────────────────  orçamento
    {
      id: "orcamento",
      label: "Orçamento",
      scope: "global",
      path: "/ctrl/orcamento",
      navKey: "ct-orc",
      steps: [
        {
          anchor: null,
          title: "Orçamento",
          body:
            "O orçamento do ano por tipo de despesa. É a mesma base que a requisição consulta na verificação orçamentária — o que você vê aqui é o que decide se uma despesa vai precisar do diretor.",
        },
        {
          anchor: null,
          title: "Esta tela mostra só os seus setores",
          body:
            "No perfil Gerente, o orçamento é recortado pelos setores vinculados ao seu usuário. Se a tela vier vazia, é porque nenhum setor foi vinculado — peça ao administrador na tela de Usuários.",
          audiences: ["gerente_setor"],
        },
        {
          anchor: "orc-kpis",
          title: "Orçado, Realizado, Pendente e Disponível",
          body:
            "“Pendente” é o que já foi requisitado e ainda não virou pagamento — ele consome saldo desde a criação. Por isso o Disponível cai antes mesmo de a despesa acontecer: é o que impede duas requisições grandes furarem o mesmo orçamento.",
          placement: "bottom",
        },
        {
          anchor: "orc-tabela",
          title: "Clique na linha para abrir por setor",
          body:
            "Cada tipo de despesa se abre no detalhamento por setor, com a barra de execução. Rejeitar, devolver ou excluir uma requisição libera o valor de volta sozinho na próxima leitura — não existe lançamento manual de consumo.",
          placement: "top",
        },
      ],
    },

    // ───────────────────────────────────────────────────────────  relatórios
    {
      id: "relatorios",
      label: "Relatórios",
      scope: "global",
      path: "/ctrl/relatorios",
      navKey: "ct-rel",
      steps: [
        {
          anchor: null,
          title: "Relatórios",
          body: "A visão consolidada de todas as requisições, para analisar fora do fluxo do dia a dia.",
        },
        {
          anchor: "rel-filtros",
          title: "Filtrar e ordenar por coluna",
          body: "Cada coluna tem o seu filtro na linha abaixo do cabeçalho, e clicar no título ordena. Os filtros se somam.",
          placement: "bottom",
        },
        {
          anchor: "rel-exportar",
          title: "Exportar XLSX",
          body: "Baixa exatamente o que os filtros deixaram na tela — não a base inteira. Filtre primeiro, exporte depois.",
          placement: "left",
        },
      ],
    },

    // ────────────────────────────────────────────────────────── fornecedores
    {
      id: "fornecedores",
      label: "Fornecedores",
      scope: "global",
      path: "/ctrl/admin/fornecedores",
      navKey: "ct-forn",
      steps: [
        {
          anchor: null,
          title: "Fornecedores",
          body:
            "Tela colaborativa: qualquer perfil do módulo consulta e cadastra. A homologação — a aprovação do cadastro — é feita pelo gerente ou pelo Contas a Pagar.",
        },
        {
          anchor: "forn-novo",
          title: "Cadastrar fornecedor",
          body:
            "CNPJ (14 caracteres, aceita o novo formato com letras) ou CPF é obrigatório, e o endereço completo também — a Omie recusa o cadastro sem ele. Fornecedor estrangeiro dispensa o documento, mas exige País e Estado.",
          placement: "left",
        },
        {
          anchor: "forn-abas",
          title: "Aprovados, Pendentes e Rejeitados",
          body:
            "Cadastro novo entra como Pendente. Na aba Pendentes, o recorte “Novos cadastros” separa o que foi cadastrado aqui dos cerca de mil pendentes antigos importados do Omie — são esses que escondem os cadastros de verdade.",
          placement: "bottom",
        },
        {
          anchor: "forn-busca",
          title: "Busca",
          body: "Aceita nome ou CNPJ/CPF, com ou sem pontuação. Se não achar, confira se o fornecedor está em outra aba.",
          placement: "bottom",
        },
        {
          anchor: null,
          title: "Pendente não impede pedir — impede pagar",
          body:
            "Você pode criar a requisição com um fornecedor pendente e ela percorre toda a aprovação normalmente. O bloqueio vem no fim, no envio do pagamento. Se a despesa é urgente, peça a homologação em paralelo.",
        },
      ],
    },

    // ──────────────────────────────────────────────────────────────  manual
    {
      id: "manual",
      label: "Manual",
      scope: "global",
      path: "/ctrl/manual",
      navKey: "ct-manual",
      steps: [
        {
          anchor: null,
          title: "O manual do módulo",
          body:
            "Este tour mostrou onde ficam as coisas; o manual explica as regras — alçadas, o significado de cada status, o que cada método de pagamento exige, parcelamento, recorrência, rateio e as dúvidas frequentes. Ele fica sempre no último item do menu COMPRAS, e é o lugar certo para conferir uma regra antes de perguntar.",
        },
      ],
    },
  ],
};
