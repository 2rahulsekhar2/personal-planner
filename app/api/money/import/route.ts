import { NextResponse } from "next/server";
import { supabaseServer } from "@/lib/supabase/server";
import { sheetToMoney } from "@/lib/money-sheet";
import { readXlsx } from "@/lib/money-xlsx";
import type { Bank } from "@/lib/money";

const MAX_BYTES = 4 * 1024 * 1024;

// Replaces the person's Money data with an Excel budget sheet. The database saves what was there as a backup
// first, in the same transaction, so a bad import can be undone from Setup.
export async function POST(request: Request) {
  const supabase = await supabaseServer();
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  const form = await request.formData().catch(() => null);
  const file = form?.get("file");
  if (!(file instanceof File) || !file.size) return NextResponse.json({ error: "Choose an Excel file to import." }, { status: 400 });
  if (file.size > MAX_BYTES) return NextResponse.json({ error: "That file is too large. The limit is 4 MB." }, { status: 400 });
  // The person's own current month decides where history ends and the plan begins.
  const month = String(form?.get("month") ?? "");
  const nowYm = /^\d{4}-(0[1-9]|1[0-2])$/.test(month) ? month : new Date().toISOString().slice(0, 7);

  // Private banks only: a circle's bank of the same name must not lend its balance. Without 0017 every bank is private.
  let banks = await supabase.from("money_banks").select("id, name, balance, balance_at, archived_at").is("circle_id", null);
  if (banks.error) banks = await supabase.from("money_banks").select("id, name, balance, balance_at, archived_at");
  if (banks.error) return NextResponse.json({ error: banks.error.message }, { status: 500 });
  let parsed: ReturnType<typeof sheetToMoney>;
  try {
    const sheet = await readXlsx(await file.arrayBuffer());
    parsed = sheetToMoney(sheet.rows, sheet.notes, nowYm, banks.data as Bank[]);
  } catch (e) {
    const known = e instanceof Error && /budget sheet|no sheets/.test(e.message);
    return NextResponse.json({ error: known ? (e as Error).message : "That file could not be read. Save it as an Excel workbook (.xlsx) and try again." }, { status: 400 });
  }
  if (!parsed.data.money_items.length) return NextResponse.json({ error: "No income or expense rows with monthly figures were found in that file." }, { status: 400 });

  const { error } = await supabase.rpc("money_replace", { p: parsed.data, p_label: `Before importing ${file.name}`.slice(0, 200) });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true, items: parsed.data.money_items.length, skipped: parsed.skipped });
}
