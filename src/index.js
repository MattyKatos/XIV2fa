const dotenv = require('dotenv');
const net = require('net');
const { authenticator } = require('otplib');

dotenv.config();

function normalizeSecretAndOptions(input) {
  const raw = String(input || '').trim();

  if (raw.toLowerCase().startsWith('otpauth://')) {
    const u = new URL(raw);
    const secret = (u.searchParams.get('secret') || '').trim().replace(/\s+/g, '');
    const digitsRaw = u.searchParams.get('digits');
    const periodRaw = u.searchParams.get('period');
    const algoRaw = u.searchParams.get('algorithm');

    const digits = digitsRaw ? Number(digitsRaw) : undefined;
    const step = periodRaw ? Number(periodRaw) : undefined;
    const algorithm = algoRaw ? String(algoRaw).toLowerCase() : undefined;

    return {
      secret,
      options: {
        algorithm: algorithm || 'sha1',
        digits: Number.isFinite(digits) ? digits : 6,
        step: Number.isFinite(step) ? step : 30,
      },
    };
  }

  return {
    secret: raw.replace(/\s+/g, ''),
    options: { algorithm: 'sha1', digits: 6, step: 30 },
  };
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function formatErr(err) {
  if (!err) return '';
  if (err instanceof AggregateError && Array.isArray(err.errors)) {
    const inner = err.errors
      .map((e) => (e && e.message ? e.message : String(e)))
      .join('; ');
    return `${err.name}: ${inner}`;
  }
  return err.message || String(err);
}

function buildOtpUrl({ ip, port, path, code }) {
  const basePath = String(path || '/ffxivlauncher').replace(/\/+$/, '');
  const suffix = encodeURIComponent(String(code));
  return `http://${ip}:${port}${basePath}/${suffix}`;
}

async function sendCode({ ip, port, path, code }) {
  const basePath = String(path || '/ffxivlauncher').replace(/\/+$/, '');
  const reqPath = `${basePath}/${encodeURIComponent(String(code))}`;
  const timeoutMs = Number(process.env.HTTP_TIMEOUT_MS || 5000);

  return await new Promise((resolve, reject) => {
    let settled = false;
    const socket = net.createConnection({ host: ip, port }, () => {
      const request =
        `GET ${reqPath} HTTP/1.1\r\n` +
        `Host: ${ip}:${port}\r\n` +
        `Connection: close\r\n` +
        `\r\n`;

      socket.write(request, (err) => {
        if (err) return;
        if (!settled) {
          settled = true;
          clearTimeout(t);
          resolve({ status: 0, body: '' });
        }
        socket.end();
      });
    });

    const t = setTimeout(() => {
      if (!settled) {
        settled = true;
        socket.destroy(new Error(`Timeout after ${timeoutMs}ms`));
      } else {
        socket.destroy();
      }
    }, timeoutMs);

    socket.on('error', (err) => {
      if (settled) return;
      settled = true;
      clearTimeout(t);
      reject(err);
    });
  }).catch((err) => {
    const url = buildOtpUrl({ ip, port, path, code });
    throw new Error(`Request failed for ${url} (cause: ${formatErr(err)})`);
  });
}

function getArg(name, defaultValue = undefined) {
  const prefix = `--${name}=`;
  const hit = process.argv.find((a) => a.startsWith(prefix));
  if (!hit) return defaultValue;
  return hit.slice(prefix.length);
}

async function main() {
  const secretInput = process.env.TOTP_SECRET || getArg('secret');
  if (!secretInput) {
    throw new Error('Missing secret. Provide TOTP_SECRET env var or --secret=...');
  }

  const { secret, options } = normalizeSecretAndOptions(secretInput);
  if (!secret) {
    throw new Error('Missing TOTP secret value (empty after parsing).');
  }

  authenticator.options = options;

  const ip = process.env.TARGET_IP || getArg('ip', '0.0.0.0');
  const portRaw = process.env.TARGET_PORT || getArg('port', '4646');
  const path = process.env.TARGET_PATH || getArg('path', '/ffxivlauncher');
  const sendDelayMsRaw = process.env.SEND_DELAY_MS || getArg('delayMs', '5000');
  const logPayloadRaw = process.env.LOG_PAYLOAD || getArg('logPayload', '0');
  const dryRunRaw = process.env.DRY_RUN || getArg('dryRun', '0');
  const timeOffsetSecondsRaw = process.env.TIME_OFFSET_SECONDS || getArg('timeOffsetSeconds', '0');

  const port = Number(portRaw);
  if (!Number.isFinite(port) || port <= 0) {
    throw new Error(`Invalid port: ${portRaw}`);
  }

  const sendDelayMs = Number(sendDelayMsRaw);
  if (!Number.isFinite(sendDelayMs) || sendDelayMs < 0) {
    throw new Error(`Invalid SEND_DELAY_MS: ${sendDelayMsRaw}`);
  }

  if (sendDelayMs > 0) {
    await sleep(sendDelayMs);
  }

  const dryRun = dryRunRaw === '1' || dryRunRaw.toLowerCase() === 'true';

  const timeOffsetSeconds = Number(timeOffsetSecondsRaw);
  if (!Number.isFinite(timeOffsetSeconds)) {
    throw new Error(`Invalid TIME_OFFSET_SECONDS: ${timeOffsetSecondsRaw}`);
  }
  const timeOffsetMs = timeOffsetSeconds * 1000;

  authenticator.options = { ...options, epoch: Date.now() + timeOffsetMs };
  const code = authenticator.generate(secret);

  const logPayload = logPayloadRaw === '1' || logPayloadRaw.toLowerCase() === 'true';
  if (logPayload) {
    const url = buildOtpUrl({ ip, port, path, code });
    process.stderr.write(`OTP: ${code}\n`);
    process.stderr.write(`URL: ${url}\n`);
  }

  if (dryRun) {
    return;
  }

  const result = await sendCode({ ip, port, path, code });
  process.stdout.write(`${result.body}\n`);
}

main().catch((err) => {
  process.stderr.write(`${err.stack || err.message}\n`);
  process.exitCode = 1;
});
