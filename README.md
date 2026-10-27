# Metro Games by Kliquestart

The home of Metro Games: quick, free browser games, live at **https://www.kliquestart.com**.

## Site map
| URL | File | What it is |
|---|---|---|
| `/` | `index.html` | Home page, listing every game as a stop on the metro line |
| `/games/agla-station/play/` | `games/agla-station/play/index.html` | Agla Station (Metros of India): Delhi first, 3 stations so far |
| `/games/red-view/` | `games/red-view/index.html` | Red View landing page (SEO text, FAQ, Play button) |
| `/games/red-view/play/` | `games/red-view/play/index.html` | The game itself, full screen |
| `/about.html` | `about.html` | About page |
| `/privacy.html` | `privacy.html` | Privacy policy (required by AdSense) |

Other files: `sitemap.xml`, `robots.txt`, `CNAME` (custom domain for GitHub Pages), `site.webmanifest`, `404.html`, and `assets/` (styles, icons, social preview image).

## Going live (one-time setup)
Hosting is GitHub Pages. It's free and deploys from the `main` branch.

1. **Merge the PR into `main`.**
2. **Turn on Pages:** go to Settings → Pages → Build and deployment. Set Source to *Deploy from a branch*, then pick Branch `main` and folder `/ (root)`, and save.
3. **Custom domain:** on the same page, the domain should show `www.kliquestart.com` (read from the `CNAME` file). Type it in and save if it's empty.
4. **DNS at your domain registrar:**
   | Type | Host / Name | Value |
   |---|---|---|
   | CNAME | `www` | `theopinioncut.github.io` |
   | A | `@` | `185.199.108.153` |
   | A | `@` | `185.199.109.153` |
   | A | `@` | `185.199.110.153` |
   | A | `@` | `185.199.111.153` |

   Delete any existing A or CNAME records for `@` and `www` first, such as a registrar "parking" page.
5. Once the DNS check passes, tick **Enforce HTTPS**. DNS can take from 10 minutes to a few hours.

After that, every merge into `main` updates the live site in about a minute.

## After launch
- **Google Search Console:** add `www.kliquestart.com`, verify it, and submit `https://www.kliquestart.com/sitemap.xml`.
- **Analytics:** paste the Google Analytics snippet where each page says `<!-- ANALYTICS -->`.
- **Ads:** apply for Google AdSense. Once approved, paste their script where each page says `<!-- ADS -->`, add an `ads.txt` file at the root, and turn on the hidden `.ad-slot` blocks.

## Adding a game
1. Put the game in `games/<name>/play/index.html` and write a landing page at `games/<name>/index.html` (copy Red View's).
2. Add a station card on the home page, update the game count, and add the new URLs to `sitemap.xml`.

## Offline / slow internet
- `sw.js` (service worker) saves the site on the phone after the first visit. Pages try the network for up to 3 seconds, then fall back to the saved copy; files load from the saved copy instantly.
- Fonts are self-hosted in `assets/fonts/` (no Google Fonts request).
- When you add or rename a file that should work offline, add it to `CORE` in `sw.js` and bump `VERSION`.

## Adding your songs (Kliquestart Metro Mix)
1. Export each song as `.mp3` (aim for under 4 MB each so it loads on metro internet).
2. Put the files in `assets/music/` (e.g. `assets/music/dilli-nights.mp3`).
3. List them in `assets/music/tracks.json`:
   ```json
   { "tracks": [
     { "title": "Dilli Nights", "artist": "Kliquestart", "file": "dilli-nights.mp3" }
   ] }
   ```
While the list is empty, the game plays its built-in **Metro Beat** (generated in the browser, no download).
Only add songs you own or have a licence for commercial use.
