# Vesti

Serbian news without the portals: headlines from N1, Nova, Danas, B92, Politika, Blic and Forbes Srbija, with the same story merged across outlets and a clean reader view. It runs on GitHub Actions and GitHub Pages, with no server and no cost.

## How it works

Every 30 minutes, `.github/workflows/update.yml`:

1. Reads every file in `sources/` and fetches the feeds. If a configured feed fails, it autodiscovers one from the homepage, then tries common feed paths, then pulls article links from the homepage.
2. Downloads each new article and extracts the text with Mozilla Readability (the Firefox Reader View engine), keeping only a strict whitelist of HTML tags.
3. Groups duplicate stories. Titles, URL slugs and leads are transliterated (Cyrillic to Latin), folded and stemmed, then compared with TF-IDF. Two items merge only if they also share a proper name or a number.
4. Encrypts everything with AES-256-GCM, using a key derived from the `NEWS_KEY` secret, and deploys to Pages. The site is public, but the content is not readable without the password.

State between runs (article cache, salt) lives in the Actions cache rather than in git, so the repo history stays clean.

## Setup (once)

1. Push this repo to GitHub. It must be public for free Pages and Actions.
2. **Settings → Secrets and variables → Actions → New repository secret**: name it `NEWS_KEY` and give it a long password.
3. **Settings → Pages → Source: GitHub Actions**.
4. **Actions → update → Run workflow**. When it finishes, open `https://alecfleurs.github.io/vesti/` on your phone, enter the password, and choose **Add to Home screen**.

## Adding a source

From the app: **Podešavanja → Dodaj izvor**. Enter a name and the homepage URL, then tap **Commit changes** on GitHub. You can also add a file to `sources/` by hand:

```json
{
  "name": "RTS",
  "home": "https://www.rts.rs/",
  "feeds": [],
  "exclude": ["/sport/"],
  "color": "#1e88e5"
}
```

- `feeds` is optional. Leave it empty to use autodiscovery.
- `exclude` is a list of regexes matched against article URLs.
- `"enabled": false` turns a source off without deleting it.

Settings shows each source's status: green means RSS, amber means autodiscovered or scraped, red means failing.

## Tuning

`config.json`:

- `exclude`: URL patterns dropped from every source. The default list removes showbiz, horoscopes, reality TV and lifestyle. Add `"/sport/"` to drop sport.
- `cluster.threshold`: higher means fewer merges. `npm test` checks the clustering against real headlines.
- `retainHours`: how long stories are kept (default 72).

## Limits

- Paywalled, video-only and bot-blocking pages show the lead plus a link to the original.
- GitHub pauses scheduled workflows after 60 days with no repo activity. Re-enable the workflow in the Actions tab, or push any commit.
- Politika's robots.txt disallows automated access to its RSS path. Set `"enabled": false` in `sources/politika.json` if that matters to you.
