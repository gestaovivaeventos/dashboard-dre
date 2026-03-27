import PDFDocument from "pdfkit";
import { NextResponse } from "next/server";

import { getCurrentSessionContext } from "@/lib/auth/session";

interface PdfRow {
  code: string;
  name: string;
  level: number;
  valuesByBucket: Record<string, number>;
  accumulatedValue: number;
  variationPercentage: number;
}

function formatCurrency(value: number) {
  return new Intl.NumberFormat("pt-BR", {
    style: "currency",
    currency: "BRL",
  }).format(value);
}

function formatPercent(value: number) {
  return `${value.toFixed(1)}%`;
}

export async function POST(request: Request) {
  const { user } = await getCurrentSessionContext();
  if (!user) {
    return NextResponse.json({ error: "Nao autenticado." }, { status: 401 });
  }

  const body = (await request.json()) as {
    title?: string;
    periodLabel?: string;
    unitsLabel?: string;
    buckets?: Array<{ key: string; label: string }>;
    rows?: PdfRow[];
  };
  const buckets = body.buckets ?? [];
  const rows = body.rows ?? [];

  const doc = new PDFDocument({ margin: 36, size: "A4", layout: "landscape" });
  const chunks: Buffer[] = [];
  doc.on("data", (chunk) => chunks.push(chunk as Buffer));

  doc.fontSize(16).text("Controll Hub", { continued: false });
  doc.moveDown(0.2);
  doc.fontSize(11).text(body.title ?? "DRE Gerencial");
  doc.fontSize(9).fillColor("#555").text(`Periodo: ${body.periodLabel ?? "-"}`);
  doc.fontSize(9).fillColor("#555").text(`Unidade: ${body.unitsLabel ?? "-"}`);
  doc.moveDown(0.8);

  const startX = doc.x;
  let y = doc.y;
  const accountWidth = 280;
  const colWidth = Math.max(90, Math.floor((770 - accountWidth) / (buckets.length + 2)));

  doc.fillColor("#000").fontSize(8).font("Helvetica-Bold");
  doc.text("Conta", startX, y, { width: accountWidth });
  buckets.forEach((bucket, index) => {
    doc.text(bucket.label, startX + accountWidth + index * colWidth, y, {
      width: colWidth,
      align: "right",
    });
  });
  doc.text("Acumulado", startX + accountWidth + buckets.length * colWidth, y, {
    width: colWidth,
    align: "right",
  });
  doc.text("Var %", startX + accountWidth + (buckets.length + 1) * colWidth, y, {
    width: colWidth,
    align: "right",
  });
  y += 18;

  doc.font("Helvetica").fontSize(8);
  rows.forEach((row) => {
    if (y > 540) {
      doc.addPage({ size: "A4", layout: "landscape", margin: 36 });
      y = 40;
    }

    const indent = (row.level - 1) * 8;
    doc.fillColor("#111").text(row.name, startX + indent, y, {
      width: accountWidth - indent,
    });
    buckets.forEach((bucket, index) => {
      doc.text(
        formatCurrency(Number(row.valuesByBucket[bucket.key] ?? 0)),
        startX + accountWidth + index * colWidth,
        y,
        {
          width: colWidth,
          align: "right",
        },
      );
    });
    doc.text(
      formatCurrency(Number(row.accumulatedValue ?? 0)),
      startX + accountWidth + buckets.length * colWidth,
      y,
      {
        width: colWidth,
        align: "right",
      },
    );
    doc.text(
      formatPercent(Number(row.variationPercentage ?? 0)),
      startX + accountWidth + (buckets.length + 1) * colWidth,
      y,
      {
        width: colWidth,
        align: "right",
      },
    );

    y += 14;
  });

  doc.end();
  await new Promise<void>((resolve) => {
    doc.on("end", () => resolve());
  });
  const pdf = Buffer.concat(chunks);

  return new NextResponse(pdf, {
    status: 200,
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": 'attachment; filename="DRE_Hero.pdf"',
    },
  });
}
