"use client";

interface ReportPreviewProps {
  html: string;
}

export function ReportPreview({ html }: ReportPreviewProps) {
  return (
    <iframe
      srcDoc={html}
      sandbox="allow-same-origin"
      className="w-full rounded border bg-background"
      style={{ height: 600 }}
      title="Previa do relatorio"
    />
  );
}
