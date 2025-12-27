import {
  PauseOutlined,
  PlayCircleOutlined,
  SoundOutlined,
} from '@ant-design/icons';
import { Button, Flex, Slider, theme, Tooltip } from 'antd';
import { observer } from 'mobx-react-lite';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import './index.scss';

const { useToken } = theme;

interface AudioPlayerProps {
  prefix?: React.ReactNode;
  suffix?: React.ReactNode;
  src: string;
  className?: string;
  style?: React.CSSProperties;
}

const AudioPlayer: React.FC<AudioPlayerProps> = ({
  src,
  prefix,
  suffix,
  className,
  style,
}) => {
  const audioRef = useRef<HTMLAudioElement>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [duration, setDuration] = useState(0);
  const [currentTime, setCurrentTime] = useState(0);
  const [volume, setVolume] = useState(0.8);
  const [isLoading, setIsLoading] = useState(true);
  const { token } = useToken();

  const formatTime = useCallback((time: number): string => {
    if (!isFinite(time)) return '0:00';
    const minutes = Math.floor(time / 60);
    const seconds = Math.floor(time % 60);
    return `${minutes}:${seconds.toString().padStart(2, '0')}`;
  }, []);

  const handlePlayPause = useCallback(() => {
    const audio = audioRef.current;
    if (!audio) return;

    if (isPlaying) {
      audio.pause();
    } else {
      audio.play();
    }
    setIsPlaying(!isPlaying);
  }, [isPlaying]);

  const handleTimeChange = useCallback(
    (value: number) => {
      const audio = audioRef.current;
      if (!audio) return;

      const newTime = (value / 100) * duration;
      audio.currentTime = newTime;
      setCurrentTime(newTime);
    },
    [duration],
  );

  const handleVolumeChange = useCallback((value: number) => {
    const audio = audioRef.current;
    if (!audio) return;

    const newVolume = value / 100;
    audio.volume = newVolume;
    setVolume(newVolume);
  }, []);

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;

    const handleLoadedMetadata = () => {
      setDuration(audio.duration);
      setIsLoading(false);
    };

    const handleTimeUpdate = () => {
      setCurrentTime(audio.currentTime);
    };

    const handleEnded = () => {
      setIsPlaying(false);
      setCurrentTime(0);
    };

    const handleLoadStart = () => {
      setIsLoading(true);
    };

    const handleCanPlay = () => {
      setIsLoading(false);
    };

    audio.addEventListener('loadedmetadata', handleLoadedMetadata);
    audio.addEventListener('timeupdate', handleTimeUpdate);
    audio.addEventListener('ended', handleEnded);
    audio.addEventListener('loadstart', handleLoadStart);
    audio.addEventListener('canplay', handleCanPlay);

    // Set initial volume
    audio.volume = volume;

    return () => {
      audio.removeEventListener('loadedmetadata', handleLoadedMetadata);
      audio.removeEventListener('timeupdate', handleTimeUpdate);
      audio.removeEventListener('ended', handleEnded);
      audio.removeEventListener('loadstart', handleLoadStart);
      audio.removeEventListener('canplay', handleCanPlay);
    };
  }, [src, volume]);

  const progressPercent = duration ? (currentTime / duration) * 100 : 0;

  return (
    <Flex
      gap={8}
      align="center"
      className={`audio-player ${className || ''}`}
      style={{
        ...style,
        backgroundColor: token.colorBgContainer,
        border: `1px solid ${token.colorBorder}`,
      }}
    >
      <audio ref={audioRef} src={src} preload="metadata" />

      {prefix}

      <Button
        type="text"
        icon={isPlaying ? <PauseOutlined /> : <PlayCircleOutlined />}
        onClick={handlePlayPause}
        disabled={isLoading}
        loading={isLoading}
        className="play-button"
      />

      <span className="time-display">
        {formatTime(currentTime)}/{formatTime(duration)}
      </span>

      <Slider
        value={progressPercent}
        onChange={handleTimeChange}
        className="progress-slider"
        tooltip={{ formatter: null }}
        disabled={isLoading}
      />

      <Tooltip
        trigger="click"
        classNames={{
          root: 'volume-control',
        }}
        title={
          <Slider
            vertical
            value={volume * 100}
            onChange={handleVolumeChange}
            className="volume-slider"
            tooltip={{ formatter: value => `${value}%` }}
          />
        }
      >
        <SoundOutlined className="volume-icon" />
      </Tooltip>

      {suffix}
    </Flex>
  );
};

export default observer(AudioPlayer);
