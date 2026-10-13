# Kliquestart Metro Games

The home of Metro Games: quick, free browser games, live at **https://www.kliquestart.com**.

## Site map
| URL | File | What it is |
|---|---|---|
| `/` | `index.html` | Home page, listing every game as a stop on the metro line |
| `/games/red-view/` | `games/red-view/index.html` | Red View landing page (SEO text, FAQ, Play button) |
| `/games/red-view/play/` | `games/red-view/play/index.html` | The game itself, full screen |
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
- **Privacy page:** add a contact email to `privacy.html`.

## Adding a game
1. Put the game in `games/<name>/play/index.html` and write a landing page at `games/<name>/index.html` (copy Red View's).
2. Add a station card on the home page, update the game count, and add the new URLs to `sitemap.xml`.
