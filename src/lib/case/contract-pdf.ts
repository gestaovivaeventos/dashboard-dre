import PDFDocument from "pdfkit";

// Dados do CONTRATADO — fixos (CS Agência), lidos do modelo padrão.
const CONTRATADO = {
  razao: "CS AGÊNCIA DE SHOWS E EVENTOS LTDA",
  cnpj: "30.595.153/0001-90",
  endereco: "Avenida Independência, 928 - Sala 1610 - Independência",
  cidade: "Taubaté/ SP",
  cep: "12.031-001",
};

// Dados bancários fixos do CONTRATADO (recebimento).
const DADOS_BANCARIOS = {
  favorecido: "CS Agência de Shows",
  banco: "Banco do Brasil",
  agencia: "0024-8",
  conta: "1.002.018-7",
  cnpj: "30.595.153/0001-90",
  pix: "30.595.153/0001-90",
};

const FORO = "Comarca de Juiz de Fora/MG";

const fmtBRL = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" });

function fmtDate(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso + (iso.length === 10 ? "T00:00:00" : ""));
  return Number.isNaN(d.getTime()) ? String(iso) : d.toLocaleDateString("pt-BR");
}

export interface ContractPdfData {
  contractNumber: number;
  // CONTRATANTE (cliente)
  cliente: {
    fundo: string; // razão social / nome (campo FUNDO do modelo)
    cnpj: string | null;
    respLegal: string | null;
    cpfResp: string | null;
    endereco: string | null;
    cidadeEstado: string | null;
    cep: string | null;
  };
  // I - OBJETO
  objeto: {
    artista: string;
    dataEvento: string | null;
    horario: string | null;
    passagemSom: string | null;
    duracao: string | null;
    local: string | null;
    endereco: string | null;
    cidadeEstado: string | null;
    cep: string | null;
    especificacoes: string | null;
  };
  // Valores cobrados do cliente
  valores: {
    atracao: number;
    rider: number;
    camarim: number;
    extras: number;
    total: number;
  };
  // Condições de pagamento (parcelas a receber do cliente)
  parcelas: Array<{ vencimento: string; valor: number }>;
}

// Texto integral das cláusulas do modelo padrão CS (transcrito do modelo oficial).
const CLAUSULAS: Array<{ titulo: string; itens: string[] }> = [
  {
    titulo: "Cláusula 1ª: DO OBJETO",
    itens: [
      "1.1 - A prestação de serviços aqui pactuada será realizada nos moldes do item I, desde que cumpridas todas as exigências constantes deste instrumento e seus anexos.",
    ],
  },
  {
    titulo: "Cláusula 2ª: DO PRAZO",
    itens: [
      "2.1 – O serviço será prestado estritamente pelo período indicado no item I.",
      "2.2 – Fica desde já estipulado que qualquer alteração de horário precisa ser previamente acordada pelas partes, que podem optar por desconto ou acréscimo proporcional no preço em caso de modificação da duração ou pela rescisão do contrato com culpa daquele que pretendeu a alteração.",
      "Parágrafo Primeiro: Poderá ser estipulado e constar no item I, período de tolerância, o qual não configurará alteração de horário.",
      "Parágrafo Segundo: Será considerado serviço prestado o período em que o artista se encontrar à disposição do CONTRATANTE, após o horário estipulado, ainda que não esteja realizando performance, sendo liberalidade do CONTRATADO prorrogar a extensão da apresentação mediante pagamento nos termos previstos no caput.",
    ],
  },
  {
    titulo: "Cláusula 3ª: DO PREÇO E CONDIÇÕES DE PAGAMENTO",
    itens: [
      "3.1 - O CONTRATANTE pagará ao CONTRATADO o preço conforme estipulado no item II e anexos deste contrato.",
      "Parágrafo único: O atraso de qualquer parcela ensejará multa de 10% (dez por cento) sobre o valor do débito, acrescidos de juros moratórios de 1% ao mês e correção monetária pelo índice do TJMG. Se a inadimplência perdurar por mais de 10 dias corridos, o CONTRATANTE poderá ser notificado para o pagamento e responder ação de cobrança ou de execução, conforme o caso, quando serão devidos também honorários advocatícios no importe de 20% sobre o valor devido atualizado bem como as despesas para a efetivação da cobrança.",
      "3.2 – Diante do atraso no pagamento de qualquer das parcelas, se reserva o CONTRATADO no direito de rescindir o presente contrato nos termos da cláusula de rescisão além de aplicar a multa por descumprimento contratual.",
      "3.3 - Se o CONTRATANTE se encontrar inadimplente até 07 (sete) dias úteis antes do evento, o mesmo deverá quitar a integralidade do débito à vista, em dinheiro ou apresentar o respectivo comprovante bancário, sob pena de rescisão do contrato nos termos da cláusula de rescisão e aplicação da multa por descumprimento contratual.",
    ],
  },
  {
    titulo: "Cláusula 4ª: DAS OBRIGAÇÕES DO CONTRATANTE",
    itens: [
      "4.1 - O CONTRATANTE se obriga a:",
      "a - Cumprir este instrumento e seus anexos, fornecendo todos os itens indicados, equipamentos solicitados bem como condições hábeis para a prestação dos serviços.",
      "b – Realizar pontualmente o pagamento na forma acordada.",
      "c – Divulgar referida apresentação utilizando apenas materiais para publicidade fornecidos ou aprovados pelo CONTRATADO bem como gravar e veicular a apresentação apenas se autorizado. É vedado reproduzir a performance do artista sem o consentimento expresso do CONTRATADO.",
      "d – Em caso de evento com bilheteria, proceder a venda de ingressos respeitando os valores de lote que deverão ser previamente informados ao CONTRATADO.",
      "e - Se responsabilizar por toda e qualquer repercussão originada do público e/ou convidados do evento, inclusive, quanto a capacidade do local, resguardado, o direito de regresso do CONTRATADO.",
      "f - Promover evento regular, em estrito cumprimento as normas e leis vigentes aplicáveis à espécie, mormente no que concerne a autorizações, alvarás, licenças, medidas de segurança, EAD, direitos autorais, pagamentos de tributos e outra determinação de autoridade ou órgão público.",
      "g - Enviar previamente para o CONTRATADO toda a documentação e informação necessária e indispensável para a efetivação desta prestação de serviço, inclusive para utilização dos meios de transporte e ingresso no local do evento.",
      "h – Fornecer equipe qualificada para exercer a segurança do artista e equipe, bem como para auxiliar/executar a montagem e desmontagem da apresentação.",
      "i – Restringir o acesso ao camarim, limitado a equipe de produção e banda do artista e outras pessoas por ele autorizadas. Visitas ao camarim por terceiros ou convidados deverão ser solicitadas com antecedência e dependerão da expressa aprovação do artista.",
      "j – Assegurar o bom funcionamento do evento, especialmente com relação a segurança do público e do artista, mantendo a ordem, contendo tumultos e impedindo que pessoas subam no palco ou atrapalhem a apresentação de alguma forma.",
      "k – Garantir a perfeita execução do evento, especialmente no que concerne ao cumprimento dos horários das apresentações musicais, inclusive, realizando a contratação de gerador de energia de modo a se precaver de eventual falta de energia elétrica.",
    ],
  },
  {
    titulo: "Cláusula 5ª: DAS OBRIGAÇÕES DO CONTRATADO",
    itens: [
      "5.1 – O CONTRATADO fica obrigado a:",
      "a – Realizar a contratação do artista, objeto deste contrato, para executar a prestação de serviços nos termos pactuados.",
      "Parágrafo único: Não é objeto da prestação de serviços a produção ou reprodução de vídeos ou publicidades do evento, por parte do CONTRATADO ou do artista, sendo mera liberalidade destes realizarem qualquer divulgação.",
    ],
  },
  {
    titulo: "Cláusula 6ª: DAS RESPONSABILIDADES",
    itens: [
      "6.1 – A responsabilidade pela execução do evento é integralmente do CONTRATANTE, o qual responderá por eventuais danos patrimoniais, físicos ou morais ocorridos no local, no curso desta prestação de serviços, resguardado o direito de regresso do CONTRATADO.",
      "6.2 – Na hipótese do artista se encontrar no local do evento no horário previsto e a apresentação não se efetivar por qualquer motivo que tenha como origem ação ou omissão do CONTRATANTE, o serviço será considerado prestado na integralidade, sendo devido a totalidade do valor aqui pactuado.",
    ],
  },
  {
    titulo: "Cláusula 7ª: DA CESSÃO DO CONTRATO",
    itens: [
      "7.1 – Este instrumento obriga as partes, sendo vedado a cessão de direitos, salvo se no interesse e com autorização do CONTRATADO.",
    ],
  },
  {
    titulo: "Cláusula 8ª: DO CASO FORTUITO OU FORÇA MAIOR",
    itens: [
      "8.1 – Na hipótese de caso fortuito ou força maior, nos termos do artigo 393 do Código Civil, o contrato será extinto sem ônus para as partes.",
      "Parágrafo Primeiro: Serão considerados, para fins desta cláusula, como caso fortuito ou força maior, fatos imprevisíveis e inevitáveis, não relacionados com a atividade fim dos contratantes, tais como intempéries que impossibilitem a execução do evento ou a apresentação do artista, bloqueio de estradas, cancelamento de voos, enfermidade ou morte do artista ou de membro indispensável da equipe.",
      "Parágrafo Segundo: Prejuízos decorrentes de obrigações pelas quais o CONTRATANTE expressamente se responsabilizou ou de situações inevitáveis mas que poderiam ser imediatamente solucionadas se houvessem sido tomadas medidas de prevenção, como falta de energia elétrica por inexistência de gerador extra, não serão considerados caso fortuito ou força maior.",
    ],
  },
  {
    titulo: "Cláusula 9ª: CLÁUSULA PENAL",
    itens: [
      "9.1 - A parte que descumprir quaisquer das suas obrigações previstas neste instrumento ficará sujeita ao pagamento de multa contratual no valor correspondente a 20% (vinte por cento) do valor total deste contrato, sem prejuízo das eventuais perdas e danos cabíveis.",
    ],
  },
  {
    titulo: "Cláusula 10: DA RESCISÃO",
    itens: [
      "10.1 - A parte que pretender a rescisão do presente instrumento deverá comunicar à outra sua intenção por meio de prévia notificação, sendo devido além dos valores que deviam ter sido adimplidos até a data da efetiva rescisão, multa de caráter indenizatório no importe de 30% (trinta por cento) do valor total do contrato se rescindido até 03 (três) meses antes do evento e 50% (cinquenta por cento) do valor total do contrato, se após esse prazo.",
      "Parágrafo único: O contrato também poderá ser extinto pela parte lesada em face de eventual descumprimento contratual, quando será aplicado o disposto na cláusula 10.1, cumulativamente com a multa pactuada na cláusula penal.",
    ],
  },
  {
    titulo: "Cláusula 11: DISPOSIÇÕES GERAIS",
    itens: [
      "11.1 - Se, por qualquer motivo, o CONTRATADO for envolvido judicial ou extrajudicialmente em reclamações, ações, notificações, manifestações de quaisquer pessoas que se sentirem prejudicadas, por ato doloso ou culposo praticado pelo CONTRATANTE, seus empregados, terceirizados, clientes ou público do evento, este deverá ressarcir o CONTRATADO por todas as despesas incorridas em sua defesa, bem como em eventual condenação mesmo que solidária ou subsidiária, custas administrativas e judiciais, honorários de perito e de advogado, inclusive de sucumbência, computados até a exclusão do CONTRATADO do polo passivo, da extinção da ação ou ainda resolução administrativa da questão.",
      "11.2 – Fazem parte integrante deste contrato os anexos indicados no item II, quando existentes.",
      "11.3 - Toda e qualquer comunicação entre os contratantes deverá ser formalizada por escrito mediante ciência de recebimento.",
      "11.4 - Qualquer alteração, modificação, complementação, ou ajuste, somente será reconhecido e produzirá efeitos legais, se incorporado ao presente contrato mediante Termo Aditivo/Anexo/Adendo, devidamente assinado pelas partes contratantes.",
      "11.5 - As obrigações ora assumidas pelas Partes estão sujeitas à execução específica nos termos do artigo 771 e seguintes do Código de Processo Civil, servindo este instrumento como título executivo extrajudicial nos termos do artigo 784, III, do Código de Processo Civil.",
    ],
  },
  {
    titulo: "Cláusula 12: COVID-19",
    itens: [
      "12.1. Considerando a atual situação do país diante da pandemia do COVID-19 que impõe a necessidade de medidas restritivas, especialmente a suspensão de eventos que propiciem a aglomeração de pessoas, as partes ficam desde já cientes que a data do evento no qual será realizada a execução do objeto deste contrato poderá ser alterada.",
      "12.2. No caso de modificação da data em razão única e exclusiva de legislação ou orientação de suspensão em virtude do COVID-19, o contrato permanecerá vigente e a designação de nova data será feita pelo CONTRATANTE, podendo ser realocada para até 180 (cento e oitenta) dias após a data previamente contratada, mediante estabilização da situação, viabilidade e disponibilidade dos fornecedores envolvidos. Após o prazo citado acima, o valor estará passível de reajustes para execução do objeto contratado.",
      "12.3. Designada nova data pelo CONTRATANTE, o CONTRATADO deverá se manifestar no prazo de 48 (quarenta e oito) horas aceitando ou comprovando documentalmente sua indisponibilidade. Na hipótese de impossibilidade de execução pelo CONTRATADO, devidamente comprovada, o contrato será extinto através de distrato contratual, sem ônus para as partes com a respectiva devolução integral dos valores eventualmente adimplidos.",
      "12.4. A recusa injustificada para a execução dos serviços configurará descumprimento contratual passível de multa.",
    ],
  },
  {
    titulo: "Cláusula 13: FORO",
    itens: [
      `Elegem as partes o foro da ${FORO}, para controvérsias que possam surgir do presente contrato, podendo o CONTRATADO optar pelo foro do CONTRATANTE.`,
    ],
  },
];

/** Gera o PDF do contrato de venda (CONTRATO DE PRESTAÇÃO DE SERVIÇOS ARTÍSTICOS). */
export function buildContractPdf(data: ContractPdfData): Promise<Buffer> {
  const doc = new PDFDocument({ margin: 48, size: "A4" });
  const chunks: Buffer[] = [];
  doc.on("data", (c) => chunks.push(c as Buffer));
  const done = new Promise<Buffer>((resolve, reject) => {
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);
  });

  const left = doc.page.margins.left;
  const right = doc.page.width - doc.page.margins.right;
  const contentWidth = right - left;

  const red = "#c0392b";

  function bandTitle(title: string) {
    doc.moveDown(0.6);
    const y = doc.y;
    doc.rect(left, y, contentWidth, 18).fill(red);
    doc.fillColor("#fff").font("Helvetica-Bold").fontSize(10).text(title, left + 6, y + 4, { width: contentWidth - 12 });
    doc.fillColor("#000");
    doc.y = y + 20;
    doc.x = left;
  }

  function row(label: string, value: string | null | undefined) {
    const labelW = 160;
    const y0 = doc.y;
    doc.font("Helvetica-Bold").fontSize(9).fillColor("#000").text(label, left, y0, { width: labelW });
    doc.font("Helvetica").fontSize(9).fillColor("#111").text(
      value && String(value).trim() ? String(value) : "—",
      left + labelW,
      y0,
      { width: contentWidth - labelW },
    );
    doc.x = left;
    doc.y = Math.max(y0 + 14, doc.y + 2);
  }

  // ── Cabeçalho ────────────────────────────────────────────────────────────
  doc.font("Helvetica-Bold").fontSize(20).fillColor(red).text("CASE", { align: "center", continued: true });
  doc.fillColor("#000").text(" SHOWS", { align: "center" });
  doc.moveDown(0.3);
  doc.font("Helvetica-Bold").fontSize(12).fillColor("#000").text("CONTRATO DE PRESTAÇÃO DE SERVIÇOS ARTÍSTICOS", { align: "center" });
  doc.font("Helvetica").fontSize(8).fillColor("#666").text(`Contrato nº ${data.contractNumber}`, { align: "center" });

  // ── CONTRATADO (fixo) ──────────────────────────────────────────────────
  bandTitle("CONTRATADO");
  row("RAZÃO SOCIAL", CONTRATADO.razao);
  row("CNPJ", CONTRATADO.cnpj);
  row("ENDEREÇO", CONTRATADO.endereco);
  row("CIDADE/ESTADO", CONTRATADO.cidade);
  row("CEP", CONTRATADO.cep);

  // ── CONTRATANTE (cliente) ──────────────────────────────────────────────
  bandTitle("CONTRATANTE");
  row("FUNDO", data.cliente.fundo);
  row("CNPJ", data.cliente.cnpj);
  row("RESP. LEGAL", data.cliente.respLegal);
  row("CPF", data.cliente.cpfResp);
  row("ENDEREÇO", data.cliente.endereco);
  row("CIDADE/ESTADO", data.cliente.cidadeEstado);
  row("CEP", data.cliente.cep);

  doc.moveDown(0.6);
  doc.font("Helvetica").fontSize(9).fillColor("#111").text(
    "Pelo presente instrumento particular, as partes mencionadas e qualificadas acima têm entre si " +
      "justo e contratado o presente CONTRATO DE PRESTAÇÃO DE SERVIÇOS ARTÍSTICOS, obedecidas as " +
      "seguintes cláusulas e condições que reciprocamente estipulam e aceitam.",
    left,
    doc.y,
    { width: contentWidth, align: "justify" },
  );

  // ── I - OBJETO ─────────────────────────────────────────────────────────
  bandTitle("I - OBJETO");
  row("ARTISTA", data.objeto.artista);
  row("DATA DO EVENTO", fmtDate(data.objeto.dataEvento));
  row("HORÁRIO APRESENTAÇÃO", data.objeto.horario);
  row("PASSAGEM DE SOM", data.objeto.passagemSom);
  row("DURAÇÃO", data.objeto.duracao);
  row("LOCAL", data.objeto.local);
  row("ENDEREÇO", data.objeto.endereco);
  row("CIDADE/ESTADO", data.objeto.cidadeEstado);
  row("CEP", data.objeto.cep);
  row("ESPECIFICAÇÕES", data.objeto.especificacoes);

  // ── II - VALOR E CONDIÇÕES DE PAGAMENTO ────────────────────────────────
  bandTitle("II - VALOR E CONDIÇÕES DE PAGAMENTO");
  row("Atração", fmtBRL.format(data.valores.atracao));
  if (data.valores.rider > 0) row("Rider", fmtBRL.format(data.valores.rider));
  if (data.valores.camarim > 0) row("Camarim", fmtBRL.format(data.valores.camarim));
  if (data.valores.extras > 0) row("Extras", fmtBRL.format(data.valores.extras));
  row("VALOR TOTAL", fmtBRL.format(data.valores.total));
  doc.moveDown(0.3);
  doc.font("Helvetica-Bold").fontSize(9).fillColor("#000").text("Parcelas:", left, doc.y);
  doc.x = left;
  data.parcelas.forEach((p, i) => {
    row(`  Parcela ${i + 1} — ${fmtDate(p.vencimento)}`, fmtBRL.format(p.valor));
  });

  // ── Dados bancários (recebimento) ──────────────────────────────────────
  bandTitle("DADOS BANCÁRIOS");
  row("Favorecido", DADOS_BANCARIOS.favorecido);
  row("Banco", DADOS_BANCARIOS.banco);
  row("Agência", DADOS_BANCARIOS.agencia);
  row("Conta corrente", DADOS_BANCARIOS.conta);
  row("CNPJ", DADOS_BANCARIOS.cnpj);
  row("PIX", DADOS_BANCARIOS.pix);

  // ── Cláusulas ──────────────────────────────────────────────────────────
  bandTitle("CLÁUSULAS");
  for (const c of CLAUSULAS) {
    if (doc.y > doc.page.height - 120) doc.addPage();
    doc.moveDown(0.4);
    doc.font("Helvetica-Bold").fontSize(9).fillColor("#000").text(c.titulo, left, doc.y, { width: contentWidth });
    doc.moveDown(0.15);
    for (const item of c.itens) {
      doc.font("Helvetica").fontSize(8.5).fillColor("#222").text(item, left, doc.y, { width: contentWidth, align: "justify" });
      doc.moveDown(0.15);
    }
  }

  // ── Fechamento + assinaturas ───────────────────────────────────────────
  if (doc.y > doc.page.height - 160) doc.addPage();
  doc.moveDown(0.6);
  doc.font("Helvetica").fontSize(8.5).fillColor("#222").text(
    "E por estarem assim justos e contratados, assinam o presente em duas vias de igual forma e teor, " +
      "na presença de duas testemunhas, para que possa produzir todos os seus efeitos de direito.",
    left,
    doc.y,
    { width: contentWidth, align: "justify" },
  );

  doc.moveDown(3);
  const y = doc.y;
  const colW = (contentWidth - 40) / 2;
  doc.moveTo(left, y).lineTo(left + colW, y).strokeColor("#000").lineWidth(0.7).stroke();
  doc.moveTo(left + colW + 40, y).lineTo(right, y).stroke();
  doc.font("Helvetica").fontSize(8).fillColor("#000");
  doc.text("CONTRATADO — CS Agência de Shows", left, y + 4, { width: colW, align: "center" });
  doc.text(`CONTRATANTE — ${data.cliente.fundo}`, left + colW + 40, y + 4, { width: colW, align: "center" });

  doc.end();
  return done;
}
