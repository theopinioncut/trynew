# Red View

A casual metro-runner for 30–45 minute sessions. You play a packet of **red data** racing down a tunnel. Run through **blue save gates** to turn it blue (saved) before you crash.

**Play:** open `index.html` in any browser, on desktop or phone. It has no build step and no dependencies.

## The core idea
- **Red = data.** Collect red bits as you run. Until you save, they are at risk.
- **Blue = saved.** Each level has 3 blue save gates plus a final save. Crossing one turns your red data blue for good.
- **Crash** and you lose your unsaved red data plus 1 of 3 integrity bars, then restart from the last blue gate.
- **Stars:** finishing gives 1 star, saving 60% of the level's data gives 2, and 85% gives 3.

## 10 tech eras, 30 levels (~37 min of runtime, plus retries)
| Era | Year | New mechanic |
|---|---|---|
| Punch Card | 1890 | Switch lanes to dodge |
| Floppy Disk | 1971 | Low barriers: jump |
| CD-ROM | 1985 | High bars: slide |
| Hard Drive | 1995 | Read heads sweep across lanes |
| USB Flash | 2000 | Boost pads: smash through anything |
| LAN | 2003 | Cable runs block a lane for a long stretch |
| Wi-Fi | 2009 | Blinking blocks that only hurt when solid |
| Cloud | 2014 | Fog cuts how far ahead you can see |
| Blockchain | 2019 | Dense rows |
| Quantum | 2030 | Glitch blocks jump lanes as you get close |

Power-ups: **Backup shield** (absorbs one hit) and **Data magnet** (pulls in nearby bits).

## Controls
- **Phone:** swipe left/right to change lane, swipe up or tap to jump, swipe down to slide
- **Keyboard:** ← → / A D to change lane, ↑ / W / Space to jump, ↓ / S to slide, P to pause

Levels are generated from a fixed seed, so every player gets the same layout and scores are comparable. Progress is saved in the browser's localStorage.
