// Nexora Diary — Edge Function `diary-request-sync`
//
// Appelée depuis le dashboard Ops du diary quand un manager clique
// « 🔄 Demander une sync ». Envoie un DM Telegram à l'admin du bot pour
// lui signaler qu'un resync du roster est demandé ; il tape /diarysync
// et le bot pousse l'état complet vers Supabase (via diary_sync.py).
//
// Auth : appel authentifié Supabase (JWT dans Authorization). Le user doit
// avoir le rôle `ops` ou `admin` dans diary_responsables.
//
// Secrets attendus (Project Settings → Functions → Secrets) :
//   TELEGRAM_BOT_TOKEN — token du bot @agencehmz_bot (celui du bot d'onboarding)
//   TELEGRAM_ADMIN_ID  — chat_id de Titouan (ADMIN_ID du bot)
//
// Le SUPABASE_URL et SUPABASE_ANON_KEY sont injectés automatiquement.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.0'

const CORS = {
  'Access-Control-Allow-Origin':  '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })
  if (req.method !== 'POST')    return json({ error: 'method_not_allowed' }, 405)

  try {
    // 1) Vérifier que l'appelant est ops/admin via son JWT
    const authHeader = req.headers.get('Authorization') || ''
    if (!authHeader.startsWith('Bearer ')) return json({ error: 'no_auth' }, 401)

    const supaUrl = Deno.env.get('SUPABASE_URL')!
    const supaAnon = Deno.env.get('SUPABASE_ANON_KEY')!
    const sb = createClient(supaUrl, supaAnon, {
      global: { headers: { Authorization: authHeader } },
    })

    const { data: { user }, error: uerr } = await sb.auth.getUser()
    if (uerr || !user) return json({ error: 'invalid_token', detail: uerr?.message }, 401)

    const { data: resp, error: rerr } = await sb
      .from('diary_responsables')
      .select('id, nom, role')
      .eq('auth_user_id', user.id)
      .maybeSingle()
    if (rerr) return json({ error: 'db_error', detail: rerr.message }, 500)
    if (!resp || !['ops', 'admin'].includes(resp.role)) {
      return json({ error: 'forbidden', detail: 'ops/admin only' }, 403)
    }

    // 2) Envoyer un DM Telegram à l'admin
    const botToken = Deno.env.get('TELEGRAM_BOT_TOKEN')
    const adminId  = Deno.env.get('TELEGRAM_ADMIN_ID')
    if (!botToken || !adminId) {
      return json({
        error: 'missing_telegram_secrets',
        hint: 'Configure TELEGRAM_BOT_TOKEN et TELEGRAM_ADMIN_ID dans Project Settings → Functions → Secrets',
      }, 500)
    }

    const text =
      `🔄 **Diary sync demandée** par *${resp.nom}* (Ops).\n` +
      `Tape \`/diarysync\` pour pousser le roster actuel vers Supabase.`

    const tgResp = await fetch(
      `https://api.telegram.org/bot${botToken}/sendMessage`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          chat_id:    adminId,
          text,
          parse_mode: 'Markdown',
        }),
      }
    )
    const tgJson = await tgResp.json()
    if (!tgResp.ok || !tgJson.ok) {
      return json({ error: 'telegram_failed', detail: tgJson }, 502)
    }

    return json({ ok: true, requested_by: resp.nom })
  } catch (e) {
    return json({ error: 'unexpected', detail: String(e) }, 500)
  }
})

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, 'Content-Type': 'application/json' },
  })
}
