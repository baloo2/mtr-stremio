'use strict';

const { addonBuilder } = require('stremio-addon-sdk');
const mtr = require('./mtr');

const PREFIX = 'mtrsk:';
const RSS_PREFIX = 'mtrsk:rss:';
const LOGO = 'https://www.mtr.sk/img/logo-mtr-0.png';

const CACHE = { cacheMaxAge: 3600, staleRevalidate: 3600, staleError: 86400 };
const RSS_CACHE = { cacheMaxAge: 900, staleRevalidate: 900, staleError: 86400 };

const manifest = {
  id: 'sk.mtr.videoarchiv',
  version: '1.0.0',
  name: 'MTR – Mestská TV Ružomberok',
  description: 'Videoarchív Mestskej televízie Ružomberok. Relácie sú seriály, dátumy vysielania epizódy.',
  logo: LOGO,
  resources: ['catalog', 'meta', 'stream'],
  types: ['series', 'movie'],
  idPrefixes: [PREFIX],
  catalogs: [
    {
      type: 'series',
      id: 'mtr-relacie',
      name: 'MTR – Archív',
      extra: [{ name: 'skip', isRequired: false }],
    },
    {
      type: 'movie',
      id: 'mtr-najnovsie',
      name: 'MTR – Najnovšie',
    },
  ],
  behaviorHints: { configurable: false },
};

const builder = new addonBuilder(manifest);

/** "27. 07. 2026 (LETNÝ ARCHÍV 2)" -> { year, month, day } */
function parseDate(label) {
  const m = label.match(/^(\d{1,2})\.\s*(\d{1,2})\.\s*(\d{4})/);
  if (!m) return null;
  const [day, month, year] = [Number(m[1]), Number(m[2]), Number(m[3])];
  if (year < 1990 || month < 1 || month > 12 || day < 1 || day > 31) return null;
  return { year, month, day };
}

builder.defineCatalogHandler(async ({ id, extra = {} }) => {
  if (id === 'mtr-najnovsie') {
    const items = await mtr.getRss();
    return {
      metas: items.map((it) => ({
        id: RSS_PREFIX + it.slug,
        type: 'movie',
        name: it.title,
        poster: it.thumbnail || LOGO,
        posterShape: 'landscape',
        description: it.description || undefined,
        released: it.released,
      })),
      ...RSS_CACHE,
    };
  }

  if (id !== 'mtr-relacie') return { metas: [] };

  let relacie = await mtr.listRelacie();

  const skip = Number(extra.skip) || 0;
  if (skip) relacie = relacie.slice(skip);

  return {
    metas: relacie.map((r) => ({
      id: PREFIX + r.id,
      type: 'series',
      name: r.name,
      poster: LOGO,
      posterShape: 'square',
    })),
    ...CACHE,
  };
});

builder.defineMetaHandler(async ({ id }) => {
  if (id.startsWith(RSS_PREFIX)) {
    const slug = id.slice(RSS_PREFIX.length);
    const item = (await mtr.getRss()).find((i) => i.slug === slug);
    if (!item) return { meta: null };

    return {
      meta: {
        id,
        type: 'movie',
        name: item.title,
        poster: item.thumbnail || LOGO,
        posterShape: 'landscape',
        background: item.thumbnail || undefined,
        logo: LOGO,
        description: item.description || undefined,
        released: item.released,
        genres: item.category ? [item.category] : undefined,
      },
      ...RSS_CACHE,
    };
  }

  const selectId = id.slice(PREFIX.length);
  const [relacie, episodes] = await Promise.all([mtr.listRelacie(), mtr.listEpisodes(selectId)]);
  const relacia = relacie.find((r) => r.id === selectId);

  const videos = episodes.map((ep, i) => {
    const d = parseDate(ep.label);
    const suffix = ep.ids.length > 1 ? ` (${ep.ids.length} príspevkov)` : '';
    return {
      id: `${PREFIX}${selectId}:${ep.ids.join('-')}`,
      title: ep.label + suffix,
      // plochý zoznam ako v Kodi: žiadne sezóny podľa rokov,
      // poradie zo stránky je od najnovšieho -> najnovšia epizóda má číslo 1
      season: 1,
      episode: i + 1,
      released: d ? new Date(Date.UTC(d.year, d.month - 1, d.day)).toISOString() : undefined,
      thumbnail: mtr.thumbnail(ep.ids[0]),
    };
  });

  return {
    meta: {
      id,
      type: 'series',
      name: relacia ? relacia.name : 'MTR',
      poster: LOGO,
      posterShape: 'square',
      logo: LOGO,
      description: 'Archív Mestskej televízie Ružomberok',
      videos,
    },
    ...CACHE,
  };
});

builder.defineStreamHandler(async ({ id }) => {
  if (id.startsWith(RSS_PREFIX)) {
    const slug = id.slice(RSS_PREFIX.length);
    const item = (await mtr.getRss()).find((i) => i.slug === slug);
    if (!item) return { streams: [] };
    // RSS má priamu URL, resolveFile() netreba
    return { streams: [{ name: 'Najnovšie', title: 'Prehrať', url: item.url }], ...RSS_CACHE };
  }

  const parts = id.slice(PREFIX.length).split(':');
  const ids = (parts[1] || '').split('-').filter(Boolean);
  if (!ids.length) return { streams: [] };

  // jedno video -> jeden stream, bez zbytočného POSTu na názvy
  if (ids.length === 1) {
    return { streams: [{ name: 'Archív', title: 'Prehrať', url: await mtr.resolveFile(ids[0]) }], ...CACHE };
  }

  const titles = await mtr.partTitles(ids).catch(() => ({}));
  const resolved = await Promise.all(
    ids.map((vid, i) =>
      mtr
        .resolveFile(vid)
        .then((url) => ({ name: 'Archív', title: titles[vid] || `Príspevok ${i + 1}`, url }))
        .catch(() => null)
    )
  );

  return { streams: resolved.filter(Boolean), ...CACHE };
});

module.exports = builder.getInterface();
