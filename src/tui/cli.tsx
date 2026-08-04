/** @jsxImportSource react */
import { render } from 'ink';
import { reaction } from 'mobx';
import { readFileSync, writeFileSync, mkdirSync, unlinkSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { Root, type ConvStorage } from './app';
import { useKeyboard } from '@/tui/hooks/useKeyboard';
import { serverFetch, getPrefetchPath } from '@/client/decorator/api';
import { useStore } from '@/client/store';
import { LANGVIS_DIR } from '@/shared/constants';

const LANGVIS_HOME = join(homedir(), LANGVIS_DIR);
const COOKIE_FILE = join(LANGVIS_HOME, 'cookies.json');

// Login is global (~/.langvis/cookies.json); the conversation is per workspace —
// its id lives in the working dir's .langvis so each directory resumes its own.
const CONV_FILE = join(process.cwd(), LANGVIS_DIR, 'cli-conv-id');

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

// Ctrl-D quits; Ctrl-C stays a normal key so screens cancel a running stream on '\x03'.
function QuitOnCtrlD() {
  useKeyboard(data => {
    if (data === '\x04') process.exit(0);
  });
  return null;
}

// Mirror the serverFetch cookie jar to ~/.langvis/cookies.json — restore
// before the auth probe, persist on login. Kept here so node:fs stays out of bundle.

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
  mkdirSync(LANGVIS_HOME, { recursive: true });
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

  // On login persist the cookie and clear the screen (reaction runs before
  // React re-renders Chat, so the clear lands first); on logout drop it.
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

  // Mirror the active conversation id to ~/.langvis/cli-conv-id on every change
  // so /conv, /new, and post-delete reassignment persist without picker access.
  const conversationStore = useStore('conversation');
  reaction(
    () => conversationStore.currentConversationId,
    id => {
      if (id) {
        fileConv.setConvId(id);
        // Clear on switch so the previous conv's Static scrollback doesn't linger
        // (Ink Static is append-only; the remount in Chat shows the new conv).
        ink.clear();
      }
    },
  );
}

void main();
