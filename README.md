# Daily Five

Five jobs worth applying to, every morning. Invite-only.

- **Use it:** https://vidhyesh03-debug.github.io/daily-five/ (works on phone and laptop; on a phone use "Add to Home screen")
- **Android app:** https://github.com/vidhyesh03-debug/daily-five/releases/latest/download/daily-five.apk

## How it fits together
- `web/` is the whole app. Every push to `main` republishes it (`.github/workflows/pages.yml`).
- The Android app (`capacitor.config.json`, built by `.github/workflows/android.yml`) opens the same website,
  so website changes reach Android users too, with no reinstall.
- Data lives in Supabase. The key in `web/config.js` is the public "anon" key: it cannot read any table.
  Everything goes through database functions that only return the signed-in member's own data.
