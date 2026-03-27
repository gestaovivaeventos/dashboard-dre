"use client";

import { useRouter } from "next/navigation";

import { LogoFull } from "@/components/app/logo";
import { Button } from "@/components/ui/button";
import { createClient } from "@/lib/supabase/client";

export default function PendentePage() {
  const router = useRouter();

  const handleLogout = async () => {
    const supabase = createClient();
    await supabase.auth.signOut();
    router.replace("/login");
  };

  return (
    <div className="flex min-h-screen flex-col items-center justify-center px-6">
      <div className="w-full max-w-md space-y-8 text-center">
        <LogoFull className="justify-center" />

        <div className="space-y-3">
          <h1 className="text-2xl font-bold tracking-tight">Cadastro pendente</h1>
          <p className="text-muted-foreground">
            Sua conta foi criada e esta aguardando aprovacao de um administrador.
            Voce recebera acesso assim que seu cadastro for aprovado.
          </p>
        </div>

        <Button variant="outline" onClick={() => void handleLogout()} className="h-11">
          Sair
        </Button>
      </div>
    </div>
  );
}
