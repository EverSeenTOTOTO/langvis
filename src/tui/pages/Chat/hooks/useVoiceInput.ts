import { useCallback, useRef, useState } from 'react';
import { spawn, type ChildProcess } from 'node:child_process';
import { promises as fs } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { useStore } from '@/client/store';
import { generateId } from '@/shared/utils';

// Terminal voice input: record the mic via ffmpeg (pulse), then run the same
// upload→stt pipeline the web voice input uses, returning the transcript.

type VoiceHandlers = {
  onTranscribed: (text: string) => void;
  onError: (msg: string) => void;
};

export function useVoiceInput({ onTranscribed, onError }: VoiceHandlers) {
  const file = useStore('file');
  const [recording, setRecording] = useState(false);
  const [processing, setProcessing] = useState(false);
  const recRef = useRef<{ proc: ChildProcess; tmp: string } | null>(null);
  const handlersRef = useRef({ onTranscribed, onError });
  handlersRef.current = { onTranscribed, onError };

  const discard = (tmp: string) => fs.unlink(tmp).catch(() => {});

  const start = useCallback(() => {
    const tmp = join(tmpdir(), `langvis-voice-${generateId('v')}.wav`);
    const proc = spawn('ffmpeg', [
      '-f',
      'pulse',
      '-i',
      'default',
      '-ac',
      '1',
      '-ar',
      '16000',
      '-y',
      tmp,
    ]);
    proc.on('error', err => {
      if (recRef.current?.proc === proc) recRef.current = null;
      discard(tmp);
      setRecording(false);
      handlersRef.current.onError(`recording failed: ${err.message}`);
    });
    recRef.current = { proc, tmp };
    setRecording(true);
  }, []);

  const cancel = useCallback(() => {
    const r = recRef.current;
    if (!r) return;
    recRef.current = null;
    r.proc.kill('SIGKILL');
    discard(r.tmp);
    setRecording(false);
  }, []);

  const stop = useCallback(async () => {
    const r = recRef.current;
    if (!r) return;
    recRef.current = null;
    // SIGINT makes ffmpeg finalize the wav header, then exit; wait for it.
    r.proc.kill('SIGINT');
    await new Promise<void>(resolve => r.proc.once('exit', () => resolve()));
    setRecording(false);
    // Transcribing is async — keep a visible notice until it resolves.
    setProcessing(true);
    try {
      const bytes = await fs.readFile(r.tmp);
      discard(r.tmp);
      if (bytes.length < 1000) {
        handlersRef.current.onError('no audio captured');
        return;
      }
      const audio = new File(
        [new Uint8Array(bytes)],
        `${generateId('voice')}.wav`,
        {
          type: 'audio/wav',
        },
      );
      const up = await file.upload({ file: audio, dir: 'stt' });
      const stt = await file.stt({
        filePath: up.filename,
        mimeType: up.mimeType,
      });
      if (stt.text.trim()) handlersRef.current.onTranscribed(stt.text);
      else handlersRef.current.onError('no speech detected');
    } catch (e) {
      discard(r.tmp);
      handlersRef.current.onError(e instanceof Error ? e.message : String(e));
    } finally {
      setProcessing(false);
    }
  }, [file]);

  return { recording, processing, start, stop, cancel };
}
