# Build a shareable Android APK (Expo / EAS)

From **`mobile/`**:

```bash
cd mobile
npm run build:android
```

Same thing, explicit CLI:

```bash
npx eas-cli@latest build --platform android --profile preview --wait
```

1. **Log in** to Expo / EAS when the CLI asks (once per machine is enough if you’re already logged in).
2. Wait until the build **finishes** (`--wait` keeps the process open; the terminal may also show an install QR / link).
3. Open the **expo.dev** build page from the link in the terminal and **download the APK**.
4. **Send the APK** to people; they open it on Android and install (they may need to allow installs from the browser or Files app / “unknown sources”).

Production Play-style bundle (AAB) instead of APK: use profile `production` — `npm run build:android:production`.

CI without prompts (no install QR in terminal): `npm run build:android:ci`.
