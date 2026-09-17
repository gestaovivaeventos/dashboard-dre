"use client";

// E-mail que recebe o extrato mensal do credor. Um endereço; vazio = não recebe.

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Loader2, Mail } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/components/ui/toaster";
import { updateCreditorEmail } from "@/lib/vb/actions/creditors";

export function VbCreditorEmailDialog({ creditorId, email }: { creditorId: string; email: string | null }) {
  const router = useRouter();
  const { showToast } = useToast();
  const [open, setOpen] = useState(false);
  const [value, setValue] = useState(email ?? "");
  const [saving, startSaving] = useTransition();

  function save(e: React.FormEvent) {
    e.preventDefault();
    startSaving(async () => {
      const result = await updateCreditorEmail(creditorId, value);
      if ("error" in result) {
        showToast({ title: "Não salvo", description: result.error, variant: "destructive" });
        return;
      }
      showToast({ title: result.email ? `Extrato mensal vai para ${result.email}` : "Credor sem e-mail: não recebe o extrato", variant: "success" });
      setOpen(false);
      router.refresh();
    });
  }

  return (
    <>
      <Button type="button" variant="outline" onClick={() => { setValue(email ?? ""); setOpen(true); }}>
        <Mail className="mr-2 h-4 w-4" />
        {email ? email : "Definir e-mail"}
      </Button>
      <Dialog open={open} onOpenChange={(v) => !saving && setOpen(v)}>
        <DialogContent className="sm:max-w-md">
          <form onSubmit={save}>
            <DialogHeader>
              <DialogTitle>E-mail do credor</DialogTitle>
              <DialogDescription>
                Recebe o extrato mensal. Deixe em branco para o credor não receber.
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-1.5 py-4">
              <Label htmlFor="vb-creditor-email">E-mail</Label>
              <Input
                id="vb-creditor-email"
                type="email"
                autoComplete="off"
                placeholder="nome@exemplo.com"
                value={value}
                onChange={(e) => setValue(e.target.value)}
              />
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setOpen(false)} disabled={saving}>
                Cancelar
              </Button>
              <Button type="submit" disabled={saving}>
                {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                Salvar
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
}
