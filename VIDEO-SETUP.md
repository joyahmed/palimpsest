# Setup - do this BEFORE you open the script

## Before recording

1. Open the terminal. Big font (18pt+). Dark background.
2. Run these:
   ```
   cd ~/projects/hackathon/palimpsest
   export PALIMPSEST_CACHE_ONLY=1
   clear
   ```
   This makes `pnpm explain` and `pnpm bench` replay instantly from cache. No network calls.
   Nothing can hang or fail while you are recording.
3. Open Chrome at `palimpsest.zettabyteincorp.com`. Press `Ctrl + Shift + R` to hard refresh.

4. **REHEARSE THE DEMO ONCE. This is the most important step.**

   Type the exact sentence from the script into the box and click Remember:
   ```
   We ripped SQLite out this morning. Meridian runs on DuckDB now.
   ```
   The first time, it takes **30-50 seconds** - it is really calling Qwen. Let it finish.

   Then click **reset** (bottom right of the box). The memory goes back to its seeded state,
   but the model's answers stay cached on the server.

   **Now the same demo runs in under a second on camera.** The kill is completely real - the
   store is genuinely back to believing SQLite, and it genuinely kills that belief. Only the
   model calls are cached, exactly like the benchmark.

   If you skip this step you will sit in 45 seconds of silence on camera.

5. Leave the page on the "Facts that changed" tab.
4. Open `VIDEO-SCRIPT.md` **on your phone**. You will read from it. The recording only captures
   your screen, so nobody sees you reading.
5. Start recording the whole screen: `Win + G`, or OBS.

## After recording

1. Upload the raw file straight to YouTube.
2. Use **YouTube's own trim tool** to cut the dead air off the start and end. That is the only
   edit. You do not need Premiere or Clipchamp.
3. Set visibility to **Public**. Not unlisted - judges must be able to watch it.
4. Copy the link, paste it into Devpost, submit.

## If something goes wrong

- **You fumble a line.** Do not stop. Pause two seconds, say it again, carry on. Trim that patch
  on YouTube later, or just leave it. Engineers do not care about a stumble.
- **The website takes a few seconds.** Fine. Keep talking. A real model is deciding whether a
  belief should die - it is allowed to take a moment.
- **The reason text comes out different from the script.** Good. It is generated fresh every
  time. Say so out loud. It proves the demo is not a fake.

## Hard rules

- **Under 3 minutes.** Going over is a disqualification, not a deduction. The script is ~2:20.
- **Public on YouTube.** An unlisted video that a judge cannot open is a failed submission.
