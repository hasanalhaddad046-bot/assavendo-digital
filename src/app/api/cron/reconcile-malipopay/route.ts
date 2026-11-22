import { reconcilePendingMalipopayPayments } from "@/lib/malipopay";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret || request.headers.get("authorization") !== "Bearer " + secret) {
    return Response.json({ ok: false }, { status: 401 });
  }

  try {
    const result = await reconcilePendingMalipopayPayments(30);
    return Response.json({ ok: true, ...result });
  } catch (error) {
    console.error("MALIPOPAY reconciliation failed", error);
    return Response.json({ ok: false, error: "Rapprochement MALIPOPAY impossible." }, { status: 502 });
  }
}
