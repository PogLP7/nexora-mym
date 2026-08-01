# Nexora Diary — Fiche quotidienne Responsable de Pôle

MVP single-file (HTML + Supabase JS via CDN). Même stack que le CRM SFS, déployable en `git push`.

## Contenu

- `index.html` — SPA hash-routing (login magic link, fiche du jour, historique, dashboard Ops).
- `schema.sql` — migrations Supabase (tables `diary_*`, triggers alertes, RLS).
- `README.md` — ce fichier.

## Setup

### 1. Supabase

1. Ouvrir le projet Supabase `bvcnbtbdfkoiefuedxem` (celui du CRM SFS).
2. **SQL Editor** → coller le contenu de `schema.sql` → *Run*. Les tables `diary_*` sont créées sans toucher au CRM SFS existant.
3. **Authentication → Providers** : activer *Email* (magic link OTP).
4. **Authentication → URL Configuration** : ajouter l'URL du site déployé dans *Redirect URLs* (ex : `https://diary.nexora.fr`).

### 2. Front

Ouvrir `index.html`, remplacer :

```js
const CONFIG = {
  supabaseUrl: 'https://bvcnbtbdfkoiefuedxem.supabase.co',
  supabaseAnonKey: 'REPLACE_ME_ANON_KEY',
};
```

par la vraie `anon` key (Supabase → *Settings* → *API* → `anon public`). C'est safe côté client : la sécurité est portée par la RLS.

### 3. Seed du premier responsable

Dans Supabase :

1. **Authentication → Users → Add user** → renseigner l'email (méthode *magic link*, pas de mdp).
2. Copier l'`uuid` du user créé.
3. Dans le SQL Editor :

```sql
insert into diary_responsables (auth_user_id, email, nom, role) values
  ('<uuid-du-user>', 'ton.email@nexora.fr', 'Ton Nom', 'admin');

insert into diary_poles (nom, responsable_id) values
  ('Nom du Pôle A', (select id from diary_responsables where email='ton.email@nexora.fr')),
  ('Nom du Pôle B', (select id from diary_responsables where email='ton.email@nexora.fr'));

insert into diary_clippers (nom, pole_id) values
  ('Nom Clipper 1', (select id from diary_poles where nom='Nom du Pôle A')),
  ('Nom Clipper 2', (select id from diary_poles where nom='Nom du Pôle A')),
  ('Nom Clipper 3', (select id from diary_poles where nom='Nom du Pôle B'));
```

`role` : `responsable` (défaut), `ops` (voit toutes les fiches + résout les alertes), `admin` (idem `ops`).

### 4. Déploiement

Même workflow que le CRM SFS (git push via `osxkeychain`, fallback base64). Le projet est 2 fichiers plats : n'importe quel host statique fait le job (Vercel, Netlify, Cloudflare Pages, GitHub Pages).

Si tu commits :

```bash
cd /Users/titouanleport/Documents/nexora-diary
git init && git add . && git commit -m "init nexora-diary MVP"
```

Puis crée le remote et push comme pour le CRM.

## Utilisation

- **Responsable** :
  1. Va sur le site → entre son email → reçoit le magic link.
  2. Écran *Ma fiche du jour* : coche les 9 contrôles pôle par pôle, remplit les cartes clippers (6 coches + toggles rouges + note + reels perfs).
  3. Tout est **autosave** (débounce 500 ms). Indicateur en haut à droite.
  4. Bouton **Clôturer la journée** en bas → la fiche passe en lecture seule.

- **Ops** (rôle `ops`/`admin`) :
  - Onglet *Ops* : alertes rouges live + fiches du jour, drill-down.
  - Peut résoudre une alerte (met `resolved_at`).

## Alertes automatiques

3 toggles rouges par clipper créent une entrée dans `diary_alerts` **dès que coché**, même en brouillon :

- `compte_banni` → alerte `ban`
- `contenu_manquant` → alerte `contenu_manquant`
- `en_difficulte` → alerte `difficulte`

Décocher le toggle résout automatiquement l'alerte (`resolved_at = now()`). Géré côté SQL par le trigger `diary_sync_alerts`.

## Roadmap (phase 2, hors MVP)

- Sync Telegram bot pour tenir la liste des clippers à jour (arrivées/départs).
- Envoi Telegram du récap à la clôture + push d'alertes rouges au RO.
- Fusion dans le repo CRM SFS (mêmes routes montées dans le CRM, header partagé).
- Stats agrégées (% conformité par pôle/clipper, séries temporelles paliers GetMySocial).

## Vérification post-setup

- [ ] Se connecter via magic link → arriver sur `#/diary`.
- [ ] Cocher partiellement une fiche → recharger la page → coches restaurées.
- [ ] Cocher un toggle rouge → une entrée apparaît dans `diary_alerts` (SQL Editor).
- [ ] Se connecter en compte `ops` (2e navigateur) → onglet Ops → l'alerte est là en live.
- [ ] Clôturer la fiche → passage en lecture seule, `submitted_at` renseigné.
- [ ] Tenter d'éditer un `pole_check` d'un autre responsable → refusé par la RLS.
