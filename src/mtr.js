'use strict';

const cheerio = require('cheerio');

const BASE = 'https://www.mtr.sk';
const VIDEO_BASE = 'https://mtr.ruzomberok.sk/videoarchiv/';
const UA = 'Mozilla/5.0';

const ARCHIVE_TTL = 60 * 60 * 1000; // 1 h
const FILE_TTL = 6 * 60 * 60 * 1000; // 6 h
const RSS_TTL = 15 * 60 * 1000; // 15 min

const cache = new Map();

function cached(key, ttl, fn) {
  const hit = cache.get(key);
  if (hit && hit.expires > Date.now()) return hit.value;
  // ukladáme promise -> súbežné požiadavky sa zlúčia do jedného requestu
  const value = Promise.resolve()
    .then(fn)
    .catch((err) => {
      cache.delete(key);
      throw err;
    });
  cache.set(key, { value, expires: Date.now() + ttl });
  return value;
}

async function get(url) {
  const res = await fetch(url, {
    headers: { 'User-Agent': UA },
    signal: AbortSignal.timeout(15000),
  });
  if (!res.ok) throw new Error(`GET ${url} -> ${res.status}`);
  return res.text();
}

async function post(url, params) {
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'User-Agent': UA,
      'Content-Type': 'application/x-www-form-urlencoded',
      Referer: `${BASE}/videoarchiv/`,
    },
    body: new URLSearchParams(params).toString(),
    signal: AbortSignal.timeout(15000),
  });
  if (!res.ok) throw new Error(`POST ${url} -> ${res.status}`);
  return res.text();
}

/**
 * Celý archív je v jedinej stránke ako sada <select id="...">.
 * Vráti { selectId: [{ value, label }, ...] } bez prvej (placeholder) option.
 */
function getArchive() {
  return cached('archive', ARCHIVE_TTL, async () => {
    const $ = cheerio.load(await get(`${BASE}/videoarchiv/`));
    const selects = {};
    $('select[id]').each((_, el) => {
      const options = $(el)
        .find('option')
        .map((__, o) => ({
          value: ($(o).attr('value') || '').trim(),
          label: $(o).text().trim(),
        }))
        .get()
        .slice(1);
      selects[$(el).attr('id')] = options;
    });
    if (!selects.relacie) throw new Error('na /videoarchiv/ chýba select#relacie');
    return selects;
  });
}

// hodnota v select#relacie je krátke číslo -> názov selectu s termínmi
function selectIdFor(value) {
  return value.length < 3 ? `termin${value}` : value;
}

async function listRelacie() {
  const selects = await getArchive();
  return selects.relacie
    .filter((o) => o.value && /[\p{L}\p{N}]/u.test(o.label)) // preskoč oddeľovače typu "-------"
    .map((o) => ({ id: selectIdFor(o.value), name: o.label }));
}

/**
 * Položky jednej relácie. Hodnota option je buď ":123" (jedno video),
 * ":123:124:125" (viac príspevkov pod jedným dátumom), alebo odkaz
 * na ďalší select - ten zaradíme rovno do zoznamu.
 */
async function listEpisodes(selectId) {
  const selects = await getArchive();
  const out = [];
  const visited = new Set();

  const walk = (id) => {
    if (visited.has(id) || !selects[id]) return;
    visited.add(id);
    for (const opt of selects[id]) {
      if (!opt.value) continue;
      if (opt.value.startsWith(':')) {
        out.push({ ids: opt.value.slice(1).split(':').filter(Boolean), label: opt.label });
      } else {
        walk(selectIdFor(opt.value));
      }
    }
  };

  walk(selectId);
  return out;
}

/** playlist.php vráti názov súboru v úvodzovkách. */
function resolveFile(videoId) {
  return cached(`file:${videoId}`, FILE_TTL, async () => {
    const body = await post(`${BASE}/forms/playlist.php`, { video: videoId });
    const name = body.trim().replace(/^["']|["']$/g, '').trim();
    if (!name || name.includes('<')) {
      throw new Error(`playlist.php nevrátilo súbor pre video ${videoId}`);
    }
    return encodeURI(VIDEO_BASE + name);
  });
}

/**
 * Názvy jednotlivých príspevkov pre viacdielnu položku.
 * Odpoveď má tvar <div class="check"><label>názov</label><input value="ID"></div>,
 * takže názvy párujeme priamo na ID, nie na poradie.
 * Vráti { videoId: názov }.
 */
async function partTitles(ids) {
  const html = await post(`${BASE}/forms/video_new.php`, { temp_array: `:${ids.join(':')}` });
  const $ = cheerio.load(html);
  const titles = {};

  $('div.check').each((_, el) => {
    const id = $(el).find('input[type="checkbox"]').attr('value');
    const title = $(el).find('label').text().trim();
    if (id && title) titles[id] = title;
  });

  // záloha: to, čo hľadal pôvodný Kodi doplnok - už len podľa poradia
  if (!Object.keys(titles).length) {
    [...html.matchAll(/background-size:\s*53px;">([^<]+)</g)].forEach((m, i) => {
      if (ids[i]) titles[ids[i]] = m[1].trim();
    });
  }

  return titles;
}

function thumbnail(videoId) {
  return `${BASE}/video/${videoId}_big.jpg`;
}

/**
 * RSS feed s najnovšími príspevkami. Obsahuje priame URL videí,
 * takže nepotrebuje ani jeden POST. Živé kamery (Panoráma RK, Kostol RK)
 * odfiltrujeme podľa toho, že ich <link> nevedie do /videoarchiv/.
 */
function getRss() {
  return cached('rss', RSS_TTL, async () => {
    const xml = await get(`${BASE}/rss/`);
    const $ = cheerio.load(xml, { xmlMode: true });

    // media:content / media:thumbnail sú v inom namespace
    const mediaUrl = (el, tag) => {
      let url = $(el).find(`media\\:${tag}`).attr('url');
      if (!url) {
        $(el).children().each((_, child) => {
          if (!url && (child.name || '').split(':').pop() === tag) {
            url = child.attribs && child.attribs.url;
          }
        });
      }
      return url || '';
    };

    const items = [];
    $('item').each((_, el) => {
      const $el = $(el);
      // položky nemajú <link>, adresa je v <guid> (pri živých kamerách prázdny)
      const link = ($el.find('link').text().trim() || $el.find('guid').text().trim());
      const url = mediaUrl(el, 'content');
      if (!url || !link.includes('/videoarchiv/')) return; // preskoč živé kamery

      const slug = link.replace(/\/+$/, '').split('/').pop();
      const date = slug.match(/^(\d{4})-(\d{2})-(\d{2})/);

      items.push({
        slug,
        url,
        title: $el.find('title').text().trim(),
        description: $el.find('description').text().trim(),
        category: $el.find('category').last().text().trim(),
        thumbnail: mediaUrl(el, 'thumbnail'),
        released: date
          ? new Date(Date.UTC(+date[1], +date[2] - 1, +date[3])).toISOString()
          : undefined,
      });
    });

    return items;
  });
}

module.exports = { listRelacie, listEpisodes, resolveFile, partTitles, thumbnail, getRss, BASE };
