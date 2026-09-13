# Nexora Dispos : disponibilités des chatteurs

Page unique, sans compte, où les chatteurs du pôle chatting déclarent leurs créneaux de la semaine suivante. Même stack que le CRM SFS et Diary : un fichier HTML statique, Supabase JS via CDN, déployé en `git push`.

**URL :** https://getsnexora.com/dispos/

## Fonctionnement

- Le chatteur clique sur son prénom, entre son **code à 6 chiffres** (une fois par appareil), coche ses créneaux et note ses indisponibilités.
- Créneaux : nuit 02h-08h, matin 08h-14h, après-midi 14h-20h, soir 20h-02h.
- Plafonds, vérifiés **côté serveur** : 8 créneaux par personne, 8 personnes par créneau (4 modèles × 2 chatteurs).
- La page s'ouvre directement sur la semaine qui arrive ; navigation possible de la semaine en cours à trois semaines devant.
- Bouton **Admin** (visible avec `#admin` dans l'adresse, code à 8 chiffres) : onglet **Équipe** (couverture, qui a répondu, indisponibilités, récap à copier) et onglet **Envoi** (le message privé de chaque chatteur avec son code, suivi des envois, relance des retardataires).

## Sécurité

- Les tables `dispos_*` ont la RLS activée **sans aucune policy** : aucun accès direct depuis le navigateur.
- Tout passe par des fonctions `SECURITY DEFINER` qui vérifient le code côté serveur.
- **Aucun code n'est dans la page ni dans ce dépôt.** Les codes chatteurs sont en base ; le code admin est stocké haché (bcrypt).
- 5 essais ratés en 15 minutes (ou 20 en 24 h) bloquent le code concerné ; un appareil déjà connecté (jeton) n'est jamais bloqué.
- Les connexions sont refusées en lecture seule (GET), sérialisées par clé, et les échecs ne sont comptés que pour un prénom réel.

## Installation

1. Supabase, projet `bvcnbtbdfkoiefuedxem` → **SQL Editor** → coller `schema.sql` → *Run*. Idempotent, ne touche à aucune autre table.
2. Seed des chatteurs et du code admin : fichier séparé, **jamais committé**, conservé par Titouan.

## Ajouter ou retirer un chatteur

Dans le SQL Editor :

```sql
-- ajouter
insert into public.dispos_chatteurs (slug, nom, pin, ordre)
values ('prenom', 'Prénom', '000000', 99);

-- retirer (ses anciennes réponses sont conservées)
update public.dispos_chatteurs set actif = false where slug = 'prenom';
```

Choisir un code à 6 chiffres non trivial, puis l'envoyer depuis l'onglet **Envoi**.

## Changer le code admin

```sql
update public.dispos_config
set valeur = extensions.crypt('NOUVEAU_CODE', extensions.gen_salt('bf'))
where cle = 'code_admin';
```

## Lire les réponses hors de la page

`dispos_admin_connexion(p_code)` renvoie un jeton admin (valable 90 jours, révoqué si le code change). `dispos_admin(p_jeton, p_semaine)` renvoie en JSON les chatteurs, les réponses de la semaine et les envois. C'est ce qu'utilise le récap automatique du dimanche soir, avec un jeton dédié stocké sur le Mac de Titouan (`~/.config/nexora/`).
