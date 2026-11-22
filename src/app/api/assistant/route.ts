import { supabasePublic } from "@/lib/supabase";
import { chat } from "@/lib/ai-gateway";
import { rateLimit, clientIp } from "@/lib/ratelimit";

export const runtime = "nodejs";

// Assistant client : répond avec le catalogue publié uniquement. Jamais de prix inventé.
export async function POST(req: Request) {
  try {
    if (!(await rateLimit(`ai:${clientIp(req)}`, 15, 10 * 60_000))) {
      return Response.json({ error: "Trop de questions." }, { status: 429 });
    }
  } catch {
    return Response.json({ error: "Le service est temporairement indisponible. Réessayez plus tard." }, { status: 503 });
  }
  const b = (await req.json().catch(() => null)) as { question?: string } | null;
  const q = (b?.question ?? "").trim().slice(0, 500);
  if (!q) return Response.json({ error: "Question vide." }, { status: 400 });

  const term = q.replace(/[%_,()]/g, " ").split(/\s+/).filter((w) => w.length > 2).slice(0, 4);
  let hits: { slug: string; name: string; price_usd_minor: number; description: string }[] = [];
  try {
    const sb = supabasePublic();
    const filter = term.length ? term.map((t) => `name.ilike.%${t}%`).join(",") : "name.ilike.%";
    const { data } = await sb.from("products").select("slug,name,price_usd_minor,description").or(filter).limit(5);
    hits = (data ?? []) as typeof hits;
  } catch { /* catalogue indisponible */ }

  const catalogue = hits
    .map((h) => `- ${h.name} (${(h.price_usd_minor / 100).toFixed(2)} USD) /produits/${h.slug} : ${String(h.description).slice(0, 160)}`)
    .join("\n");
  if (hits.length === 0) {
    return Response.json({
      answer: "Je ne trouve actuellement aucun produit publié correspondant dans le catalogue Assavendo. Je préfère ne pas inventer de référence ni de prix. Contactez notre assistance pour une recherche manuelle.",
      products: [],
      fallback: true,
    });
  }

  const r = await chat("quick_reply", [
    {
      role: "system",
      content:
        "Tu es l'assistant de la boutique Assavendo Digital. Réponds en français, brièvement. Utilise UNIQUEMENT le catalogue fourni ; " +
        "n'invente jamais de prix, délai, stock ni promesse de livraison. Si tu ne sais pas, oriente vers le support. " +
        "Ne demande jamais de données de paiement.\nCatalogue pertinent :\n" + (catalogue || "(aucun produit trouvé)"),
    },
    { role: "user", content: q },
  ]);
  return Response.json({
    answer: r?.text ?? "L'assistant est indisponible pour le moment. Parcourez le catalogue ou contactez le support.",
    products: hits.map((h) => ({ slug: h.slug, name: h.name })),
  });
}
