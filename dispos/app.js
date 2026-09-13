/* Nexora Dispos : disponibilites des chatteurs. Voir README.md. */
(function(){
'use strict';

if (window.top !== window.self) { document.documentElement.innerHTML = ''; return; }

var CONFIG = { url: 'https://bvcnbtbdfkoiefuedxem.supabase.co', key: 'sb_publishable__X2Z5ELAvPpQ2CK7CKoXpQ_J2F2ZxEP' };
var LIEN = 'https://getsnexora.com/dispos/';
var MAXH = 8, MAXP = 8, NPIN = 6, NADM = 8;
var SL = [
  { i: 'nuit',  l: 'Nuit',       h: '02h — 08h', c: 'var(--c-nuit)',  r: 'rgba(110,123,255,.26)' },
  { i: 'matin', l: 'Matin',      h: '08h — 14h', c: 'var(--c-matin)', r: 'rgba(63,208,201,.26)'  },
  { i: 'aprem', l: 'Après-midi', h: '14h — 20h', c: 'var(--c-aprem)', r: 'rgba(242,178,60,.26)'  },
  { i: 'soir',  l: 'Soir',       h: '20h — 02h', c: 'var(--c-soir)',  r: 'rgba(255,95,168,.26)'  }
];
var JR = ['Lundi','Mardi','Mercredi','Jeudi','Vendredi','Samedi','Dimanche'];
var AB = ['Lun','Mar','Mer','Jeu','Ven','Sam','Dim'];
var MO = ['janv','févr','mars','avr','mai','juin','juil','août','sept','oct','nov','déc'];

/* ------------------------------------------------------------- outils */
function $(id){ return document.getElementById(id); }
function each(list, fn){ Array.prototype.forEach.call(list, fn); }
function lun(d){ var x = new Date(d); var j = (x.getDay() + 6) % 7; x.setDate(x.getDate() - j); x.setHours(0,0,0,0); return x; }
function ad(d, n){ var x = new Date(d); x.setDate(x.getDate() + n); return x; }
function iso(d){ return d.getFullYear() + '-' + String(d.getMonth()+1).padStart(2,'0') + '-' + String(d.getDate()).padStart(2,'0'); }
function fr(d){ return d.getDate() + ' ' + MO[d.getMonth()]; }
function esc(s){ return String(s == null ? '' : s).replace(/[&<>"']/g, function(c){ return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]; }); }
function el(t, c, h){ var e = document.createElement(t); e.className = c; if (h) e.innerHTML = h; return e; }
function ecrire(zone, k, v){ try { if (v == null) window[zone].removeItem(k); else window[zone].setItem(k, v); } catch(e){} }
function lire(zone, k){ try { return window[zone].getItem(k); } catch(e){ return null; } }
function cles(o){ return Object.keys(o).filter(function(k){ return o[k]; }).sort(); }
function msg(id, t, ok){ var m = $(id); if (!m) return; m.textContent = t || ''; m.className = (m.className.indexOf('pmsg') >= 0 ? 'pmsg' : 'msg') + (ok ? ' ok' : ''); }

/* ---------------------------------------------------------------- API */
function rpc(fn, args){
  return fetch(CONFIG.url + '/rest/v1/rpc/' + fn, {
    method: 'POST',
    headers: { 'apikey': CONFIG.key, 'Authorization': 'Bearer ' + CONFIG.key, 'Content-Type': 'application/json', 'Accept': 'application/json' },
    body: JSON.stringify(args || {}),
    cache: 'no-store'
  }).then(function(res){
    return res.text().then(function(txt){
      var data = null;
      try { data = txt ? JSON.parse(txt) : null; } catch(e){ data = null; }
      if (!res.ok){
        var err = new Error((data && data.message) || ('HTTP ' + res.status));
        err.status = res.status; err.code = data && data.code;
        throw err;
      }
      return data;
    });
  }, function(){
    var err = new Error('reseau'); err.status = 0; throw err;
  });
}
function texteErreur(e){ return e && e.status ? 'ERREUR SERVEUR (' + e.status + ') — PRÉVIENS TITOUAN' : 'RÉSEAU INDISPONIBLE — RÉESSAIE'; }
function reseau(e){ $('net').classList.toggle('on', !!e && !e.status); }

/* --------------------------------------------------------------- état */
var GENS = [];
var aujourdhui = lun(new Date());
var sem = ad(aujourdhui, 7);          // par defaut : la semaine a planifier
var moi = null;
var JETONS = {};
var sel = {}, saved = {}, indSaved = '';
var compte = {}, repondu = {}, ouverte = true;
var ADM = lire('sessionStorage', 'nxd_adm');
var adm = null, envoisLocaux = {};
var enAttente = null;
var jChargement = 0, jEtat = 0, jAdmin = 0;

try { JETONS = JSON.parse(lire('localStorage', 'nxd_jetons') || '{}') || {}; } catch(e){ JETONS = {}; }
function sauverJetons(){ ecrire('localStorage', 'nxd_jetons', JSON.stringify(JETONS)); }
function nomDe(slug){ for (var i = 0; i < GENS.length; i++) if (GENS[i].slug === slug) return GENS[i].nom; return slug || ''; }
function estAdminVisible(){ return document.body.classList.contains('admin'); }

/* ------------------------------------------------------------ onglets */
each(document.querySelectorAll('.tab'), function(t){
  t.addEventListener('click', function(){
    if (t.classList.contains('ad') && !estAdminVisible()) return;
    each(document.querySelectorAll('.tab'), function(x){ x.classList.remove('on'); });
    each(document.querySelectorAll('.pan'), function(x){ x.classList.remove('on'); });
    t.classList.add('on');
    $('p-' + t.dataset.p).classList.add('on');
    if (t.dataset.p !== 'moi') rafraichirAdmin();
  });
});
function ongletMoi(){ document.querySelector('.tab[data-p="moi"]').click(); }

/* ------------------------------------------------------------ semaine */
function libelleSemaine(){
  var ec = Math.round((sem - aujourdhui) / 864e5 / 7);
  var tag = ec === 0 ? ' · EN COURS' : ec === 1 ? ' · PROCHAINE' : '';
  $('wl').textContent = fr(sem).toUpperCase() + ' → ' + fr(ad(sem, 6)).toUpperCase() + tag;
  var min = aujourdhui, max = ad(aujourdhui, 21);
  var libre = estAdminVisible();
  $('wp').disabled = !libre && sem <= min;
  $('wn').disabled = !libre && sem >= max;
}
function changerSemaine(delta){
  var n = ad(sem, 7 * delta);
  if (!estAdminVisible() && (n < aujourdhui || n > ad(aujourdhui, 21))) return;
  if (sale() && !window.confirm('Tes modifications ne sont pas enregistrées. Changer de semaine quand même ?')) return;
  sem = n;
  semaine();
}
$('wp').addEventListener('click', function(){ changerSemaine(-1); });
$('wn').addEventListener('click', function(){ changerSemaine(1); });

function semaine(){
  libelleSemaine();
  sel = {}; saved = {}; indSaved = ''; compte = {}; repondu = {}; ouverte = true;
  $('ind').value = '';
  enAttente = null;
  grille(); couverture(); jauge(); majNoms();
  viderAdmin();
  rafraichirEtat();
  if (moi) choisir(moi);
  if (ADM) rafraichirAdmin();
}

/* ---------------------------------------------------------------- noms */
function chargerListe(){
  $('names').innerHTML = '<span class="loading">Chargement…</span>';
  return rpc('dispos_liste').then(function(liste){
    reseau(null);
    GENS = Array.isArray(liste) ? liste : [];
    var c = $('names'); c.innerHTML = '';
    if (!GENS.length){ c.innerHTML = '<span class="loading">Aucun chatteur</span>'; return; }
    GENS.forEach(function(g){
      var b = el('button', 'nm');
      b.type = 'button'; b.dataset.s = g.slug; b.textContent = g.nom;
      b.addEventListener('click', function(){
        if (moi !== g.slug && sale() && !window.confirm('Tes modifications ne sont pas enregistrées. Changer de prénom quand même ?')) return;
        choisir(g.slug);
      });
      c.appendChild(b);
    });
    var dernier = lire('localStorage', 'nxd_moi');
    if (GENS.some(function(g){ return g.slug === dernier; })) choisir(dernier);
    majNoms();
  }).catch(function(e){
    reseau(e);
    $('names').innerHTML = '<span class="loading">' + esc(texteErreur(e)) + '</span> <button type="button" class="q" id="retry">Réessayer</button>';
    $('retry').addEventListener('click', chargerListe);
  });
}
function majNoms(){
  each(document.querySelectorAll('.nm'), function(b){
    b.classList.toggle('on', b.dataset.s === moi);
    b.classList.toggle('done', !!repondu[b.dataset.s]);
  });
}

/* ------------------------------------------------------- code chatteur */
function montrerPin(t){
  jChargement++;
  $('zone').style.display = 'none';
  $('chargement').style.display = 'none';
  $('pinzone').style.display = 'block';
  var p = $('pin'); p.value = ''; p.disabled = false;
  msg('pmsg', t || '');
  setTimeout(function(){ try { p.focus(); } catch(e){} }, 30);
}
function choisir(slug){
  moi = slug; ecrire('localStorage', 'nxd_moi', slug);
  majNoms();
  $('who').textContent = nomDe(slug);
  $('fb').style.display = 'none';
  msg('msg', '');
  sel = {}; saved = {}; indSaved = ''; $('ind').value = '';
  $('zone').style.display = 'none';
  if (JETONS[slug]) charger(slug);
  else montrerPin();
}

$('pin').addEventListener('input', function(){
  var p = $('pin');
  var v = p.value.replace(/\D/g, '').slice(0, NPIN);
  if (p.value !== v) p.value = v;
  if (v.length === NPIN && moi) connecter(moi, v);
});

function connecter(slug, code){
  var p = $('pin');
  p.disabled = true;
  msg('pmsg', 'VÉRIFICATION…');
  rpc('dispos_connexion', { p_slug: slug, p_pin: code }).then(function(r){
    reseau(null);
    if (slug !== moi) return;
    p.disabled = false;
    if (r && r.ok && r.jeton){
      JETONS[slug] = r.jeton; sauverJetons();
      p.value = '';
      charger(slug);
      return;
    }
    p.value = '';
    msg('pmsg', r && r.erreur === 'bloque' ? 'TROP D\'ESSAIS — RÉESSAIE PLUS TARD' : 'CODE INCORRECT');
    p.classList.add('bad');
    setTimeout(function(){ p.classList.remove('bad'); try { p.focus(); } catch(e){} }, 520);
  }).catch(function(e){
    if (slug !== moi) return;
    reseau(e);
    p.disabled = false;
    msg('pmsg', texteErreur(e));
  });
}

function charger(slug){
  var j = ++jChargement, s = iso(sem), tok = JETONS[slug];
  $('pinzone').style.display = 'none';
  $('zone').style.display = 'none';
  $('chargement').style.display = 'block';
  rpc('dispos_charger', { p_semaine: s, p_jeton: tok }).then(function(r){
    if (j !== jChargement || slug !== moi || s !== iso(sem)) return;
    reseau(null);
    $('chargement').style.display = 'none';
    if (!r || !r.ok || r.slug !== slug){
      if (JETONS[slug] === tok){ delete JETONS[slug]; sauverJetons(); }
      montrerPin(enAttente ? 'ENTRE TON CODE — TES MODIFICATIONS SONT GARDÉES' : 'ENTRE TON CODE');
      return;
    }
    sel = {}; saved = {};
    (r.slots || []).forEach(function(k){ sel[k] = true; saved[k] = true; });
    indSaved = r.indispos || '';
    $('ind').value = indSaved;
    var restaure = false;
    if (enAttente && enAttente.slug === slug && enAttente.s === s){
      sel = enAttente.sel; $('ind').value = enAttente.ind; restaure = true;
    }
    enAttente = null;
    ouverte = r.ouverte !== false;
    $('zone').style.display = 'block';
    etatOuverture();
    jauge();
    if (restaure) msg('msg', 'TES MODIFICATIONS SONT REVENUES — ENREGISTRE');
    else msg('msg', r.existe ? 'DÉJÀ ENREGISTRÉ — TU PEUX MODIFIER' : '');
    var b = $('board'); b.classList.remove('set');
    setTimeout(function(){ b.classList.add('set'); }, 50);
  }).catch(function(e){
    if (j !== jChargement || slug !== moi || s !== iso(sem)) return;
    reseau(e);
    $('chargement').style.display = 'none';
    $('pinzone').style.display = 'block';
    $('pin').disabled = true;
    msg('pmsg', texteErreur(e));
    var r = el('button', 'q'); r.type = 'button'; r.textContent = 'Réessayer';
    r.style.marginLeft = '10px';
    r.addEventListener('click', function(){ charger(slug); });
    $('pmsg').appendChild(r);
  });
}

/* ------------------------------------------------------------- grille */
function occ(k){ return Math.max(0, (compte[k] || 0) - (saved[k] ? 1 : 0)); }

function grille(){
  var b = $('board'); b.innerHTML = ''; b.classList.remove('set');
  var h = el('div', 'row hd');
  h.appendChild(el('div', 'dy'));
  JR.forEach(function(j, di){ h.appendChild(el('div', 'h', '<b>' + AB[di] + '</b><span>' + ad(sem, di).getDate() + '</span>')); });
  b.appendChild(h);
  SL.forEach(function(s){
    var r = el('div', 'row br');
    r.style.setProperty('--c', s.c); r.style.setProperty('--cr', s.r);
    r.appendChild(el('div', 'dy', '<b>' + s.l + '</b><span>' + s.h + '</span>'));
    JR.forEach(function(j, di){
      var k = di + '-' + s.i;
      var c = el('button', 'cl', '<i></i><span class="cnt"></span>');
      c.type = 'button'; c.dataset.k = k;
      c.setAttribute('aria-label', JR[di] + ' ' + s.l);
      c.addEventListener('click', function(){ basculer(k, c); });
      r.appendChild(c);
    });
    b.appendChild(r);
  });
}
function basculer(k, c){
  if (!ouverte) return;
  if (sel[k]) delete sel[k];
  else {
    if (cles(sel).length >= MAXH){ flash('MAXIMUM ' + MAXH + ' CRÉNEAUX'); return; }
    if (occ(k) >= MAXP){ flash('CRÉNEAU COMPLET — ' + MAXP + ' PERSONNES'); return; }
    sel[k] = true;
  }
  c.classList.toggle('on', !!sel[k]);
  jauge();
  marquerSale();
}
function flash(t){
  msg('msg', t);
  clearTimeout(flash.t);
  flash.t = setTimeout(function(){ if ($('msg').textContent === t) marquerSale(true); }, 2400);
}
function cases(){
  each(document.querySelectorAll('#board .cl'), function(c){
    var k = c.dataset.k, o = occ(k);
    c.classList.toggle('on', !!sel[k]);
    c.classList.toggle('full', !sel[k] && o >= MAXP);
    c.querySelector('.cnt').textContent = o ? o : '';
  });
}
function jauge(){
  var n = cles(sel).length, g = $('gauge');
  g.innerHTML = '<b>' + (n * 6) + '</b> h — ' + n + ' / ' + MAXH + ' créneaux' + (n >= MAXH ? ' · MAX' : '');
  cases();
}
$('efface').addEventListener('click', function(){
  if (!ouverte || !cles(sel).length) return;
  sel = {}; jauge(); marquerSale();
});
function etatOuverture(){
  $('board').classList.toggle('ferme', !ouverte);
  $('save').disabled = !ouverte;
  $('ind').disabled = !ouverte;
  $('fermee').style.display = ouverte ? 'none' : 'block';
}

/* --------------------------------------------- modifications en cours */
function sale(){
  if ($('zone').style.display !== 'block') return false;
  return cles(sel).join() !== cles(saved).join() || $('ind').value.trim() !== indSaved.trim();
}
function marquerSale(effacerSinon){
  if (sale()) msg('msg', 'MODIFICATIONS NON ENREGISTRÉES');
  else if (effacerSinon) msg('msg', '');
}
$('ind').addEventListener('input', function(){ marquerSale(true); });
window.addEventListener('beforeunload', function(e){
  if (sale()){ e.preventDefault(); e.returnValue = ''; }
});

/* ---------------------------------------------------------- réseau état */
function rafraichirEtat(){
  var j = ++jEtat, s = iso(sem);
  return rpc('dispos_etat', { p_semaine: s }).then(function(r){
    if (j !== jEtat || s !== iso(sem)) return;
    reseau(null);
    compte = (r && r.compte) || {};
    repondu = {};
    ((r && r.repondu) || []).forEach(function(x){ repondu[x] = true; });
    if (r && typeof r.ouverte === 'boolean'){ ouverte = r.ouverte; etatOuverture(); }
    majNoms(); cases();
  }).catch(function(e){ if (j === jEtat) reseau(e); });
}

/* --------------------------------------------------------- enregistrer */
var ERREURS = {
  semaine: 'CETTE SEMAINE N\'EST PAS OUVERTE',
  creneau_invalide: 'CRÉNEAU INVALIDE — RECHARGE LA PAGE',
  trop_de_creneaux: 'MAXIMUM ' + MAXH + ' CRÉNEAUX',
  indispos_trop_long: 'INDISPONIBILITÉS TROP LONGUES (1000 CARACTÈRES MAX)'
};
function libelle(k){
  var p = String(k).split('-'), di = +p[0], s = null;
  SL.forEach(function(x){ if (x.i === p[1]) s = x; });
  return (AB[di] || '') + ' ' + ad(sem, di).getDate() + ' ' + (s ? s.l.toLowerCase() : '');
}

$('save').addEventListener('click', function(){
  if (!moi || !JETONS[moi] || !ouverte) return;
  var b = $('save'), s = iso(sem), slug = moi, tok = JETONS[slug];
  var slots = cles(sel), ind = $('ind').value.trim();
  b.disabled = true;
  msg('msg', 'ENREGISTREMENT…');
  $('fb').style.display = 'none';
  rpc('dispos_enregistrer', { p_semaine: s, p_jeton: tok, p_slots: slots, p_indispos: ind }).then(function(r){
    b.disabled = !ouverte;
    reseau(null);
    if (s !== iso(sem) || slug !== moi) return;
    if (r && r.ok){
      var avant = saved;
      saved = {}; slots.forEach(function(k){ saved[k] = true; });
      Object.keys(avant).forEach(function(k){ if (!saved[k] && compte[k]) compte[k]--; });
      slots.forEach(function(k){ if (!avant[k]) compte[k] = (compte[k] || 0) + 1; });
      indSaved = ind;
      repondu[slug] = true; majNoms();
      cases();
      msg('msg', 'ENREGISTRÉ — ' + r.heures + ' H', true);
      rafraichirEtat();
      if (ADM) rafraichirAdmin();
      return;
    }
    var e = r && r.erreur;
    if (e === 'jeton'){
      enAttente = { slug: slug, s: s, sel: sel, ind: $('ind').value };
      if (JETONS[slug] === tok){ delete JETONS[slug]; sauverJetons(); }
      montrerPin('SESSION EXPIRÉE — ENTRE TON CODE, TES MODIFICATIONS SONT GARDÉES');
      return;
    }
    if (e === 'complet'){
      var pris = (r.creneaux || []);
      pris.forEach(function(k){ delete sel[k]; });
      msg('msg', 'DÉJÀ COMPLET : ' + pris.map(libelle).join(', ').toUpperCase() + ' — RETIRÉ, RÉENREGISTRE');
      rafraichirEtat().then(jauge);
      return;
    }
    if (e === 'semaine'){ ouverte = false; etatOuverture(); }
    msg('msg', ERREURS[e] || 'ERREUR — RÉESSAIE');
  }).catch(function(err){
    b.disabled = !ouverte;
    reseau(err);
    msg('msg', texteErreur(err));
    $('fb').style.display = 'block';
  });
});

function texteDispos(){
  var t = 'DISPOS — ' + nomDe(moi) + ' — semaine du ' + fr(sem) + ' au ' + fr(ad(sem, 6)) + '\n\n';
  var n = 0;
  JR.forEach(function(j, di){
    var l = [];
    SL.forEach(function(s){ if (sel[di + '-' + s.i]){ l.push(s.l + ' (' + s.h + ')'); n++; } });
    if (l.length) t += j + ' ' + ad(sem, di).getDate() + ' : ' + l.join(', ') + '\n';
  });
  if (!n) t += 'Aucun créneau coché\n';
  var ind = $('ind').value.trim();
  t += '\nIndispos : ' + (ind || 'aucune') + '\nTotal : ' + (n * 6) + ' h';
  return t;
}

/* -------------------------------------------------------------- copier */
function copier(t, ok, ko){
  var manuel = function(){
    $('manuel-t').value = t;
    $('manuel').style.display = 'flex';
    setTimeout(function(){ var a = $('manuel-t'); try { a.focus(); a.select(); a.setSelectionRange(0, t.length); } catch(e){} }, 40);
    if (ko) ko();
  };
  var repli = function(){
    var a = document.createElement('textarea');
    a.value = t;
    a.style.cssText = 'position:fixed;top:0;left:0;width:1px;height:1px;opacity:0;font-size:16px';
    document.body.appendChild(a);
    var r = false;
    try { a.focus(); a.select(); a.setSelectionRange(0, t.length); r = document.execCommand('copy'); } catch(e){ r = false; }
    document.body.removeChild(a);
    if (r){ if (ok) ok(); } else manuel();
  };
  if (navigator.clipboard && navigator.clipboard.writeText){
    navigator.clipboard.writeText(t).then(function(){ if (ok) ok(); }, repli);
  } else repli();
}
$('manuel-x').addEventListener('click', function(){ $('manuel').style.display = 'none'; });
$('fbcp').addEventListener('click', function(){
  copier(texteDispos(), function(){ msg('fbm', 'COPIÉ — COLLE-LE À TITOUAN', true); }, function(){ msg('fbm', 'COPIE LE TEXTE AFFICHÉ'); });
});

/* --------------------------------------------------------------- admin */
function majCadenas(){
  var vis = !!ADM || location.hash === '#admin';
  $('lock').style.display = vis ? '' : 'none';
}
window.addEventListener('hashchange', majCadenas);

function setAdminUI(on){
  document.body.classList.toggle('admin', !!on);
  var l = $('lock'); l.classList.toggle('on', !!on); l.textContent = on ? 'Admin ✓' : 'Admin';
  libelleSemaine();
  if (!on){
    var cur = document.querySelector('.tab.on');
    if (cur && cur.classList.contains('ad')) ongletMoi();
  }
}
function setAdmin(tok, raison){
  ADM = tok || null;
  ecrire('sessionStorage', 'nxd_adm', ADM);
  if (!ADM){
    setAdminUI(false);
    viderAdmin();
    $('acode').value = '';
    if (raison){ $('gate').style.display = 'block'; msg('amsg', raison); }
  }
  majCadenas();
}

$('lock').addEventListener('click', function(){
  if (ADM){
    if (!window.confirm('Te déconnecter de l\'admin sur cet appareil ?')) return;
    var tok = ADM;
    setAdmin(null);
    rpc('dispos_deconnexion', { p_jeton: tok }).catch(function(){});
    return;
  }
  var g = $('gate'), ouvert = g.style.display !== 'none';
  g.style.display = ouvert ? 'none' : 'block';
  if (!ouvert){ var a = $('acode'); a.value = ''; a.disabled = false; msg('amsg', ''); setTimeout(function(){ try { a.focus(); } catch(e){} }, 30); }
});

$('acode').addEventListener('input', function(){
  var a = $('acode');
  var v = a.value.replace(/\D/g, '').slice(0, NADM);
  if (a.value !== v) a.value = v;
  if (v.length !== NADM) return;
  a.disabled = true;
  msg('amsg', 'VÉRIFICATION…');
  rpc('dispos_admin_connexion', { p_code: v }).then(function(r){
    reseau(null);
    a.disabled = false; a.value = '';
    if (r && r.ok && r.jeton){
      msg('amsg', 'OK', true);
      setAdmin(r.jeton);
      $('gate').style.display = 'none';
      rafraichirAdmin().then(function(){ if (estAdminVisible()) document.querySelector('.tab[data-p="env"]').click(); });
      return;
    }
    msg('amsg', r && r.erreur === 'bloque' ? 'TROP D\'ESSAIS — RÉESSAIE PLUS TARD' : 'CODE INCORRECT');
    a.classList.add('bad');
    setTimeout(function(){ a.classList.remove('bad'); try { a.focus(); } catch(e){} }, 520);
  }).catch(function(e){
    reseau(e);
    a.disabled = false; a.value = '';
    msg('amsg', texteErreur(e));
  });
});

function viderAdmin(){
  adm = null; envoisLocaux = {};
  $('st').innerHTML = '';
  $('tb').innerHTML = '<tr><td colspan="4"><div class="void">Chargement…</div></td></tr>';
  $('ms').innerHTML = '';
  $('eg').innerHTML = '';
  $('ek').textContent = '0'; $('etot').textContent = '0'; $('ebar').style.width = '0';
  $('rel').style.display = 'none';
  $('eqw').textContent = ''; $('envw').textContent = '';
  each(document.querySelectorAll('#cov .c'), function(c){ c.innerHTML = ''; c.classList.remove('has'); });
}

function rafraichirAdmin(){
  if (!ADM) return Promise.resolve();
  var j = ++jAdmin, s = iso(sem), tok = ADM;
  return rpc('dispos_admin', { p_jeton: tok, p_semaine: s }).then(function(r){
    if (j !== jAdmin || tok !== ADM || s !== iso(sem)) return;
    reseau(null);
    if (r && r.ok){
      adm = r; adm.sem = s;
      setAdminUI(true);
      rendreAdmin();
      return;
    }
    setAdmin(null, 'SESSION ADMIN TERMINÉE — ENTRE TON CODE');
  }).catch(function(e){ if (j === jAdmin) reseau(e); });
}

function couverture(){
  var w = $('cov'); w.innerHTML = '';
  var h = el('div', 'row hd');
  h.appendChild(el('div', 'dy'));
  JR.forEach(function(j, di){ h.appendChild(el('div', 'h', '<b>' + AB[di] + '</b><span>' + ad(sem, di).getDate() + '</span>')); });
  w.appendChild(h);
  SL.forEach(function(s){
    var r = el('div', 'row br');
    r.style.setProperty('--c', s.c); r.style.setProperty('--cr', s.r);
    r.appendChild(el('div', 'dy', '<b>' + s.l + '</b><span>' + s.h + '</span>'));
    JR.forEach(function(j, di){ var c = el('div', 'c'); c.id = 'cv-' + di + '-' + s.i; r.appendChild(c); });
    w.appendChild(r);
  });
}

function rendreAdmin(){
  if (!adm) return;
  var L = adm.reponses || [], C = adm.chatteurs || [], E = {}, R = {};
  (adm.envois || []).forEach(function(x){ E[x] = true; });
  Object.keys(envoisLocaux).forEach(function(x){ if (envoisLocaux[x]) E[x] = true; });
  L.forEach(function(r){ R[r.slug] = r; });
  var semCarte = adm.sem;
  var tranche = fr(sem) + ' → ' + fr(ad(sem, 6));

  var hh = 0, vides = 0;
  L.forEach(function(r){ hh += (r.heures || 0); });
  SL.forEach(function(s){ JR.forEach(function(j, di){
    var k = di + '-' + s.i, n = [];
    L.forEach(function(r){ if ((r.slots || []).indexOf(k) >= 0) n.push(esc(r.nom)); });
    if (!n.length) vides++;
    var e = $('cv-' + k);
    if (e){
      e.classList.toggle('has', n.length > 0);
      e.innerHTML = '<div class="cn' + (n.length ? '' : ' z') + '">' + n.length + '</div>' + (n.length ? '<div class="cw">' + n.join(', ') + '</div>' : '');
    }
  }); });
  $('eqw').innerHTML = 'Semaine <b>' + esc(tranche) + '</b>';
  $('st').innerHTML =
    '<div class="sc"><b>' + L.length + '/' + C.length + '</b><span>ont répondu</span></div>' +
    '<div class="sc"><b>' + hh + '</b><span>heures déclarées</span></div>' +
    '<div class="sc"><b>' + vides + '</b><span>créneaux vides</span></div>';
  $('tb').innerHTML = L.length ? L.map(function(r){
    var p = SL.map(function(s){
      var n = 0; JR.forEach(function(j, di){ if ((r.slots || []).indexOf(di + '-' + s.i) >= 0) n++; });
      return n ? '<span class="chip">' + s.l + ' ×' + n + '</span>' : '';
    }).filter(Boolean).join('');
    return '<tr><td class="n">' + esc(r.nom) + '</td><td class="h">' + (r.heures || 0) + ' h</td><td>' +
      (p || '<span class="chip">aucun</span>') + '</td><td class="' + (r.indispos ? 'ind' : 'ind no') + '">' +
      (r.indispos ? esc(r.indispos) : '—') + '</td></tr>';
  }).join('') : '<tr><td colspan="4"><div class="void">Aucune réponse pour cette semaine</div></td></tr>';
  var abs = C.filter(function(c){ return !R[c.slug]; });
  $('ms').innerHTML = abs.length ? abs.map(function(c){ return '<span>' + esc(c.nom) + '</span>'; }).join('')
    : '<span style="color:var(--ink)">Tout le monde a répondu</span>';

  $('envw').innerHTML = 'Semaine <b>' + esc(tranche) + '</b>';
  var g = $('eg'); g.innerHTML = '';
  C.forEach(function(c){
    var rep = !!R[c.slug], fait = !!E[c.slug];
    var card = el('div', 'ec' + (fait ? ' sent' : '') + (rep ? ' rep' : ''));
    card.innerHTML = '<div class="et"><span class="en">' + esc(c.nom) + '</span><span class="ep">' + esc(c.pin) + '</span></div>' +
      '<button type="button" class="eb">Copier le message</button>' +
      '<div class="es"><span class="' + (fait ? 'y' : '') + '">' + (fait ? 'Envoyé' : 'Pas envoyé') + '</span><span class="' + (rep ? 'y' : '') + '">' + (rep ? 'A rempli' : 'N\'a pas rempli') + '</span></div>';
    var b = card.querySelector('.eb');
    b.addEventListener('click', function(){
      copier(messageDM(c.nom, c.pin), function(){
        b.textContent = 'Copié ✓'; b.classList.add('ok');
        envoisLocaux[c.slug] = true;
        card.classList.add('sent');
        majCompteurEnvoi(C);
        rpc('dispos_envoi', { p_jeton: ADM, p_semaine: semCarte, p_slug: c.slug, p_fait: true }).then(function(r){
          if (r && r.ok) return;
          delete envoisLocaux[c.slug];
          card.classList.remove('sent'); majCompteurEnvoi(C);
          b.classList.remove('ok'); b.textContent = 'Copié, NON noté — réessaie';
          if (r && r.erreur === 'jeton') setAdmin(null, 'SESSION ADMIN TERMINÉE — ENTRE TON CODE');
        }, function(e){
          delete envoisLocaux[c.slug];
          card.classList.remove('sent'); majCompteurEnvoi(C);
          reseau(e); b.classList.remove('ok'); b.textContent = 'Copié, NON noté — réessaie';
        });
      }, function(){ b.textContent = 'Copie le texte affiché'; });
    });
    g.appendChild(card);
  });
  majCompteurEnvoi(C);
  $('relc').textContent = abs.length;
  $('reln').textContent = abs.map(function(c){ return c.nom; }).join(' · ');
  $('rel').style.display = abs.length ? 'block' : 'none';
}
function majCompteurEnvoi(C){
  var E = {};
  ((adm && adm.envois) || []).forEach(function(x){ E[x] = true; });
  Object.keys(envoisLocaux).forEach(function(x){ if (envoisLocaux[x]) E[x] = true; });
  var n = C.filter(function(c){ return E[c.slug]; }).length;
  $('ek').textContent = n; $('etot').textContent = C.length;
  $('ebar').style.width = (C.length ? n / C.length * 100 : 0) + '%';
}

function messageDM(nom, pin){
  return 'Salut ' + nom + ' 👋\n\nÀ partir de maintenant tu déclares tes dispos ici :\n' + LIEN +
    '\n\nTon code perso : ' + pin + '\nIl est à toi, tu ne le partages pas. Tu ne le tapes qu\'une fois, ton téléphone s\'en souvient ensuite.\n\n' +
    'Comment ça marche : tu cliques sur ton prénom, tu entres le code, tu coches les créneaux où tu peux bosser, tu enregistres. Aucun compte à créer, et la page s\'ouvre directement sur la semaine à venir.\n\n' +
    'Les créneaux : nuit 02h-08h, matin 08h-14h, après-midi 14h-20h, soir 20h-02h.\n' +
    'Maximum ' + MAXH + ' créneaux par semaine, et ' + MAXP + ' personnes maximum par créneau. Premier arrivé, premier servi.\n\n' +
    'Il y a une case en bas pour tes indisponibilités : un jour à éviter, un empêchement, une contrainte d\'horaire. Écris-le, ça évite les allers-retours.\n\n' +
    '⚠️ À remplir avant dimanche 20h pour la semaine suivante. Sans ta réponse, je ne peux pas te mettre au planning.';
}

$('relcp').addEventListener('click', function(){
  if (!adm || adm.sem !== iso(sem)) return;
  var R = {}; (adm.reponses || []).forEach(function(r){ R[r.slug] = 1; });
  var abs = (adm.chatteurs || []).filter(function(c){ return !R[c.slug]; }).map(function(c){ return c.nom; });
  var t = '⏰ Rappel dispos · semaine du ' + fr(sem) + ' au ' + fr(ad(sem, 6)) + '\n\nIl manque encore : ' + abs.join(', ') +
    '\n\nC\'est ici, avec le code que je vous ai envoyé en privé :\n' + LIEN +
    '\n\nÀ remplir avant dimanche 20h. Sans réponse, pas de planning.';
  copier(t, function(){ msg('relm', 'COPIÉ', true); setTimeout(function(){ msg('relm', ''); }, 1800); }, function(){ msg('relm', 'COPIE LE TEXTE AFFICHÉ'); });
});
$('ereset').addEventListener('click', function(){
  if (!ADM || !adm || adm.sem !== iso(sem)) return;
  if (!window.confirm('Remettre tous les « envoyé » de cette semaine à zéro ?')) return;
  rpc('dispos_envois_reset', { p_jeton: ADM, p_semaine: adm.sem }).then(function(r){
    if (r && r.ok){ envoisLocaux = {}; return rafraichirAdmin(); }
    setAdmin(null, 'SESSION ADMIN TERMINÉE — ENTRE TON CODE');
  }, function(e){ reseau(e); });
});
$('cp').addEventListener('click', function(){
  if (!adm || adm.sem !== iso(sem)) return;
  var L = adm.reponses || [], C = adm.chatteurs || [];
  var t = 'DISPOS CHATTEURS — ' + fr(sem) + ' au ' + fr(ad(sem, 6)) + '\n\n';
  JR.forEach(function(j, di){
    t += j.toUpperCase() + ' ' + ad(sem, di).getDate() + '\n';
    SL.forEach(function(s){
      var n = []; L.forEach(function(r){ if ((r.slots || []).indexOf(di + '-' + s.i) >= 0) n.push(r.nom); });
      t += '  ' + s.l + ' (' + s.h + ') : ' + (n.length ? n.join(', ') : 'PERSONNE') + '\n';
    });
    t += '\n';
  });
  var id = L.filter(function(r){ return r.indispos; });
  if (id.length){ t += 'INDISPONIBILITÉS\n'; id.forEach(function(r){ t += '  ' + r.nom + ' : ' + r.indispos + '\n'; }); t += '\n'; }
  var R = {}; L.forEach(function(r){ R[r.slug] = 1; });
  var abs = C.filter(function(c){ return !R[c.slug]; }).map(function(c){ return c.nom; });
  if (abs.length) t += 'PAS RÉPONDU : ' + abs.join(', ') + '\n';
  copier(t, function(){ msg('cmsg', 'COPIÉ', true); }, function(){ msg('cmsg', 'COPIE LE TEXTE AFFICHÉ'); });
});

/* ----------------------------------------------------------- démarrage */
$('maxh').textContent = MAXH;
$('maxp').textContent = MAXP;
majCadenas();
setAdminUI(false);
libelleSemaine();
grille(); couverture(); jauge(); viderAdmin();
rafraichirEtat();
chargerListe();
if (ADM) rafraichirAdmin();

setInterval(function(){
  if (document.hidden) return;
  if (!GENS.length){ chargerListe(); return; }
  rafraichirEtat();
  var t = document.querySelector('.tab.on');
  if (ADM && t && t.dataset.p !== 'moi') rafraichirAdmin();
}, 20000);
document.addEventListener('visibilitychange', function(){
  if (document.hidden) return;
  var n = lun(new Date());
  if (n.getTime() !== aujourdhui.getTime()){ aujourdhui = n; libelleSemaine(); }
  rafraichirEtat();
  if (ADM) rafraichirAdmin();
});

})();
