import { NextResponse } from "next/server";
import { supabaseServer } from "@/lib/supabase/server";
import { moneyToSheet, type MoneyData } from "@/lib/money-sheet";
import { writeXlsx } from "@/lib/money-xlsx";

// The person's budget as an Excel file, in the layout the import reads.
export async function GET(request: Request) {
  const supabase = await supabaseServer();
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  const month = new URL(request.url).searchParams.get("month") ?? "";
  const nowYm = /^\d{4}-(0[1-9]|1[0-2])$/.test(month) ? month : new Date().toISOString().slice(0, 7);

  const { data, error } = await supabase.rpc("money_snapshot");
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return new Response(await writeXlsx(moneyToSheet(data as MoneyData, nowYm)), {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="budget-${nowYm}.xlsx"`,
      "Cache-Control": "no-store",
    },
  });
}
