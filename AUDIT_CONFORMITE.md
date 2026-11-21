# Audit de conformité — Cahier des charges V6 (mis à jour le 21/11/2026)

Légende : ✅ fait · 🟡 partiel · ❌ non fait · 👤 action de votre part
**Important : ce code n'a pas pu être compilé ici (pas d'accès réseau pour installer les dépendances).** Seuls les 8 tests du moteur (prix, risque, monnaie) ont été exécutés. La compilation réelle aura lieu au premier déploiement Vercel depuis GitHub ; des corrections mineures de build sont possibles.

## Socle
| Point | État |
|---|---|
| Next.js + Supabase + Vercel, RLS partout, en-têtes de sécurité | ✅ |
| Schéma 0001 + 0002 appliqués sur Supabase | ✅ |
| 38 catégories (alimentation désactivée) | ✅ |
| Dépôt GitHub poussé (main) | ✅ |
| Déploiement automatique GitHub → Vercel | 👤 Ajouter GitHub dans Vercel (Account Settings → Authentication) puis relier le dépôt |

## Argent / prix / devises
| Moteur de prix déterministe, marge sur prix de vente, frais obligatoires | ✅ testé |
| Prix source en devise d'origine → USD automatique (calcul du prix dans l'admin) | ✅ |
| Taux quotidiens avec secours, jamais inventés ; affichage local indicatif | ✅ (👤 premier cron à 05:00 UTC) |
| Panier multi-articles, frais de livraison par pays/produit | ✅ |

## Paiement
| Signature, idempotence, vérification API, verrou dropshipping | ✅ |
| Remboursements via Paystack depuis l'admin | ✅ (non testé en réel) |
| Autorisation écrite Paystack | 👤 |

## Catalogue / logistique
| Back-office : produits, offres, fournisseurs, agences, paramètres | ✅ |
| Matrice pays/produit, DDP/DAP, délais, publication bloquée si incomplète | ✅ |
| Fiche d'achat (référence fournisseur, agence, transporteur, suivi) | ✅ |
| Annuaire d'agences | 🟡 structure prête ; adresses réelles à saisir par vous (aucune inventée) |
| Offre figée (instantané) à la vente | ✅ |

## Client
| Suivi par lien/numéro+e-mail, historique public | ✅ |
| Comptes clients avec mot de passe | ❌ remplacé par suivi sans compte (choix de simplification) |
| E-mails transactionnels | ✅ via Resend (👤 RESEND_API_KEY + MAIL_FROM) ; sinon mis en file visible en admin |
| Facture numérotée continue, TVA paramétrable | ✅ |
| Retours/RMA (demande client, traitement admin, remboursement) | ✅ |
| Validation d'adresse (téléphone/pays/code postal) | 🟡 règles de base, pas de géocodage |

## Risque, IA, conformité
| Score de risque, politique VPN | ✅ ; détection VPN réelle via IPQS optionnelle (👤 IPQS_API_KEY) |
| Passerelle IA, assistant client, brouillon de description admin | ✅ (👤 clés et modèles) |
| Connecteur Manus | ❌ contrat d'API non fourni, rien d'inventé |
| Copilote admin avancé / workflows | ❌ |
| CGV, mentions, confidentialité, retours, livraison rédigés | ✅ versions de travail, 👤 relecture juridique + identité légale à saisir |
| Conservation limitée (anonymisation hebdomadaire) | ✅ |
| Limitation de débit | 🟡 en mémoire par instance ; compléter par le pare-feu Vercel |
| Accès admin | ✅ mot de passe unique + session signée (👤 ADMIN_PASSWORD, ADMIN_SESSION_SECRET) |
