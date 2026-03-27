"use client";

import { useRouter } from "next/navigation";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { createClient } from "@/lib/supabase/client";

export default function PendentePage() {
  const router = useRouter();

  const handleLogout = async () => {
    const supabase = createClient();
    await supabase.auth.signOut();
    router.replace("/login");
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-50 px-4">
      <Card className="w-full max-w-md text-center">
        <CardHeader>
          <CardTitle>Cadastro pendente</CardTitle>
          <CardDescription>
            Sua conta foi criada e esta aguardando aprovacao de um administrador.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="text-sm text-muted-foreground">
            Voce recebera acesso assim que um administrador aprovar seu cadastro.
          </p>
          <Button variant="outline" onClick={() => void handleLogout()}>
            Sair
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
