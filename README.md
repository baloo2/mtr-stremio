# MTR Stremio addon

Stremio addon for the video archive of [Mestská televízia Ružomberok](https://www.mtr.sk),
a municipal TV station in Slovakia. Ported from the Kodi addon `plugin.video.mtr.sk`
(v1.2.0, Libor Zoubek / jastrab) to the Stremio protocol.

Two catalogs:

- **MTR – Archív** (`series`) – each show is a series, each broadcast date an
  episode. Dates with multiple segments (typically the news) expose them as
  several streams on a single episode. The episode list is flat, newest first.
- **MTR – Najnovšie** (`movie`) – latest items from the RSS feed.

Live TV is intentionally out of scope. The live cameras present in the RSS feed (Panoráma RK, Kostol RK) are filtered out.

## How it works

The archive is cached for an hour, resolved video URLs for 6 hours, RSS for 15 minutes.

## Environment variables

| variable | default | meaning |
| --- | --- | --- |
| `PORT` | `7000` | HTTP server port |
| `LOG_REQUESTS` | off | `1` / `true` / `yes` enables request logging |

## Running locally

```bash
npm install
npm start
# http://127.0.0.1:7000/manifest.json
```

In the desktop app, paste `http://127.0.0.1:7000/manifest.json`.
Stremio Web requires HTTPS.

## Docker

```bash
docker run -d --name mtr-stremio -p 7000:7000 ghcr.io/baloo2/mtr-stremio:latest
```

The image is built by GitHub Actions (`.github/workflows/docker.yml`).

`docker-compose.yml` contains an example.

## License

GPL-2.0-or-later. The scraping logic derives from the original Kodi addon, which
is GPL-2.0, so this addon is a derivative work under the same license.