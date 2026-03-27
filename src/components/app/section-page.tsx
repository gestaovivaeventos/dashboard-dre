import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

interface SectionPageProps {
  title: string;
  description: string;
}

export function SectionPage({ title, description }: SectionPageProps) {
  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-2xl font-semibold">{title}</h2>
        <p className="text-sm text-muted-foreground">{description}</p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>{title}</CardTitle>
          <CardDescription>Area em construcao.</CardDescription>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">
            Estrutura inicial criada com App Router, layout protegido e autenticação Supabase.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
