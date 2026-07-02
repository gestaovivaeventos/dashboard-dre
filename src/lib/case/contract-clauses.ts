import { FORO } from "@/lib/case/contract-config";

// Texto das cláusulas 1ª–13 transcrito EXATAMENTE do modelo de referência
// (docs/Contrato CASE Shows.dc.html). Não reescrever/resumir. `b` é o prefixo
// em negrito ("Parágrafo único:" etc.); `t`, o restante do parágrafo.
export interface ClausePara {
  t: string;
  b?: string;
}
export interface Clause {
  titulo: string;
  paras: ClausePara[];
}

export const CLAUSULAS: Clause[] = [
  {
    titulo: "Cláusula 1ª — Do Objeto",
    paras: [
      { t: "1.1 - A prestação de serviços aqui pactuada será realizada nos moldes do item I, desde que cumpridas todas as exigências constantes deste instrumento e seus anexos." },
    ],
  },
  {
    titulo: "Cláusula 2ª — Do Prazo",
    paras: [
      { t: "2.1 – O serviço será prestado estritamente pelo período indicado no item I." },
      { t: "2.2 – Fica desde já estipulado que qualquer alteração de horário precisa ser previamente acordada pelas partes, que podem optar por desconto ou acréscimo proporcional no preço em caso de modificação da duração ou pela rescisão do contrato com culpa daquele que pretendeu a alteração." },
      { b: "Parágrafo Primeiro:", t: "Poderá ser estipulado e constar no item I, período de tolerância, o qual não configurará alteração de horário." },
      { b: "Parágrafo Segundo:", t: "Será considerado serviço prestado o período em que o artista se encontrar à disposição do CONTRATANTE, após o horário estipulado, ainda que não esteja realizando performance, sendo liberalidade do CONTRATADO prorrogar a extensão da apresentação mediante pagamento nos termos previstos no caput." },
    ],
  },
  {
    titulo: "Cláusula 3ª — Do Preço e Condições de Pagamento",
    paras: [
      { t: "3.1 - O CONTRATANTE pagará ao CONTRATADO o preço conforme estipulado no item III e anexos deste contrato." },
      { b: "Parágrafo único:", t: "O atraso de qualquer parcela ensejará multa de 10% (dez por cento) sobre o valor do débito, acrescidos de juros moratórios de 1% ao mês e correção monetária pelo índice do TJMG. Se a inadimplência perdurar por mais de 10 dias corridos, o CONTRATANTE poderá ser notificado para o pagamento e responder ação de cobrança ou de execução, conforme o caso, quando serão devidos também honorários advocatícios no importe de 20% sobre o valor devido atualizado bem como as despesas para a efetivação da cobrança." },
      { t: "3.2 – Diante do atraso no pagamento de qualquer das parcelas, se reserva o CONTRATADO no direito de rescindir o presente contrato nos termos da cláusula de rescisão além de aplicar a multa por descumprimento contratual." },
      { t: "3.3- Se o CONTRATANTE se encontrar inadimplente até 07 (sete) dias úteis antes do evento, o mesmo deverá quitar a integralidade do débito à vista, em dinheiro ou apresentar o respectivo comprovante bancário, sob pena de rescisão do contrato nos termos da cláusula de rescisão e aplicação da multa por descumprimento contratual." },
    ],
  },
  {
    titulo: "Cláusula 4ª — Das Obrigações do Contratante",
    paras: [
      { t: "4.1 - O CONTRATANTE se obriga a:" },
      { t: "a - Cumprir este instrumento e seus anexos, fornecendo todos os itens indicados, equipamentos solicitados bem como condições hábeis para a prestação dos serviços." },
      { t: "b – Realizar pontualmente o pagamento na forma acordada." },
      { t: "c – Divulgar referida apresentação utilizando apenas materiais para publicidade fornecidos ou aprovados pelo CONTRATADO bem como gravar e veicular a apresentação apenas se autorizado. É vedado reproduzir a performance do artista sem o consentimento expresso do CONTRATADO." },
      { t: "d – Em caso de evento com bilheteria, proceder a venda de ingressos respeitando os valores de lote que deverão ser previamente informados ao CONTRATADO." },
      { t: "e - Se responsabilizar por toda e qualquer repercussão originada do público e/ou convidados do evento, inclusive, quanto a capacidade do local, resguardado, o direito de regresso do CONTRATADO." },
      { t: "f - Promover evento regular, em estrito cumprimento as normas e leis vigentes aplicáveis à espécie, mormente no que concerne a autorizações, alvarás, licenças, medidas de segurança, EAD, direitos autorais, pagamentos de tributos e outra determinação de autoridade ou órgão público." },
      { t: "g - Enviar previamente para o CONTRATADO toda a documentação e informação necessária e indispensável para a efetivação desta prestação de serviço, inclusive para utilização dos meios de transporte e ingresso no local do evento." },
      { t: "h – Fornecer equipe qualificada para exercer a segurança do artista e equipe, bem como para auxiliar/executar a montagem e desmontagem da apresentação." },
      { t: "i – Restringir o acesso ao camarim, limitado a equipe de produção e banda do artista e outras pessoas por ele autorizadas. Visitas ao camarim por terceiros ou convidados deverão ser solicitadas com antecedência e dependerão da expressa aprovação do artista." },
      { t: "j – Assegurar o bom funcionamento do evento, especialmente com relação a segurança do público e do artista, mantendo a ordem, contendo tumultos e impedindo que pessoas subam no palco ou atrapalhem a apresentação de alguma forma." },
      { t: "k – Garantir a perfeita execução do evento, especialmente no que concerne ao cumprimento dos horários das apresentações musicais, inclusive, realizando a contratação de gerador de energia de modo a se precaver de eventual falta de energia elétrica." },
    ],
  },
  {
    titulo: "Cláusula 5ª — Das Obrigações do Contratado",
    paras: [
      { t: "5.1 – O CONTRATADO fica obrigado a:" },
      { t: "a – Realizar a contratação do artista, objeto deste contrato, para executar a prestação de serviços nos termos pactuados." },
      { b: "Parágrafo único:", t: "Não é objeto da prestação de serviços a produção ou reprodução de vídeos ou publicidades do evento, por parte do CONTRATADO ou do artista, sendo mera liberalidade destes realizarem qualquer divulgação." },
    ],
  },
  {
    titulo: "Cláusula 6ª — Das Responsabilidades",
    paras: [
      { t: "6.1 – A responsabilidade pela execução do evento é integralmente do CONTRATANTE, o qual responderá por eventuais danos patrimoniais, físicos ou morais ocorridos no local, no curso desta prestação de serviços, resguardado o direito de regresso do CONTRATADO." },
      { t: "6.2 – Na hipótese do artista se encontrar no local do evento no horário previsto e a apresentação não se efetivar por qualquer motivo que tenha como origem ação ou omissão do CONTRATANTE, o serviço será considerado prestado na integralidade, sendo devido a totalidade do valor aqui pactuado." },
    ],
  },
  {
    titulo: "Cláusula 7ª — Da Cessão do Contrato",
    paras: [
      { t: "7.1 – Este instrumento obriga as partes, sendo vedado a cessão de direitos, salvo se no interesse e com autorização do CONTRATADO." },
    ],
  },
  {
    titulo: "Cláusula 8ª — Do Caso Fortuito ou Força Maior",
    paras: [
      { t: "8.1 – Na hipótese de caso fortuito ou força maior, nos termos do artigo 393 do Código Civil, o contrato será extinto sem ônus para as partes." },
      { b: "Parágrafo Primeiro:", t: "Serão considerados, para fins desta cláusula, como caso fortuito ou força maior, fatos imprevisíveis e inevitáveis, não relacionados com a atividade fim dos contratantes, tais como intempéries que impossibilitem a execução do evento ou a apresentação do artista, bloqueio de estradas, cancelamento de voos, enfermidade ou morte do artista ou de membro indispensável da equipe." },
      { b: "Parágrafo Segundo:", t: "Prejuízos decorrentes de obrigações pelas quais o CONTRATANTE expressamente se responsabilizou ou de situações inevitáveis mas que poderiam ser imediatamente solucionadas se houvessem sido tomadas medidas de prevenção, como falta de energia elétrica por inexistência de gerador extra, não serão considerados caso fortuito ou força maior." },
    ],
  },
  {
    titulo: "Cláusula 9ª — Cláusula Penal",
    paras: [
      { t: "9.1 - A parte que descumprir quaisquer das suas obrigações previstas neste instrumento ficará sujeita ao pagamento de multa contratual no valor correspondente a 20% (vinte por cento) do valor total deste contrato, sem prejuízo das eventuais perdas e danos cabíveis." },
    ],
  },
  {
    titulo: "Cláusula 10 — Da Rescisão",
    paras: [
      { t: "10.1 - A parte que pretender a rescisão do presente instrumento deverá comunicar à outra sua intenção por meio de prévia notificação, sendo devido além dos valores que deviam ter sido adimplidos até a data da efetiva rescisão, multa de caráter indenizatório no importe de 30% (trinta por cento) do valor total do contrato se rescindido até 03 (três) meses antes do evento e 50% (cinquenta por cento) do valor total do contrato, se após esse prazo." },
      { b: "Parágrafo único:", t: "O contrato também poderá ser extinto pela parte lesada em face de eventual descumprimento contratual, quando será aplicado o disposto na cláusula 10.1, cumulativamente com a multa pactuada na cláusula penal." },
    ],
  },
  {
    titulo: "Cláusula 11 — Disposições Gerais",
    paras: [
      { t: "11.1 - Se, por qualquer motivo, o CONTRATADO for envolvido judicial ou extrajudicialmente em reclamações, ações, notificações, manifestações de quaisquer pessoas que se sentirem prejudicadas, por ato doloso ou culposo praticado pelo CONTRATANTE, seus empregados, terceirizados, clientes ou público do evento, este deverá ressarcir o CONTRATADO por todas as despesas incorridas em sua defesa, bem como em eventual condenação mesmo que solidária ou subsidiária, custas administrativas e judiciais, honorários de perito e de advogado, inclusive de sucumbência, computados até a exclusão do CONTRATADO do polo passivo, da extinção da ação ou ainda resolução administrativa da questão." },
      { t: "11.2 – Fazem parte integrante deste contrato os anexos indicados no item III, quando existentes." },
      { t: "11.3 - Toda e qualquer comunicação entre os contratantes deverá ser formalizada por escrito mediante ciência de recebimento." },
      { t: "11.4 - Qualquer alteração, modificação, complementação, ou ajuste, somente será reconhecido e produzirá efeitos legais, se incorporado ao presente contrato mediante Termo Aditivo/Anexo/Adendo, devidamente assinado pelas partes contratantes." },
      { t: "11.5 - As obrigações ora assumidas pelas Partes estão sujeitas à execução específica nos termos do artigo 771 e seguintes do Código de Processo Civil, servindo este instrumento como título executivo extrajudicial nos termos do artigo 784, III, do Código de Processo Civil." },
    ],
  },
  {
    titulo: "Cláusula 12 — COVID-19",
    paras: [
      { t: "12.1. Considerando a atual situação do país diante da pandemia do COVID-19 que impõe a necessidade de medidas restritivas, especialmente a suspensão de eventos que propiciem a aglomeração de pessoas, as partes ficam desde já cientes que a data do evento no qual será realizada a execução do objeto deste contrato poderá ser alterada." },
      { t: "12.2. No caso de modificação da data em razão única e exclusiva de legislação ou orientação de suspensão em virtude do COVID-19, o contrato permanecerá vigente e a designação de nova data será feita pelo CONTRATANTE, podendo ser realocada para até 180 (cento e oitenta) dias após a data previamente contratada, mediante estabilização da situação, viabilidade e disponibilidade dos fornecedores envolvidos. Após o prazo citado acima, o valor estará passível de reajustes para execução do objeto contratado." },
      { t: "12.3. Designada nova data pelo CONTRATANTE, o CONTRATADO deverá ser manifestar no prazo de 48 (quarenta e oito) horas aceitando ou comprovando documentalmente sua indisponibilidade. Na hipótese de impossibilidade de execução pelo CONTRATADO, devidamente comprovada, o contrato será extinto através de distrato contratual, sem ônus para as partes com a respectiva devolução integral dos valores eventualmente adimplidos." },
      { t: "12.4. A recusa injustificada para a execução dos serviços configurará descumprimento contratual passível de multa." },
    ],
  },
  {
    titulo: "Cláusula 13 — Foro",
    paras: [
      { t: `Elegem as partes o foro da ${FORO}, para controvérsias que possam surgir do presente contrato, podendo o CONTRATADO optar pelo foro do CONTRATANTE.` },
    ],
  },
];

export const CLAUSULA_FECHAMENTO =
  "E por estarem assim justos e contratados, assinam o presente em duas vias de igual forma e teor, na presença de duas testemunhas, para que possa produzir todos os seus efeitos de direito.";
