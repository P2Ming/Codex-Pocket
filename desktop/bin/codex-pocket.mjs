#!/usr/bin/env node
import { randomBytes } from 'node:crypto';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { createPocketServer } from '../codex/server.mjs';
import { startFrpTunnel, normalizeFrpConfig } from '../lib/frp-tunnel.mjs';

const env = process.env;
if (process.argv.includes('--help')) {
  console.log(`Codex Pocket — mobile access through your NAS frp tunnel
Required: CODEX_POCKET_NAS_HOST (NAS LAN IP when on the same router), CODEX_POCKET_FRP_TOKEN
Optional: CODEX_POCKET_PIN (12+ chars; random if omitted), CODEX_POCKET_NAS_PORT (7000),
  CODEX_POCKET_REMOTE_PORT (7001), CODEX_POCKET_PORT (3081), CODEX_POCKET_CWD,
  CODEX_POCKET_HOME (frpc cache and configuration), CODEX_POCKET_CODEX (Codex CLI path)
Run: node bin/codex-pocket.mjs`);
  process.exit(0);
}
if ((!env.CODEX_POCKET_NAS_HOST || !env.CODEX_POCKET_FRP_TOKEN) && !process.argv.includes('--local')) {
  throw new Error('Set CODEX_POCKET_NAS_HOST and CODEX_POCKET_FRP_TOKEN, or use --local for testing');
}
const pin = env.CODEX_POCKET_PIN || randomBytes(18).toString('base64url');
const port = Number(env.CODEX_POCKET_PORT || 3081);
if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('Invalid CODEX_POCKET_PORT');
const cwd = resolve(env.CODEX_POCKET_CWD || process.cwd());
const home = env.CODEX_POCKET_HOME || join(env.CODEX_HOME || join(homedir(), '.codex'), 'pocket');
const pocket = createPocketServer({ pin, port, cwd });
let tunnel;
try {
  await pocket.start();
  console.log(`Codex Pocket local: http://127.0.0.1:${port}`);
  console.log(`Access PIN: ${pin}`);
  if (!env.CODEX_POCKET_NAS_HOST || !env.CODEX_POCKET_FRP_TOKEN) {
    console.log('NAS tunnel not started: set CODEX_POCKET_NAS_HOST and CODEX_POCKET_FRP_TOKEN.');
  } else {
    const config = normalizeFrpConfig({ serverAddr: env.CODEX_POCKET_NAS_HOST, serverPort: env.CODEX_POCKET_NAS_PORT, remotePort: env.CODEX_POCKET_REMOTE_PORT, tls: true });
    tunnel = await startFrpTunnel({ localPort: port, config, token: env.CODEX_POCKET_FRP_TOKEN, home, onPhase: (phase, detail) => console.log(`frp: ${phase}${detail ? ` — ${detail}` : ''}`) });
    tunnel.onExit(code => console.error(`frpc exited (${code}); restart Codex Pocket to reconnect.`));
    console.log(`NAS tunnel ready: forward HTTPS on your NAS to 127.0.0.1:${config.remotePort}`);
  }
} catch (error) {
  console.error(error);
  await pocket.stop().catch(() => {});
  process.exitCode = 1;
}
const stop = async () => { tunnel?.kill(); await pocket.stop(); process.exit(0); };
process.once('SIGINT', stop);
process.once('SIGTERM', stop);
