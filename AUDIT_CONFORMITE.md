# Audit de conformité — Cahier des charges V6 (état au 21/11/2026)

Légende : ✅ fait · 🟡 partiel · ❌ non fait · 👤 action requise de votre part

## 1. Socle technique et sécurité
| Point | État | Détail |
|---|---|---|
| Stack Next.js + Supabase + Vercel | ✅ | Déployé (build READY, HTTP 200, aucune erreur runtime) |
| Schéma BDD + RLS partout | ✅ | Seuls catégories et produits publiés sont lisibles publiquement |
| Clés serveur jamais exposées | ✅ | service_role et Paystack côté serveur uniquement |
| En-têtes de sécurité | ✅ | CSP/HSTS/etc. dans next.config.mjs |
| Variables d'environnement Vercel | 👤 | Ajouter SUPABASE_SERVICE_ROLE_KEY et PAYSTACK_SECRET_KEY dans le tableau de bord Vercel |
| Accès public au site | 👤 | Vercel Authentication bloque *.vercel.app (webhooks inclus) : domaine personnalisé ou désactiver la protection |
| Dépôt GitHub | ❌ 👤 | Aucun dépôt visible/accessible (jeton GitHub invalide côté sandbox) : créer un dépôt vide et me donner son nom, ou le pousser vous-même |

## 2. Argent, prix, devises
| Point | État | Détail |
|---|---|---|
| Montants en unités mineures entières | ✅ | money.ts |
| Formule de prix corrigée (marge sur prix de vente) | ✅ | 8 tests passent |
| Frais Paystack non codés en dur | ✅ | paystack_fee_pct obligatoire (👤 à renseigner) |
| Taux de change quotidiens, secours, jamais inventés | ✅ | Cron 05:00 UTC ; 🟡 snapshot pas encore rempli tant que le cron n'a pas tourné |
| Prix fournisseur saisi en devise source, conversion auto en USD | 🟡 | Moteur prêt (toUsd) ; pas d'interface de saisie |
| Affichage en devise locale indicative | 🟡 | usdToLocal prêt ; page produit à brancher complètement |

## 3. Paiement Paystack
| Point | État | Détail |
|---|---|---|
| Signature HMAC-SHA512 sur corps brut | ✅ | |
| Idempotence des webhooks | ✅ | clé unique |
| Vérification API montant/devise/référence | ✅ | |
| Verrou dropshipping (autorisation écrite requise) | ✅ | checkout renvoie 503 tant que non approuvé |
| Autorisation écrite Paystack | 👤 | À obtenir avant toute vente de produits physiques |
| Remboursements via Paystack | ❌ | |

## 4. Catalogue
| Point | État | Détail |
|---|---|---|
| 38 catégories (13 physiques, 10 numériques, 15 services) | ✅ | Insérées en base aujourd'hui ; « Alimentation » désactivée par défaut |
| Produits, fournisseurs, offres (modes A/B/C) | 🟡 | Tables prêtes, aucune interface d'administration |
| Matrice pays/produit, DDP/DAP | 🟡 | Données et texte prévus ; affichage par pays non terminé |
| Annuaire d'agences / adresses d'entrepôts en Chine | ❌ | |
| Fiche d'achat et réexpédition | ❌ | |

## 5. Commande et client
| Point | État | Détail |
|---|---|---|
| Achat d'un produit (checkout serveur) | ✅ | Prix lu en base, jamais du client |
| Panier multi-articles | ❌ | |
| Comptes clients, suivi de commande | ❌ | |
| E-mails de notification | ❌ | |
| Facturation / TVA / numérotation | ❌ | |
| Retours (RMA) avec provision | 🟡 | Provision dans le prix ; pas de module RMA |

## 6. Risque et VPN
| Point | État | Détail |
|---|---|---|
| Score explicable, niveaux 0–4, VPN seul = journal | ✅ | Testé |
| Intégration d'un fournisseur de détection VPN/IP | ❌ | |

## 7. IA
| Point | État | Détail |
|---|---|---|
| Passerelle OpenRouter/Groq/DeepSeek, repli, anonymisation | ✅ | Hors chemin de paiement |
| Clés ASV_KEY_* | 👤 | À ajouter dans Vercel |
| Assistant client, copilote admin, recherche IA, Manus | ❌ | |

## 8. Juridique et conformité
| Point | État | Détail |
|---|---|---|
| Pages livraison, retours, confidentialité | 🟡 | Textes provisoires signalés comme tels |
| CGV, mentions légales | ❌ | |
| Obligations fiscales TRA et loi tanzanienne PDPA 2022 | 👤 | Conseil local à consulter (voir ERRATA §C) |
| Rétention et suppression des données | ❌ | |

## Verdict
Le socle (sécurité, argent, paiement verrouillé, taux, risque, IA, schéma, catégories) est solide et testé. La boutique n'est pas prête à vendre : il manque le back-office, le panier/comptes, les e-mails, la facturation, le module retours et les textes légaux définitifs.

## Ordre de priorité proposé
1. Back-office admin protégé (produits, fournisseurs, offres, saisie prix source → USD).
2. Panier + suivi de commande + e-mails transactionnels.
3. Matrice pays/DDP/DAP et affichage local des prix.
4. Retours/RMA et remboursements.
5. Facturation/TVA et textes légaux validés.
6. Assistant IA et copilote.
