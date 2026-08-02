/** @jsxImportSource react */
import { render } from 'ink';
import { reaction } from 'mobx';
import { readFileSync, writeFileSync, mkdirSync, unlinkSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { Root, type ConvStorage } from './app';
import { useKeyboard } from '@/tui/hooks';
import { serverFetch, getPrefetchPath } from '@/client/decorator/api';
import { useStore } from '@/client/store';

const LANGVIS_DIR = join(homedir(), '.langvis');
const CONV_FILE = join(LANGVIS_DIR, 'cli-conv-id');
const COOKIE_FILE = join(LANGVIS_DIR, 'cookies.json');

/** Persist the CLI's conversation id under ~/.langvis so reruns resume the same
 * conversation. */
const fileConv: ConvStorage = {
  getConvId: () => {
    try {
      return readFileSync(CONV_FILE, 'utf8').trim() || null;
    } catch {
      return null;
    }
  },
  setConvId: id => {
    try {
      mkdirSync(dirname(CONV_FILE), { recursive: true });
      writeFileSync(CONV_FILE, id);
    } catch {
      /* ignore — non-fatal */
    }
  },
};

/** Ctrl-D quits (preserves the old CLI quit key). Ctrl-C is left as a normal
 * key so screens can cancel a running stream on '\x03'. */
function QuitOnCtrlD() {
  useKeyboard(data => {
    if (data === '\x04') process.exit(0);
  });
  return null;
}

// ── CLI session persistence (one login per machine) ─────────────────────────
// The cookie jar is api.ts's serverFetch singleton (in-memory by default).
// Mirror it to ~/.langvis/cookies.json: restore on startup — before the auth
// probe, so getSession sees the cookie and skips sign-in — and persist on
// login. Kept in the CLI entry so node:fs never reaches the browser bundle.

const readJson = <T,>(file: string): T | null => {
  try {
    return JSON.parse(readFileSync(file, 'utf8')) as T;
  } catch {
    return null;
  }
};

const jarGetCookies = (jar: unknown, url: string): Promise<string[]> =>
  new Promise(resolve => {
    (jar as any).getCookies(url, (_err: unknown, cookies: unknown[]) => {
      resolve(((cookies as any[]) ?? []).map(c => c.toString()));
    });
  });

const jarSetCookie = (jar: unknown, line: string, url: string): Promise<void> =>
  new Promise(resolve => {
    (jar as any).setCookie(line, url, () => resolve());
  });

async function restoreSessionCookies() {
  const jar = (await serverFetch.init()).cookieJar;
  const lines = readJson<string[]>(COOKIE_FILE);
  if (!lines) return;
  const url = getPrefetchPath('/');
  for (const line of lines) {
    await jarSetCookie(jar, line, url);
  }
}

async function persistSessionCookies() {
  const jar = serverFetch.cookieJar;
  if (!jar) return;
  const url = getPrefetchPath('/');
  const lines = await jarGetCookies(jar, url);
  mkdirSync(LANGVIS_DIR, { recursive: true });
  writeFileSync(COOKIE_FILE, JSON.stringify(lines));
}

async function main() {
  await restoreSessionCookies();

  const ink = render(
    <>
      <QuitOnCtrlD />
      <Root storage={fileConv} />
    </>,
    { exitOnCtrlC: false },
  );

  // On login: persist the session cookie and clear the screen so the chat
  // starts on a fresh surface (wipes boot output + the sign-in form). The
  // mobx reaction runs synchronously on the currentUser change, before
  // React's async re-render draws Chat — so the clear lands first. On
  // logout: drop the persisted cookie.
  const userStore = useStore('user');
  reaction(
    () => userStore.currentUser,
    user => {
      if (user) {
        void persistSessionCookies();
        ink.clear();
      } else {
        try {
          unlinkSync(COOKIE_FILE);
        } catch {
          /* already gone */
        }
      }
    },
  );
}

void main();
