import { useStore } from '@/client/store';
import { AudioOutlined } from '@ant-design/icons';
import { Button, message } from 'antd';
import { useCallback, useRef, useState } from 'react';

export const useVoiceInput = (
  isLoading: boolean,
  onTranscribed: (text: string) => void,
) => {
  const fileStore = useStore('file');
  const settingStore = useStore('setting');

  const [isRecording, setIsRecording] = useState(false);
  const [isVoiceProcessing, setIsVoiceProcessing] = useState(false);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const chunksRef = useRef<Blob[]>([]);

  const processRecording = useCallback(
    async (blob: Blob, mimeType: string) => {
      setIsVoiceProcessing(true);
      try {
        const ext = mimeType.includes('ogg') ? 'ogg' : 'webm';
        const file = new File([blob], `voice-${Date.now()}.${ext}`, {
          type: mimeType,
        });

        const uploadResult = await fileStore.upload({ file, dir: 'stt' });
        const sttResult = await fileStore.stt({
          filePath: uploadResult.filename,
          mimeType: uploadResult.mimeType,
        });

        if (!sttResult.text.trim()) {
          message.warning(settingStore.tr('No speech detected'));
        } else {
          onTranscribed(sttResult.text);
        }
      } catch {
        message.error(settingStore.tr('Voice transcription failed'));
      } finally {
        setIsVoiceProcessing(false);
      }
    },
    [fileStore, onTranscribed, settingStore],
  );

  const probeMimeType = useCallback(() => {
    const candidates = [
      'audio/webm;codecs=opus',
      'audio/webm',
      'audio/ogg;codecs=opus',
    ];
    for (const type of candidates) {
      if (MediaRecorder.isTypeSupported(type)) return type;
    }
    return '';
  }, []);

  const handleToggle = useCallback(async () => {
    if (isRecording) {
      mediaRecorderRef.current?.stop();
      setIsRecording(false);
      return;
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: true,
      });
      streamRef.current = stream;
      chunksRef.current = [];

      const mimeType = probeMimeType();
      const recorder = new MediaRecorder(stream, {
        mimeType: mimeType || undefined,
      });

      recorder.ondataavailable = e => {
        if (e.data.size > 0) chunksRef.current.push(e.data);
      };

      recorder.onstop = () => {
        const blob = new Blob(chunksRef.current, { type: mimeType });
        for (const track of stream.getTracks()) track.stop();
        streamRef.current = null;
        processRecording(blob, mimeType);
      };

      mediaRecorderRef.current = recorder;
      recorder.start();
      setIsRecording(true);
    } catch {
      message.error(settingStore.tr('Microphone access denied'));
    }
  }, [isRecording, probeMimeType, processRecording, settingStore]);

  const micButton = (
    <Button
      icon={<AudioOutlined />}
      size="small"
      className={isRecording ? 'mic-button-recording' : undefined}
      disabled={isLoading || isVoiceProcessing}
      onClick={handleToggle}
    />
  );

  return { micButton, isRecording, isVoiceProcessing };
};
