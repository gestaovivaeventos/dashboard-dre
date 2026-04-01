import { NextResponse } from "next/server";
import { getCurrentSessionContext } from "@/lib/auth/session";

interface CreateContactBody {
  company_id: string;
  name: string;
  email: string;
  role_label?: string | null;
}

export async function GET(request: Request) {
  const { supabase, user, profile } = await getCurrentSessionContext();
  if (!user || !profile) {
    return NextResponse.json({ error: "Nao autenticado." }, { status: 401 });
  }
  if (profile.role !== "admin") {
    return NextResponse.json({ error: "Acesso restrito." }, { status: 403 });
  }

  const { searchParams } = new URL(request.url);
  const companyId = searchParams.get("companyId");

  let query = supabase
    .from("company_contacts")
    .select("*")
    .eq("active", true)
    .order("name", { ascending: true });

  if (companyId) {
    query = query.eq("company_id", companyId);
  }

  const { data, error } = await query;

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 400 });
  }

  const contacts = (data ?? []).map((item) => ({
    id: item.id as string,
    company_id: item.company_id as string,
    name: item.name as string,
    email: item.email as string,
    role_label: (item.role_label as string | null) ?? null,
    active: Boolean(item.active),
    created_at: item.created_at as string,
  }));

  return NextResponse.json({ contacts });
}

export async function POST(request: Request) {
  const { supabase, user, profile } = await getCurrentSessionContext();
  if (!user || !profile) {
    return NextResponse.json({ error: "Nao autenticado." }, { status: 401 });
  }
  if (profile.role !== "admin") {
    return NextResponse.json({ error: "Acesso restrito." }, { status: 403 });
  }

  const body = (await request.json()) as CreateContactBody;

  const { company_id, name, email, role_label } = body;

  // Validate required fields
  if (!company_id || !name || !email) {
    return NextResponse.json(
      { error: "Campos obrigatorios: company_id, name, email." },
      { status: 400 }
    );
  }

  // Trim and lowercase email
  const normalizedEmail = email.trim().toLowerCase();

  const { data, error } = await supabase
    .from("company_contacts")
    .insert([
      {
        company_id,
        name,
        email: normalizedEmail,
        role_label: role_label ?? null,
        active: true,
      },
    ])
    .select("*");

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 400 });
  }

  const contact = data?.[0];
  if (!contact) {
    return NextResponse.json({ error: "Falha ao criar contato." }, { status: 400 });
  }

  return NextResponse.json(
    {
      contact: {
        id: contact.id as string,
        company_id: contact.company_id as string,
        name: contact.name as string,
        email: contact.email as string,
        role_label: (contact.role_label as string | null) ?? null,
        active: Boolean(contact.active),
        created_at: contact.created_at as string,
      },
    },
    { status: 201 }
  );
}
