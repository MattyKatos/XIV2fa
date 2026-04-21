# xiv2fa

Generates a Square Enix compatible TOTP code (from a Base32 secret) and sends it to XIVLauncher.

## How to use

1. Install deps

```bash
npm install
```

2. Create your `.env`

```bash
copy .env.example .env
```

3. Edit `.env`

- Set `TOTP_SECRET` to your Base32 secret
- Set `TARGET_IP` to the machine running XIVLauncher (use `localhost` if it’s the same PC)

4. Run

```bash
node src/index.js
```

## What it sends

It performs an HTTP GET request to:

```text
http://<TARGET_IP>:<TARGET_PORT>/ffxivlauncher/<OTP>
```

## Common options

- `DRY_RUN=1` to generate/log the OTP without sending
- `LOG_PAYLOAD=1` to print the OTP + URL
- `SEND_DELAY_MS=5000` if you need to wait for the launcher UI
