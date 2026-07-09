/* eslint-disable jsx-a11y/alt-text -- <Image> aqui é do @react-pdf (PDF), não <img> HTML. */
import React from "react";
import {
  Document,
  Page,
  View,
  Text,
  Image,
  StyleSheet,
  Font,
} from "@react-pdf/renderer";

import {
  Archivo_400,
  Archivo_500,
  Archivo_600,
  Archivo_700,
  Archivo_800,
  SourceSerif_400,
  SourceSerif_600,
  SourceSerif_700,
  CASE_LOGO_PNG,
} from "@/lib/case/assets/embedded";
import { CONTRATADO, DADOS_BANCARIOS, CIDADE_ASSINATURA } from "@/lib/case/contract-config";
import { CLAUSULAS, CLAUSULA_FECHAMENTO } from "@/lib/case/contract-clauses";
import {
  fmtBRL,
  fmtCEP,
  fmtCNPJ,
  fmtCPF,
  fmtDate,
  fmtDateLong,
  fmtDoc,
  fmtNumber,
} from "@/lib/case/format";

Font.register({
  family: "Archivo",
  fonts: [
    { src: Archivo_400, fontWeight: 400 },
    { src: Archivo_500, fontWeight: 500 },
    { src: Archivo_600, fontWeight: 600 },
    { src: Archivo_700, fontWeight: 700 },
    { src: Archivo_800, fontWeight: 800 },
  ],
});
Font.register({
  family: "SourceSerif",
  fonts: [
    { src: SourceSerif_400, fontWeight: 400 },
    { src: SourceSerif_600, fontWeight: 600 },
    { src: SourceSerif_700, fontWeight: 700 },
  ],
});
// Sem hifenização automática (evita quebras estranhas no texto justificado).
Font.registerHyphenationCallback((w) => [w]);

// ── Paleta de marca ────────────────────────────────────────────────────────
const PINK = "#E80B4E";
const DARK = "#17181D";
const TEXT = "#22242A";
const BODY = "#33353D";
const SERIF_TEXT = "#2B2D33";
const LABEL = "#8A8A93";
const LINE = "#EDEDF1";
const BG = "#FAFAFB";
const CHIP_BG = "#FCE4EC";
const CHIP_BORDER = "#F5BFD2";
const CHK_BORDER = "#C3243E";

export interface ContractPdfData {
  contractNumber: number | string;
  cliente: {
    fundo: string;
    cnpj: string | null;
    respLegal: string | null;
    cpfResp: string | null;
    endereco: string | null;
    cidadeEstado: string | null;
    cep: string | null;
  };
  objeto: {
    artista: string;
    dataEvento: string | null;
    horario: string | null;
    passagemSom: string | null;
    local: string | null;
    endereco: string | null;
    cidadeEstado: string | null;
    cep: string | null;
  };
  especificacoes: {
    areaInterna: boolean;
    areaExterna: boolean;
    palco: boolean;
    trio: boolean;
  };
  extras: {
    transporteCidade: boolean;
    transladoLocal: boolean;
    diariaAlimentacao: boolean;
    hospedagem: boolean;
    outros: string | null;
  };
  rider: {
    tecnico: boolean;
    camarim: boolean;
    preProducao: boolean;
  };
  tipoEvento: "aberto" | "fechado" | null;
  valorTotal: number;
  parcelas: Array<{ vencimento: string; valor: number }>;
  cortesias: string | null;
  dataAssinatura: string | null;
  testemunha1: { nome: string | null; cpf: string | null };
  testemunha2: { nome: string | null; cpf: string | null };
}

const s = StyleSheet.create({
  page: {
    paddingTop: 46,
    paddingBottom: 40,
    paddingHorizontal: 50,
    fontFamily: "Archivo",
    color: TEXT,
  },
  // Header/footer fixos por página
  runHeader: {
    position: "absolute",
    top: 18,
    left: 50,
    right: 50,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingBottom: 4,
    borderBottomWidth: 2,
    borderBottomColor: PINK,
  },
  runHeaderLabel: {
    fontSize: 6.5,
    fontWeight: 600,
    color: LABEL,
    letterSpacing: 1.2,
    textTransform: "uppercase",
  },
  runFooter: {
    position: "absolute",
    bottom: 16,
    left: 50,
    right: 50,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingTop: 4,
    borderTopWidth: 1,
    borderTopColor: "#E7E7EC",
  },
  runFooterText: {
    fontSize: 6.5,
    color: LABEL,
    letterSpacing: 0.3,
    textTransform: "uppercase",
  },
  // Hero
  heroRow: { flexDirection: "row", alignItems: "center", marginBottom: 6 },
  heroLine: { flex: 1, height: 2, backgroundColor: CHIP_BORDER, marginLeft: 12 },
  h1: {
    fontFamily: "Archivo",
    fontWeight: 800,
    fontSize: 17,
    color: DARK,
    textTransform: "uppercase",
    marginBottom: 3,
    lineHeight: 1.15,
  },
  subtitle: { fontSize: 8, color: LABEL, marginBottom: 16, letterSpacing: 0.3 },
  // Faixas de parte
  bandRow: { flexDirection: "row", alignItems: "center", gap: 8, marginBottom: 8 },
  bandTag: {
    color: "#fff",
    fontWeight: 700,
    fontSize: 8,
    letterSpacing: 1,
    paddingVertical: 3,
    paddingHorizontal: 9,
    borderRadius: 3,
  },
  bandLine: { flex: 1, height: 1, backgroundColor: LINE },
  // Grid label/valor
  table: {
    borderWidth: 1,
    borderColor: LINE,
    borderRadius: 6,
    marginBottom: 16,
    overflow: "hidden",
  },
  trow: { flexDirection: "row", borderBottomWidth: 1, borderBottomColor: LINE },
  trowLast: { flexDirection: "row" },
  tlabel: {
    width: 130,
    backgroundColor: BG,
    color: LABEL,
    fontWeight: 600,
    fontSize: 7.5,
    letterSpacing: 0.5,
    paddingVertical: 6,
    paddingHorizontal: 9,
  },
  tvalCell: { flex: 1, paddingVertical: 6, paddingHorizontal: 9, justifyContent: "center" },
  tvalPlain: { fontSize: 9, color: TEXT },
  // chip cs-field
  chip: {
    alignSelf: "flex-start",
    backgroundColor: CHIP_BG,
    borderWidth: 1,
    borderColor: CHIP_BORDER,
    borderRadius: 3,
    paddingHorizontal: 4,
    paddingVertical: 1,
  },
  chipText: { fontFamily: "Archivo", fontWeight: 600, fontSize: 8.5, color: PINK },
  // Parágrafo de abertura
  intro: {
    fontFamily: "SourceSerif",
    fontSize: 9.5,
    color: BODY,
    lineHeight: 1.55,
    marginBottom: 18,
    textAlign: "justify",
  },
  // Títulos de seção I/II
  sectionTitle: {
    marginBottom: 9,
    paddingBottom: 4,
    borderBottomWidth: 2,
    borderBottomColor: DARK,
  },
  sectionTitleText: { fontFamily: "Archivo", fontWeight: 800, fontSize: 11, color: DARK, letterSpacing: 0.4 },
  fieldLabelSm: { fontSize: 8, fontWeight: 600, color: LABEL, letterSpacing: 0.5, marginBottom: 6 },
  // Checkboxes
  chkRow: { flexDirection: "row", alignItems: "center", gap: 6, marginRight: 16 },
  chkBox: {
    width: 10,
    height: 10,
    borderWidth: 1.2,
    borderColor: CHK_BORDER,
    borderRadius: 2,
    alignItems: "center",
    justifyContent: "center",
  },
  chkBoxOn: { backgroundColor: PINK, borderColor: PINK },
  chkMark: { fontSize: 7, fontWeight: 700, color: "#fff", lineHeight: 1 },
  chkLabel: { fontFamily: "Archivo", fontWeight: 500, fontSize: 8.5, color: BODY, letterSpacing: 0.2 },
  // Cards
  cardsRow: { flexDirection: "row", gap: 12, marginBottom: 14 },
  card: { flex: 1, borderWidth: 1, borderColor: LINE, borderRadius: 6, padding: 11 },
  cardBg: { backgroundColor: BG },
  cardTitle: { fontSize: 7.5, fontWeight: 700, letterSpacing: 0.6, color: PINK, marginBottom: 6 },
  bankGrid: { flexDirection: "row", flexWrap: "wrap" },
  bankItem: { flexDirection: "row", width: "100%", marginBottom: 2 },
  bankKey: { width: 62, fontSize: 8.5, color: LABEL },
  bankVal: { flex: 1, fontSize: 8.5, fontWeight: 600, color: BODY },
  extrasCol: { flexDirection: "column", gap: 7 },
  logistica: { fontFamily: "SourceSerif", fontSize: 9, color: BODY, lineHeight: 1.5, marginBottom: 14 },
  // Forma de pagamento
  payLabel: { fontSize: 8, fontWeight: 700, letterSpacing: 0.5, color: DARK, marginBottom: 8 },
  payCards: { flexDirection: "row", gap: 12, marginBottom: 12 },
  payCard: { borderRadius: 6, paddingVertical: 9, paddingHorizontal: 13, minWidth: 110 },
  payCardPink: { backgroundColor: PINK },
  payCardDark: { backgroundColor: DARK },
  payCardCap: { fontSize: 7, letterSpacing: 0.6, color: "#fff", opacity: 0.85 },
  payCardBig: { fontSize: 15, fontWeight: 800, color: "#fff", marginTop: 2 },
  // Tabela de parcelas
  parcTable: {
    borderWidth: 1,
    borderColor: LINE,
    borderRadius: 6,
    marginBottom: 14,
    maxWidth: 320,
    overflow: "hidden",
  },
  parcRow: { flexDirection: "row", borderBottomWidth: 1, borderBottomColor: LINE },
  parcRowLast: { flexDirection: "row" },
  parcHeadCell: {
    flex: 1,
    backgroundColor: BG,
    color: LABEL,
    fontWeight: 600,
    fontSize: 7.5,
    letterSpacing: 0.5,
    paddingVertical: 5,
    paddingHorizontal: 11,
  },
  parcCell: { flex: 1, paddingVertical: 5, paddingHorizontal: 11, flexDirection: "row", alignItems: "center" },
  parcCellText: { fontSize: 9, color: TEXT, marginRight: 4 },
  tipoRow: { flexDirection: "row", alignItems: "center", flexWrap: "wrap", gap: 16, marginBottom: 8 },
  tipoLabel: { fontSize: 8, fontWeight: 700, letterSpacing: 0.4, color: DARK, marginRight: 6 },
  cortesias: { fontFamily: "SourceSerif", fontSize: 9, color: BODY, marginBottom: 20, marginTop: 4 },
  cortesiasLabel: { fontFamily: "Archivo", fontSize: 8, fontWeight: 700, letterSpacing: 0.3, color: DARK },
  // Cláusulas
  clauseTitle: {
    fontFamily: "Archivo",
    fontWeight: 700,
    fontSize: 10.5,
    color: PINK,
    marginTop: 16,
    marginBottom: 6,
  },
  clausePara: {
    fontFamily: "SourceSerif",
    fontSize: 9.5,
    color: SERIF_TEXT,
    lineHeight: 1.5,
    marginBottom: 6,
    textAlign: "justify",
  },
  boldLead: { fontFamily: "SourceSerif", fontWeight: 700 },
  fechamento: {
    fontFamily: "SourceSerif",
    fontSize: 9.5,
    color: SERIF_TEXT,
    lineHeight: 1.5,
    marginTop: 12,
    textAlign: "justify",
  },
  // Assinaturas
  signDate: { fontFamily: "SourceSerif", fontSize: 9.5, color: SERIF_TEXT, marginTop: 18, marginBottom: 22 },
  signGrid: { flexDirection: "row", gap: 30, marginBottom: 26 },
  signCol: { flex: 1, alignItems: "center" },
  signLine: {
    borderTopWidth: 1.5,
    borderTopColor: DARK,
    paddingTop: 6,
    width: "100%",
    alignItems: "center",
  },
  signRole: { fontSize: 8, fontWeight: 700, letterSpacing: 0.6, color: DARK },
  signSub: { fontSize: 7.5, color: LABEL, marginTop: 3, textAlign: "center" },
  witTitle: { fontSize: 8, fontWeight: 700, letterSpacing: 0.5, color: LABEL, marginBottom: 12 },
  witGrid: { flexDirection: "row", gap: 30 },
  witCol: { flex: 1 },
  witLine: { borderTopWidth: 1.5, borderTopColor: "#C9C9D0", paddingTop: 6 },
  witText: { fontSize: 8.5, color: BODY },
  chipInline: { fontFamily: "Archivo", fontWeight: 600, fontSize: 8.5, color: PINK },
});

function Chip({ value }: { value: string | null | undefined }) {
  const v = (value ?? "").trim();
  if (!v) return null;
  return (
    <View style={s.chip}>
      <Text style={s.chipText}>{v}</Text>
    </View>
  );
}

function Checkbox({ label, checked }: { label: string; checked: boolean }) {
  return (
    <View style={s.chkRow}>
      <View style={[s.chkBox, ...(checked ? [s.chkBoxOn] : [])]}>
        {checked ? <Text style={s.chkMark}>X</Text> : null}
      </View>
      <Text style={s.chkLabel}>{label}</Text>
    </View>
  );
}

type Row = { label: string; value: string | null | undefined; plain?: boolean };

function InfoTable({ rows }: { rows: Row[] }) {
  return (
    <View style={s.table}>
      {rows.map((r, i) => (
        <View key={r.label} style={i === rows.length - 1 ? s.trowLast : s.trow}>
          <Text style={s.tlabel}>{r.label}</Text>
          <View style={s.tvalCell}>
            {r.plain ? <Text style={s.tvalPlain}>{r.value ?? ""}</Text> : <Chip value={r.value} />}
          </View>
        </View>
      ))}
    </View>
  );
}

function SectionTitle({ children }: { children: string }) {
  return (
    <View style={s.sectionTitle}>
      <Text style={s.sectionTitleText}>{children}</Text>
    </View>
  );
}

export function ContractDoc({ data }: { data: ContractPdfData }) {
  const numero = String(data.contractNumber);
  return (
    <Document title={`Contrato Case ${numero}`} author={CONTRATADO.razao}>
      <Page size="A4" style={s.page}>
        {/* Header/footer fixos em todas as páginas */}
        <View style={s.runHeader} fixed>
          <Image src={CASE_LOGO_PNG} style={{ height: 11, width: 36 }} />
          <Text style={s.runHeaderLabel}>Contrato de Prestação de Serviços Artísticos</Text>
        </View>
        <View style={s.runFooter} fixed>
          <Text style={s.runFooterText}>{CONTRATADO.razao}</Text>
          <Text style={s.runFooterText}>CNPJ {CONTRATADO.cnpj}</Text>
        </View>

        {/* Hero */}
        <View style={s.heroRow}>
          <Image src={CASE_LOGO_PNG} style={{ height: 26, width: 86 }} />
          <View style={s.heroLine} />
        </View>
        <Text style={s.h1}>Contrato de Prestação de Serviços Artísticos</Text>
        <Text style={s.subtitle}>
          Instrumento particular · Contrato nº {numero}
        </Text>

        {/* CONTRATADO */}
        <View style={s.bandRow}>
          <Text style={[s.bandTag, { backgroundColor: PINK }]}>CONTRATADO</Text>
          <View style={s.bandLine} />
        </View>
        <InfoTable
          rows={[
            { label: "RAZÃO SOCIAL", value: CONTRATADO.razao, plain: true },
            { label: "CNPJ", value: CONTRATADO.cnpj, plain: true },
            { label: "ENDEREÇO", value: CONTRATADO.endereco, plain: true },
            { label: "CIDADE / ESTADO", value: CONTRATADO.cidadeEstado, plain: true },
            { label: "CEP", value: CONTRATADO.cep, plain: true },
          ]}
        />

        {/* CONTRATANTE */}
        <View style={s.bandRow}>
          <Text style={[s.bandTag, { backgroundColor: DARK }]}>CONTRATANTE</Text>
          <View style={s.bandLine} />
        </View>
        <InfoTable
          rows={[
            { label: "FUNDO", value: data.cliente.fundo },
            { label: "CNPJ", value: fmtDoc(data.cliente.cnpj) },
            { label: "RESP. LEGAL", value: data.cliente.respLegal },
            { label: "CPF", value: fmtCPF(data.cliente.cpfResp) },
            { label: "ENDEREÇO", value: data.cliente.endereco },
            { label: "CIDADE / ESTADO", value: data.cliente.cidadeEstado },
            { label: "CEP", value: fmtCEP(data.cliente.cep) },
          ]}
        />

        <Text style={s.intro}>
          Pelo presente instrumento particular, as partes mencionadas e qualificadas acima, tem entre
          si justo e contratado o presente CONTRATO DE PRESTAÇÃO DE SERVIÇOS ARTÍSTICOS, obedecidas as
          seguintes cláusulas e condições pactuadas que reciprocamente estipulam e aceitam.
        </Text>

        {/* I · OBJETO */}
        <SectionTitle>I · OBJETO</SectionTitle>
        <InfoTable
          rows={[
            { label: "ARTISTA", value: data.objeto.artista },
            { label: "DATA DO EVENTO", value: fmtDate(data.objeto.dataEvento) },
            { label: "HORÁRIO APRESENTAÇÃO", value: data.objeto.horario },
            { label: "PASSAGEM DE SOM", value: data.objeto.passagemSom },
            { label: "LOCAL", value: data.objeto.local },
            { label: "ENDEREÇO", value: data.objeto.endereco },
            { label: "CIDADE / ESTADO", value: data.objeto.cidadeEstado },
            { label: "CEP", value: fmtCEP(data.objeto.cep) },
          ]}
        />
        <Text style={s.fieldLabelSm}>ESPECIFICAÇÕES</Text>
        <View style={{ flexDirection: "row", flexWrap: "wrap", marginBottom: 20 }}>
          <Checkbox label="ÁREA INTERNA" checked={data.especificacoes.areaInterna} />
          <Checkbox label="ÁREA EXTERNA" checked={data.especificacoes.areaExterna} />
          <Checkbox label="PALCO" checked={data.especificacoes.palco} />
          <Checkbox label="TRIO" checked={data.especificacoes.trio} />
        </View>

        {/* II · PREÇO */}
        <SectionTitle>II · PREÇO</SectionTitle>
        <View style={s.cardsRow}>
          <View style={[s.card, s.cardBg]}>
            <Text style={s.cardTitle}>DADOS BANCÁRIOS</Text>
            <View style={s.bankGrid}>
              {[
                ["Favorecido", DADOS_BANCARIOS.favorecido],
                ["Banco", DADOS_BANCARIOS.banco],
                ["Agência", DADOS_BANCARIOS.agencia],
                ["Conta", DADOS_BANCARIOS.conta],
                ["CNPJ", DADOS_BANCARIOS.cnpj],
                ["PIX", DADOS_BANCARIOS.pix],
              ].map(([k, v]) => (
                <View key={k} style={s.bankItem}>
                  <Text style={s.bankKey}>{k}</Text>
                  <Text style={s.bankVal}>{v}</Text>
                </View>
              ))}
            </View>
          </View>
          <View style={s.card}>
            <Text style={s.cardTitle}>EXTRAS INCLUSOS</Text>
            <Text style={{ fontSize: 7, color: LABEL, marginBottom: 8, lineHeight: 1.4 }}>
              Se marcado, considere como custo da CONTRATADA
            </Text>
            <View style={s.extrasCol}>
              <Checkbox label="TRANSPORTE ATÉ A CIDADE" checked={data.extras.transporteCidade} />
              <Checkbox label="TRANSLADO LOCAL" checked={data.extras.transladoLocal} />
              <Checkbox label="DIÁRIA DE ALIMENTAÇÃO" checked={data.extras.diariaAlimentacao} />
              <Checkbox label="HOSPEDAGEM" checked={data.extras.hospedagem} />
              {(data.extras.outros ?? "").trim() !== "" && (
                <Checkbox label={data.extras.outros!.trim().toUpperCase()} checked />
              )}
            </View>
          </View>
        </View>

        <View style={{ borderWidth: 1, borderColor: LINE, borderRadius: 6, padding: 11, marginBottom: 14 }}>
          <Text style={s.cardTitle}>RIDER E AFINS</Text>
          <Text style={{ fontSize: 7, color: LABEL, marginBottom: 8, lineHeight: 1.4 }}>
            Se marcado, considere como custo da CONTRATADA
          </Text>
          <View style={s.extrasCol}>
            <Checkbox label="RIDER TÉCNICO" checked={data.rider.tecnico} />
            <Checkbox label="RIDER DE CAMARIM" checked={data.rider.camarim} />
            <Checkbox label="PRÉ-PRODUÇÃO, PRODUÇÃO DE PALCO E PRODUÇÃO DE CAMARINS" checked={data.rider.preProducao} />
          </View>
        </View>

        <Text style={s.payLabel}>FORMA DE PAGAMENTO</Text>
        <View style={s.payCards}>
          <View style={[s.payCard, s.payCardPink]}>
            <Text style={s.payCardCap}>PARCELAS</Text>
            <Text style={s.payCardBig}>{data.parcelas.length || ""}</Text>
          </View>
          <View style={[s.payCard, s.payCardDark]}>
            <Text style={s.payCardCap}>VALOR TOTAL</Text>
            <Text style={s.payCardBig}>{fmtBRL(data.valorTotal)}</Text>
          </View>
        </View>

        {data.parcelas.length > 0 ? (
          <View style={s.parcTable}>
            <View style={s.parcRow}>
              <Text style={s.parcHeadCell}>VENCIMENTO</Text>
              <Text style={s.parcHeadCell}>VALOR</Text>
            </View>
            {data.parcelas.map((p, i) => (
              <View key={i} style={i === data.parcelas.length - 1 ? s.parcRowLast : s.parcRow}>
                <View style={s.parcCell}>
                  <Chip value={fmtDate(p.vencimento)} />
                </View>
                <View style={s.parcCell}>
                  <Text style={s.parcCellText}>R$</Text>
                  <Chip value={fmtNumber(p.valor)} />
                </View>
              </View>
            ))}
          </View>
        ) : null}

        <View style={s.tipoRow}>
          <Text style={s.tipoLabel}>TIPO DE EVENTO</Text>
          <Checkbox label="EVENTO ABERTO" checked={data.tipoEvento === "aberto"} />
          <Checkbox label="EVENTO FECHADO" checked={data.tipoEvento === "fechado"} />
        </View>
        <Text style={s.cortesias}>
          <Text style={s.cortesiasLabel}>CORTESIAS: </Text>
          <Text style={s.chipInline}>{(data.cortesias ?? "").trim()}</Text>
        </Text>

        {/* CLÁUSULAS */}
        {CLAUSULAS.map((c) => (
          <View key={c.titulo} wrap>
            <Text style={s.clauseTitle} minPresenceAhead={40}>
              {c.titulo}
            </Text>
            {c.paras.map((p, i) => (
              <Text key={i} style={s.clausePara}>
                {p.b ? <Text style={s.boldLead}>{p.b} </Text> : null}
                {p.t}
              </Text>
            ))}
          </View>
        ))}
        <Text style={s.fechamento}>{CLAUSULA_FECHAMENTO}</Text>

        {/* ASSINATURAS */}
        <Text style={s.signDate}>
          {CIDADE_ASSINATURA}, <Text style={s.chipInline}>{fmtDateLong(data.dataAssinatura)}</Text>.
        </Text>
        <View style={s.signGrid} wrap={false}>
          <View style={s.signCol}>
            <View style={s.signLine}>
              <Text style={s.signRole}>CONTRATADO</Text>
            </View>
            <Text style={s.signSub}>{CONTRATADO.razao}</Text>
          </View>
          <View style={s.signCol}>
            <View style={s.signLine}>
              <Text style={s.signRole}>CONTRATANTE</Text>
            </View>
            <Text style={s.signSub}>{data.cliente.fundo}</Text>
          </View>
        </View>

        <Text style={s.witTitle}>TESTEMUNHAS</Text>
        <View style={s.witGrid} wrap={false}>
          {[data.testemunha1, data.testemunha2].map((w, i) => (
            <View key={i} style={s.witCol}>
              <View style={s.witLine}>
                <Text style={s.witText}>
                  Nome: <Text style={s.chipInline}>{(w.nome ?? "").trim()}</Text>
                </Text>
              </View>
              <Text style={[s.witText, { marginTop: 8 }]}>
                CPF: <Text style={s.chipInline}>{fmtCPF(w.cpf)}</Text>
              </Text>
            </View>
          ))}
        </View>
      </Page>
    </Document>
  );
}

// Reexport para consumidores (mantém o CNPJ/CPF formatados acessíveis se precisar).
export { fmtCNPJ };
