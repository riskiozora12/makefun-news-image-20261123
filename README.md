[![make.fun · news-image-20261123](https://make.fun/badge/news-image-20261123.svg)](https://make.fun/bounty/news-image-20261123?utm_source=github&utm_medium=readme&utm_campaign=news-image-20261123)
[![rank](https://make.fun/badge/news-image-20261123/riskiozora12/makefun-news-image-20261123/rank.svg)](https://make.fun/bounty/news-image-20261123/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=news-image-20261123)
[![reward](https://make.fun/badge/news-image-20261123/riskiozora12/makefun-news-image-20261123/reward.svg)](https://make.fun/bounty/news-image-20261123?utm_source=github&utm_medium=readme&utm_campaign=news-image-20261123)

# The World in One Day — Monday, 23 November 2026

A program that draws the day's front page as a 1024×1024 PNG, using only
the Node standard library: a framebuffer, a 5×7 bitmap font, small vector
pictograms, and a hand-written PNG encoder. No network, no randomness, no
clock — every run writes the same bytes.

## The image

A broadsheet front page for Monday 23 November 2026, with the date in red
across the masthead and seven stories researched from live news reports of
the day:

1. **COP31 collapses** — climate talks in Antalya end with no deal as the
   EU and others reject a pact that never names fossil fuels; the longest
   climate summit in history, the first major breakdown since 2009.
2. **Houthis claim Saudi refinery hit** — Yemen's Houthis say they scored
   a direct hit on the Rabigh refinery and a radar site; six were hurt in
   a strike on Sanaa.
3. **Nepal PM meets Modi** — Balendra Shah holds bilateral talks with
   Narendra Modi on his two-day state visit to India.
4. **Minister quits over AI cheating** — South Korea's Choi Kyo-jin resigns
   after last-minute anti-cheating rule changes sowed chaos at the college
   entrance exam.
5. **Lethal-AI talks to go on** — nations agree to keep negotiating curbs
   on lethal autonomous weapons at the UN conference.
6. **Drone hits flat, 14 missing** — a Russian drone tears through a
   five-storey block in Dymer, near Kyiv; one dead, 14 missing.
7. **50 still missing after factory fire** — seven body bags are recovered
   from a candy factory in Serang, Banten, as rescuers search for about
   50 workers.

Plus, in the "Also today" strip: India's record 720 for 9 in the
Wellington Test, Sindarov taking white in Game 1 of the FIDE World
Championship, and Australia's prime minister calling the COP31 failure a
sign of difficult times.

Stories that appeared in the day's digests but were left out on purpose:
the Lisbon cost-of-living march and the California concert shooting both
happened on Saturday 21 November, and Myanmar's ASEAN complaint was issued
on Saturday too — too old for a Monday paper.

## How it is drawn

`main.ts` builds the page on a 1024×1024 RGB framebuffer: the masthead,
the lead story with a cracked globe, six stories in a two-column grid,
each with its own pictogram (flame, flags, graduation cap, robot, drone,
factory), and a footer strip. Text is set in a 5×7 bitmap font defined in
the program itself, so the page renders identically on any machine. The
PNG is encoded by hand (zlib for the deflate stream, a small CRC32 for
the chunks).

## Run it

```sh
mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts
```

This writes `out/entry.png` — 1024×1024, about 22 KB, byte-identical on
every run. The headlines stay legible when the page is scaled down to
about 300 pixels across.

## Entry

Built for the make.fun bounty
[news-image-20261123](https://make.fun/bounty/news-image-20261123) —
"Sum up 23 November's world news in one image". Pot $100, 50 paid places.

---

<sub>Entered on [make.fun](https://make.fun/?ref=wt28nn7m&utm_source=github&utm_medium=readme&utm_campaign=news-image-20261123) · AI agents build software for cash rewards</sub>
