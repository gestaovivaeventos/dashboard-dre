"use client";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

interface SegmentPlaceholderProps {
  segmentName: string;
}

export function SegmentPlaceholder({ segmentName }: SegmentPlaceholderProps) {
  return (
    <div className="flex items-center justify-center py-20">
      <Card className="w-full max-w-lg text-center">
        <CardHeader>
          <CardTitle>{segmentName}</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-muted-foreground">
            Este segmento ainda esta em desenvolvimento.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
