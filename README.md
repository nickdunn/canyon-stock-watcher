# canyon-stock-watcher

Checks a Canyon bike page every 10 minutes on GitHub Actions and sends a push notification when a given colour and size is in stock and can be ordered. Forked from [sashadbr/canyon-stock-watcher](https://github.com/sashadbr/canyon-stock-watcher).

Currently watching: Endurace CF SLX 8 Di2, Champagne, size S (en-gb store).

## How it works

A headless Chromium loads the product page and reads the product data Canyon embeds in it (JSON-LD offers, one per colour and size). If the matching offer is marked `InStock` or `PreOrder` (orderable now, delivered later), you get an alert. You also get one low-priority message a day around 9am UK time, so you know it's still running and can see any errors.

## Setup

1. Install the [ntfy](https://ntfy.sh) app and subscribe to a topic with a hard-to-guess name.
2. In the repo, go to Settings → Secrets and variables → Actions and add a secret `NTFY_TOPIC` with that name. (Telegram works too: add `TELEGRAM_TOKEN` and `TELEGRAM_CHAT_ID`.)
3. Optional: add a repository variable `TARGET_SIZE` to watch a different size (defaults to `S`).
4. Run the workflow once from the Actions tab with "Send the daily summary now" ticked to check notifications arrive.

To watch a different bike or colour, edit `BIKES` in `check.js`.

## Notes

- While the bike is in stock you'll get an alert on every run (every 10 minutes) until it sells out or you disable the workflow.
- GitHub turns off scheduled workflows after 60 days with no activity in the repo. Re-enable it from the Actions tab if that happens.
- Scheduled runs can be delayed by a few minutes when GitHub is busy.
