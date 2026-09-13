# Nexora Dispos : disponibilités des chatteurs

Page unique, sans compte, où les chatteurs du pôle chatting déclarent leurs créneaux de la semaine suivante. Même stack que le CRM SFS et Diary : un fichier HTML statique, Supabase JS via CDN, déployé en `git push`.

**URL :** https://getsnexora.com/dispos/

## Fonctionnement

- Le chatteur clique sur son prénom, entre son **code à 4 chiffres**, coche ses créneaux et note ses indisponibilités.
- Créneaux : nuit 02h-08h, matin 08h-14h, après-midi 14h-20h, soir 20h-02h.
- Plafonds, vérifiés **côté serveur** : 8 créneaux par personne, 8 personnes par créneau (4 modèles × 2 chatteurs).
- Le week-end, la page s'ouvre directement sur la semaine qui arrive.
- Bouton **Admin** (code à 6 chiffres) : onglet **Équipe** (couverture, qui a répondu, indisponibilités, récap à copier) et onglet **Envoi** (le message privé de chaque chatteur avec son code, suivi des envois, relance des retardataires).

## Sécurité

- Les tables `dispos_*` ont la RLS activée **sans aucune policy** : aucun accès direct depuis le navigateur.
- Tout passe par des fonctions `SECURITY DEFINER` qui vérifient le code côté serveur.
- **Aucun code n'est dans la page ni dans ce dépôt.** Les codes chatteurs sont en base ; le code admin est stocké haché (bcrypt).
- 8 essais ratés en 15 minutes bloquent le code concerné pendant 15 minutes.
- Limite assumée : un code à 4 chiffres arrête l'erreur et l'usurpation facile, pas un attaquant déterminé et patient.

## Installation

1. Supabase, projet `bvcnbtbdfkoiefuedxem` → **SQL Editor** → coller `schema.sql` → *Run*. Idempotent, ne touche à aucune autre table.
2. Seed des chatteurs et du code admin : fichier séparé, **jamais committé**, conservé par Titouan.

## Ajouter ou retirer un chatteur

Dans le SQL Editor :

```sql
-- ajouter
insert into public.dispos_chatteurs (slug, nom, pin, ordre)
values ('prenom', 'Prénom', '0000', 99);

-- retirer (ses anciennes réponses sont conservées)
update public.dispos_chatteurs set actif = false where slug = 'prenom';
```

Choisir un code à 4 chiffres non trivial, puis l'envoyer depuis l'onglet **Envoi**.

## Changer le code admin

```sql
update public.dispos_config
set valeur = extensions.crypt('NOUVEAU_CODE', extensions.gen_salt('bf'))
where cle = 'code_admin';
```

## Lire les réponses hors de la page

La fonction `dispos_admin(p_code, p_semaine)` renvoie en JSON les chatteurs, les réponses de la semaine et les envois. C'est elle qu'utilise le récap automatique du dimanche soir.
