# Assavendo Digital — boutique (Next.js + Supabase + Vercel)

Port du cahier des charges V6 (voir `ERRATA_CAHIER_V6.md` pour les corrections appliquées).

## Contenu
- `supabase/migrations/0001_init.sql` : schéma + RLS (seuls les produits publiés sont lisibles publiquement ; coûts, fournisseurs, commandes et paiements restent serveur uniquement).
- `src/lib/pricing.ts` : `P = coûts fixes ÷ (1 − marge − frais% − provision%)`, frais de paiement obligatoires.
- `src/lib/fx.ts` : taux USD, source principale + secours, jamais de taux inventé, actualisation quotidienne (cron Vercel).
- `src/lib/paystack.ts` : verrou d'éligibilité dropshipping, init serveur, signature HMAC-SHA512 sur corps brut, idempotence, vérification API montant/devise.
- `src/lib/risk.ts` : score explicable ; un VPN seul ne bloque pas.
- `src/lib/ai-gateway.ts` : OpenRouter / Groq / DeepSeek avec repli et anonymisation ; hors chemin de paiement.
- `src/app` : accueil, fiche produit, checkout serveur, webhook Paystack, pages légales provisoires.

## Mise en route
1. Créer un projet Supabase, exécuter `supabase/migrations/0001_init.sql`.
2. Copier `.env.example` vers `.env.local` et renseigner les clés (jamais dans Git).
3. `npm install && npm test && npm run dev`.
4. Vercel : importer le dépôt GitHub, définir les mêmes variables ; le cron `/api/cron/fx` utilise `CRON_SECRET`.
5. Paystack : webhook vers `https://<domaine>/api/paystack/webhook`.

## Verrou Paystack
Tant que `settings.paystack_dropshipping_status` n'est pas `approved` avec `paystack_approval_proof` renseigné, `/api/checkout` refuse tout encaissement. Aucun contournement n'est prévu.

## Non couvert à ce stade
Back-office (fournisseurs, offres, fiche d'achat, réexpédition), panier multi-articles, comptes clients, e-mails, facturation/TVA, connecteur Manus, pages légales définitives.
