import { refreshFx } from "@/lib/fx";

export const runtime = "nodejs";

export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret || req.headers.get("authorization") !== `Bearer ${secret}`) {
    return Response.json({ ok: false }, { status: 401 });
  }
  const ok = await refreshFx();
  return Response.json({ ok }, { status: ok ? 200 : 502 });
}
