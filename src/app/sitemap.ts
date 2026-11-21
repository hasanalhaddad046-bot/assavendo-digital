import type { MetadataRoute } from "next";
import { supabasePublic } from "@/lib/supabase";

export const dynamic = "force-dynamic";

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const base = process.env.NEXT_PUBLIC_SITE_URL || "https://assavendo-shop.vercel.app";
  const fixed = ["", "/produits", "/livraison", "/retours", "/cgv", "/confidentialite", "/mentions-legales"].map((p) => ({ url: base + p }));
  try {
    const { data } = await supabasePublic().from("products").select("slug").limit(1000);
    return [...fixed, ...(data ?? []).map((p) => ({ url: `${base}/produits/${p.slug}` }))];
  } catch {
    return fixed;
  }
}
