import React, { useEffect, useRef, useState, useCallback } from 'react';
import {
  Play,
  Pause,
  RotateCcw,
  Volume2,
  VolumeX,
  AlertCircle,
  Film,
  RefreshCw,
  SkipForward,
  Upload,
  Youtube,
} from 'lucide-react';
import { parseYouTubeVideoId } from '../lib/youtube';

declare global {
  interface Window {
    YT?: any;
    onYouTubeIframeAPIReady?: () => void;
  }
}

let ytApiPromise: Promise<any> | null = null;

function loadYouTubeIframeApi(): Promise<any> {
  if (window.YT && window.YT.Player) {
    return Promise.resolve(window.YT);
  }
  if (ytApiPromise) return ytApiPromise;

  ytApiPromise = new Promise((resolve) => {
    const existingScript = document.querySelector('script[src="https://www.youtube.com/iframe_api"]');
    const prevCallback = window.onYouTubeIframeAPIReady;
    window.onYouTubeIframeAPIReady = () => {
      if (prevCallback) prevCallback();
      resolve(window.YT);
    };
    if (!existingScript) {
      const tag = document.createElement('script');
      tag.src = 'https://www.youtube.com/iframe_api';
      tag.async = true;
      document.head.appendChild(tag);
    }
  });

  return ytApiPromise;
}

export interface PlaybackStateSnapshot {
  activeMediaId: string;
  activeMediaType: 'youtube' | 'upload' | 'none';
  activeMediaSource: string;
  activeMediaTitle: string;
  playbackPosition: number;
  isPlaying: boolean;
  updatedAt: number;
}

interface VideoStageProps {
  roomId: string;
  sessionToken: string;
  isHost: boolean;
  allowParticipantQueue?: boolean;
  playback: PlaybackStateSnapshot;
  onHostBroadcastPlayback: (nextState: Partial<PlaybackStateSnapshot>) => void;
  onRequestSyncFromServer: () => void;
  onPlayNextInQueue: () => void;
  onOpenAddMediaModal: (tab: 'youtube' | 'upload') => void;
  onQuickPlayYoutubeUrl?: (videoId: string) => Promise<void>;
}

const DRIFT_TOLERANCE_SECONDS = 1.85;

export const VideoStage: React.FC<VideoStageProps> = ({
  roomId,
  sessionToken,
  isHost,
  allowParticipantQueue = false,
  playback,
  onHostBroadcastPlayback,
  onRequestSyncFromServer,
  onPlayNextInQueue,
  onOpenAddMediaModal,
  onQuickPlayYoutubeUrl,
}) => {
  const ytContainerRef = useRef<HTMLDivElement | null>(null);
  const ytPlayerRef = useRef<any>(null);
  const htmlVideoRef = useRef<HTMLVideoElement | null>(null);

  // Prevents incoming remote state updates from echoing back as local events
  const isApplyingRemoteRef = useRef<boolean>(false);
  const suppressTimerRef = useRef<number | null>(null);
  const loadedYtVideoIdRef = useRef<string>('');

  const [ytReady, setYtReady] = useState(false);
  const [playerError, setPlayerError] = useState<string | null>(null);
  const [autoplayBlocked, setAutoplayBlocked] = useState(false);
  const [localCurrentTime, setLocalCurrentTime] = useState<number>(playback.playbackPosition || 0);
  const [localDuration, setLocalDuration] = useState<number>(0);
  const [isMuted, setIsMuted] = useState<boolean>(false);

  // Dedicated Quick YouTube Video Link Input (separate from Room Joining Code)
  const [quickYtUrl, setQuickYtUrl] = useState<string>('');
  const [quickYtLoading, setQuickYtLoading] = useState<boolean>(false);

  // Signed URL state for private uploaded video
  const [signedUploadUrl, setSignedUploadUrl] = useState<string>('');
  const [loadingSignedUrl, setLoadingSignedUrl] = useState<boolean>(false);

  const armRemoteSuppression = useCallback((durationMs = 650) => {
    isApplyingRemoteRef.current = true;
    if (suppressTimerRef.current) {
      window.clearTimeout(suppressTimerRef.current);
    }
    suppressTimerRef.current = window.setTimeout(() => {
      isApplyingRemoteRef.current = false;
    }, durationMs);
  }, []);

  // 1. Fetch Time-Limited Signed URL when activeMediaType === 'upload'
  const fetchSignedPlaybackUrl = useCallback(async () => {
    if (playback.activeMediaType !== 'upload' || !playback.activeMediaSource) {
      setSignedUploadUrl('');
      return;
    }
    setLoadingSignedUrl(true);
    setPlayerError(null);
    try {
      const resp = await fetch(
        `/api/rooms/${encodeURIComponent(roomId)}/media/${encodeURIComponent(
          playback.activeMediaSource
        )}/signed-url`,
        {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${sessionToken}`,
            'Content-Type': 'application/json',
          },
        }
      );
      const data = await resp.json();
      if (!resp.ok) {
        throw new Error(data.error || 'Could not obtain authorized playback URL.');
      }
      setSignedUploadUrl(data.signedUrl);
    } catch (err: any) {
      setPlayerError(err?.message || 'Failed to load protected video stream.');
    } finally {
      setLoadingSignedUrl(false);
    }
  }, [roomId, sessionToken, playback.activeMediaType, playback.activeMediaSource]);

  useEffect(() => {
    if (playback.activeMediaType === 'upload' && playback.activeMediaSource) {
      fetchSignedPlaybackUrl();
    } else {
      setSignedUploadUrl('');
    }
  }, [playback.activeMediaType, playback.activeMediaSource, fetchSignedPlaybackUrl]);

  // 2. Initialize & Manage YouTube IFrame Player
  useEffect(() => {
    if (playback.activeMediaType !== 'youtube' || !playback.activeMediaSource) {
      if (ytPlayerRef.current) {
        try {
          ytPlayerRef.current.destroy();
        } catch {
          // ignore
        }
        ytPlayerRef.current = null;
        loadedYtVideoIdRef.current = '';
        setYtReady(false);
      }
      return;
    }

    let cancelled = false;
    setPlayerError(null);

    loadYouTubeIframeApi().then((YT) => {
      if (cancelled || !ytContainerRef.current) return;

      if (ytPlayerRef.current && typeof ytPlayerRef.current.loadVideoById === 'function') {
        if (loadedYtVideoIdRef.current !== playback.activeMediaSource) {
          armRemoteSuppression(900);
          loadedYtVideoIdRef.current = playback.activeMediaSource;
          ytPlayerRef.current.loadVideoById({
            videoId: playback.activeMediaSource,
            startSeconds: Math.max(0, playback.playbackPosition),
          });
          if (!playback.isPlaying) {
            setTimeout(() => {
              try {
                ytPlayerRef.current?.pauseVideo();
              } catch {
                // ignore
              }
            }, 350);
          }
        }
        return;
      }

      // Create fresh child node for YT.Player
      ytContainerRef.current.innerHTML = '';
      const playerMount = document.createElement('div');
      ytContainerRef.current.appendChild(playerMount);

      loadedYtVideoIdRef.current = playback.activeMediaSource;

      ytPlayerRef.current = new YT.Player(playerMount, {
        width: '100%',
        height: '100%',
        videoId: playback.activeMediaSource,
        playerVars: {
          autoplay: playback.isPlaying ? 1 : 0,
          controls: 1,
          rel: 0,
          modestbranding: 1,
          playsinline: 1,
          start: Math.floor(Math.max(0, playback.playbackPosition)),
          origin: window.location.origin,
        },
        events: {
          onReady: (event: any) => {
            if (cancelled) return;
            setYtReady(true);
            const dur = event.target.getDuration?.() || 0;
            if (dur > 0) setLocalDuration(dur);

            armRemoteSuppression(800);
            if (playback.playbackPosition > 0.5) {
              event.target.seekTo(playback.playbackPosition, true);
            }
            if (playback.isPlaying) {
              event.target.playVideo();
            } else {
              event.target.pauseVideo();
            }
          },
          onStateChange: (event: any) => {
            if (cancelled) return;
            const YTState = window.YT?.PlayerState;
            if (!YTState) return;

            const dur = event.target.getDuration?.() || 0;
            if (dur > 0) setLocalDuration(dur);

            const currentPos = Number((event.target.getCurrentTime?.() || 0).toFixed(2));
            setLocalCurrentTime(currentPos);

            if (event.data === YTState.ENDED && isHost) {
              onPlayNextInQueue();
              return;
            }

            if (isApplyingRemoteRef.current) return;

            if (isHost) {
              if (event.data === YTState.PLAYING) {
                onHostBroadcastPlayback({
                  playbackPosition: currentPos,
                  isPlaying: true,
                });
              } else if (event.data === YTState.PAUSED) {
                onHostBroadcastPlayback({
                  playbackPosition: currentPos,
                  isPlaying: false,
                });
              }
            }
          },
          onError: (event: any) => {
            if (cancelled) return;
            const code = event.data;
            if (code === 101 || code === 150) {
              setPlayerError(
                'The video owner has restricted embedded playback outside YouTube. Try another video or upload a file.'
              );
            } else if (code === 100) {
              setPlayerError('This YouTube video was removed or marked private.');
            } else {
              setPlayerError('Unable to load this YouTube video (invalid ID or network restriction).');
            }
          },
        },
      });
    });

    return () => {
      cancelled = true;
    };
  }, [playback.activeMediaType, playback.activeMediaSource]);

  // 3. Apply Incoming Authoritative Playback State (YouTube & Uploaded Video)
  useEffect(() => {
    if (playback.activeMediaType === 'youtube' && ytReady && ytPlayerRef.current) {
      const player = ytPlayerRef.current;
      if (typeof player.getCurrentTime !== 'function') return;

      const currentLocal = player.getCurrentTime() || 0;
      const drift = Math.abs(currentLocal - playback.playbackPosition);
      const playerState = player.getPlayerState?.();
      const YTState = window.YT?.PlayerState;

      if (drift > DRIFT_TOLERANCE_SECONDS) {
        armRemoteSuppression(750);
        player.seekTo(playback.playbackPosition, true);
        setLocalCurrentTime(playback.playbackPosition);
      }

      if (YTState) {
        if (playback.isPlaying && playerState !== YTState.PLAYING && playerState !== YTState.BUFFERING) {
          armRemoteSuppression(750);
          player.playVideo();
        } else if (!playback.isPlaying && playerState === YTState.PLAYING) {
          armRemoteSuppression(750);
          player.pauseVideo();
        }
      }
    } else if (playback.activeMediaType === 'upload' && htmlVideoRef.current) {
      const video = htmlVideoRef.current;
      const drift = Math.abs(video.currentTime - playback.playbackPosition);

      if (drift > DRIFT_TOLERANCE_SECONDS) {
        armRemoteSuppression(600);
        try {
          video.currentTime = playback.playbackPosition;
          setLocalCurrentTime(playback.playbackPosition);
        } catch {
          // ignore if metadata not yet loaded
        }
      }

      if (playback.isPlaying && video.paused) {
        armRemoteSuppression(600);
        video.play().catch(() => {
          setAutoplayBlocked(true);
        });
      } else if (!playback.isPlaying && !video.paused) {
        armRemoteSuppression(600);
        video.pause();
      }
    }
  }, [
    playback.playbackPosition,
    playback.isPlaying,
    playback.updatedAt,
    playback.activeMediaType,
    ytReady,
    armRemoteSuppression,
  ]);

  // 4. Periodic Drift Monitor & Progress Ticker
  useEffect(() => {
    const interval = window.setInterval(() => {
      if (playback.activeMediaType === 'youtube' && ytReady && ytPlayerRef.current) {
        const player = ytPlayerRef.current;
        if (typeof player.getCurrentTime === 'function') {
          const cur = Number((player.getCurrentTime() || 0).toFixed(2));
          const dur = Number((player.getDuration?.() || 0).toFixed(2));
          setLocalCurrentTime(cur);
          if (dur > 0) setLocalDuration(dur);

          // Host periodically broadcasts authoritative heartbeat every 4s while playing
          if (isHost && playback.isPlaying && !isApplyingRemoteRef.current) {
            const driftFromLast = Math.abs(cur - playback.playbackPosition);
            if (driftFromLast > 2.5) {
              onHostBroadcastPlayback({
                playbackPosition: cur,
                isPlaying: true,
              });
            }
          }
        }
      } else if (playback.activeMediaType === 'upload' && htmlVideoRef.current) {
        const video = htmlVideoRef.current;
        setLocalCurrentTime(Number(video.currentTime.toFixed(2)));
        if (video.duration && !isNaN(video.duration)) {
          setLocalDuration(Number(video.duration.toFixed(2)));
        }
      }
    }, 1000);

    return () => clearInterval(interval);
  }, [playback.activeMediaType, playback.isPlaying, playback.playbackPosition, ytReady, isHost, onHostBroadcastPlayback]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (suppressTimerRef.current) clearTimeout(suppressTimerRef.current);
      if (ytPlayerRef.current) {
        try {
          ytPlayerRef.current.destroy();
        } catch {
          // ignore
        }
      }
    };
  }, []);

  // Controls Handlers
  const handleTogglePlayPause = () => {
    if (!isHost) {
      onRequestSyncFromServer();
      return;
    }

    const nextPlaying = !playback.isPlaying;
    if (playback.activeMediaType === 'youtube' && ytPlayerRef.current) {
      const pos = Number((ytPlayerRef.current.getCurrentTime?.() || localCurrentTime).toFixed(2));
      armRemoteSuppression(600);
      if (nextPlaying) ytPlayerRef.current.playVideo();
      else ytPlayerRef.current.pauseVideo();
      onHostBroadcastPlayback({ playbackPosition: pos, isPlaying: nextPlaying });
    } else if (playback.activeMediaType === 'upload' && htmlVideoRef.current) {
      const video = htmlVideoRef.current;
      const pos = Number(video.currentTime.toFixed(2));
      armRemoteSuppression(600);
      if (nextPlaying) {
        video.play().catch(() => setAutoplayBlocked(true));
      } else {
        video.pause();
      }
      onHostBroadcastPlayback({ playbackPosition: pos, isPlaying: nextPlaying });
    }
  };

  const handleSeekBarChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (!isHost) return;
    const targetSec = Number(e.target.value);
    setLocalCurrentTime(targetSec);
    armRemoteSuppression(650);

    if (playback.activeMediaType === 'youtube' && ytPlayerRef.current) {
      ytPlayerRef.current.seekTo(targetSec, true);
    } else if (playback.activeMediaType === 'upload' && htmlVideoRef.current) {
      htmlVideoRef.current.currentTime = targetSec;
    }

    onHostBroadcastPlayback({
      playbackPosition: targetSec,
      isPlaying: playback.isPlaying,
    });
  };

  const handleToggleMute = () => {
    const nextMute = !isMuted;
    setIsMuted(nextMute);
    if (playback.activeMediaType === 'youtube' && ytPlayerRef.current) {
      if (nextMute) ytPlayerRef.current.mute?.();
      else ytPlayerRef.current.unMute?.();
    } else if (playback.activeMediaType === 'upload' && htmlVideoRef.current) {
      htmlVideoRef.current.muted = nextMute;
    }
  };

  const handleResumeBlockedAutoplay = () => {
    setAutoplayBlocked(false);
    if (playback.activeMediaType === 'upload' && htmlVideoRef.current) {
      htmlVideoRef.current.play().catch(() => {});
    } else if (playback.activeMediaType === 'youtube' && ytPlayerRef.current) {
      ytPlayerRef.current.playVideo?.();
    }
    onRequestSyncFromServer();
  };

  const formatTime = (sec: number) => {
    if (!sec || isNaN(sec) || sec < 0) return '0:00';
    const hrs = Math.floor(sec / 3600);
    const mins = Math.floor((sec % 3600) / 60);
    const secs = Math.floor(sec % 60);
    if (hrs > 0) {
      return `${hrs}:${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
    }
    return `${mins}:${String(secs).padStart(2, '0')}`;
  };

  return (
    <div className="flex flex-col bg-[#0E0E17] border border-white/10 rounded-xl overflow-hidden">
      {/* Main 16:9 Cinema Stage */}
      <div className="relative w-full aspect-video bg-black flex items-center justify-center overflow-hidden">
        {playback.activeMediaType === 'none' && (
          <div className="flex flex-col items-center justify-center text-center px-6 max-w-lg space-y-5">
            <div className="w-14 h-14 rounded-2xl bg-violet-500/10 border border-violet-500/25 flex items-center justify-center text-violet-400">
              <Film className="w-7 h-7" />
            </div>
            <div className="space-y-1.5">
              <h3 className="text-xl font-display font-semibold text-white">
                Ready for Movie Night
              </h3>
              <p className="text-sm text-slate-400 leading-relaxed">
                {isHost
                  ? 'Select a YouTube video or upload a private MP4/WebM file to start synchronized playback for everyone in the room.'
                  : 'Waiting for the room host to select a YouTube video or uploaded file.'}
              </p>
            </div>
            {isHost && (
              <div className="flex flex-wrap items-center justify-center gap-3 pt-1">
                <button
                  onClick={() => onOpenAddMediaModal('youtube')}
                  className="inline-flex items-center gap-2 px-4 py-2 text-sm font-medium text-white bg-violet-600 hover:bg-violet-500 rounded-lg transition-colors cursor-pointer whitespace-nowrap shrink-0"
                >
                  <Youtube className="w-4 h-4" />
                  <span>Load YouTube Video</span>
                </button>
                <button
                  onClick={() => onOpenAddMediaModal('upload')}
                  className="inline-flex items-center gap-2 px-4 py-2 text-sm font-medium text-slate-200 bg-white/5 hover:bg-white/10 border border-white/10 rounded-lg transition-colors cursor-pointer whitespace-nowrap shrink-0"
                >
                  <Upload className="w-4 h-4" />
                  <span>Upload Private Video</span>
                </button>
              </div>
            )}
          </div>
        )}

        {/* YouTube IFrame Player Surface */}
        <div
          ref={ytContainerRef}
          className={`w-full h-full ${playback.activeMediaType === 'youtube' ? 'block' : 'hidden'}`}
        />

        {/* Private Uploaded Video Player Surface */}
        {playback.activeMediaType === 'upload' && (
          <div className="w-full h-full relative flex items-center justify-center">
            {loadingSignedUrl && (
              <div className="flex items-center gap-2.5 text-sm text-slate-300">
                <RefreshCw className="w-4 h-4 animate-spin text-violet-400" />
                <span>Verifying room membership & generating signed stream URL...</span>
              </div>
            )}
            {!loadingSignedUrl && signedUploadUrl && (
              <video
                ref={htmlVideoRef}
                src={signedUploadUrl}
                className="w-full h-full object-contain bg-black"
                playsInline
                controls={isHost}
                onLoadedMetadata={(e) => {
                  const v = e.currentTarget;
                  if (v.duration && !isNaN(v.duration)) {
                    setLocalDuration(Number(v.duration.toFixed(2)));
                  }
                  if (playback.playbackPosition > 0.5) {
                    v.currentTime = playback.playbackPosition;
                  }
                  if (playback.isPlaying) {
                    v.play().catch(() => setAutoplayBlocked(true));
                  }
                }}
                onPlay={(e) => {
                  if (isApplyingRemoteRef.current) return;
                  if (isHost) {
                    onHostBroadcastPlayback({
                      playbackPosition: Number(e.currentTarget.currentTime.toFixed(2)),
                      isPlaying: true,
                    });
                  }
                }}
                onPause={(e) => {
                  if (isApplyingRemoteRef.current) return;
                  if (isHost && !e.currentTarget.ended) {
                    onHostBroadcastPlayback({
                      playbackPosition: Number(e.currentTarget.currentTime.toFixed(2)),
                      isPlaying: false,
                    });
                  }
                }}
                onSeeked={(e) => {
                  if (isApplyingRemoteRef.current) return;
                  if (isHost) {
                    onHostBroadcastPlayback({
                      playbackPosition: Number(e.currentTarget.currentTime.toFixed(2)),
                      isPlaying: !e.currentTarget.paused,
                    });
                  }
                }}
                onEnded={() => {
                  if (isHost) {
                    onPlayNextInQueue();
                  }
                }}
                onError={() => {
                  setPlayerError(
                    'Protected video stream failed or signed URL expired. Click Resync to refresh your authorized token.'
                  );
                }}
              />
            )}
          </div>
        )}

        {/* Autoplay Policy Recovery Overlay */}
        {autoplayBlocked && (
          <div className="absolute inset-0 bg-black/75 flex flex-col items-center justify-center p-6 text-center z-20">
            <p className="text-sm text-slate-200 mb-3 max-w-sm">
              Your browser paused automatic playback until you interact with the player.
            </p>
            <button
              onClick={handleResumeBlockedAutoplay}
              className="inline-flex items-center gap-2 px-5 py-2.5 text-sm font-medium text-white bg-violet-600 hover:bg-violet-500 rounded-lg transition-colors cursor-pointer"
            >
              <Play className="w-4 h-4" />
              <span>Join Live Synchronized Playback</span>
            </button>
          </div>
        )}

        {/* Player Error Overlay */}
        {playerError && (
          <div className="absolute inset-x-4 bottom-4 bg-[#161625]/95 border border-rose-500/40 rounded-lg p-3.5 flex items-center justify-between gap-4 z-20">
            <div className="flex items-center gap-2.5 text-xs text-rose-200">
              <AlertCircle className="w-4 h-4 text-rose-400 shrink-0" />
              <span>{playerError}</span>
            </div>
            <button
              onClick={() => {
                setPlayerError(null);
                if (playback.activeMediaType === 'upload') {
                  fetchSignedPlaybackUrl();
                } else {
                  onRequestSyncFromServer();
                }
              }}
              className="px-3 py-1.5 text-xs font-medium text-white bg-white/10 hover:bg-white/15 rounded-md transition-colors shrink-0 cursor-pointer"
            >
              Retry
            </button>
          </div>
        )}
      </div>

      {/* Synchronized Transport & Status Toolbar */}
      <div className="px-4 py-3 bg-[#12121E] border-t border-white/10 flex flex-col gap-2.5">
        {/* Scrubber Row */}
        {playback.activeMediaType !== 'none' && (
          <div className="flex items-center gap-3">
            <span className="text-xs font-mono tabular-nums text-slate-400 w-12 text-right shrink-0">
              {formatTime(localCurrentTime)}
            </span>
            <input
              type="range"
              min={0}
              max={Math.max(localDuration, localCurrentTime, 1)}
              step={0.5}
              value={Math.min(localCurrentTime, Math.max(localDuration, localCurrentTime, 1))}
              disabled={!isHost}
              onChange={handleSeekBarChange}
              aria-label="Playback position"
              className={`w-full h-1.5 rounded-lg appearance-none bg-white/15 accent-violet-500 ${
                isHost ? 'cursor-pointer' : 'cursor-not-allowed opacity-70'
              }`}
            />
            <span className="text-xs font-mono tabular-nums text-slate-400 w-12 shrink-0">
              {formatTime(localDuration)}
            </span>
          </div>
        )}

        {/* Controls & Active Media Metadata Row */}
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2 min-w-0">
            <button
              onClick={handleTogglePlayPause}
              disabled={playback.activeMediaType === 'none' || !isHost}
              title={isHost ? (playback.isPlaying ? 'Pause for everyone' : 'Play for everyone') : 'Host controls playback'}
              className="inline-flex items-center justify-center w-9 h-9 rounded-lg bg-violet-600 hover:bg-violet-500 disabled:bg-white/5 disabled:text-slate-500 text-white transition-colors shrink-0 cursor-pointer disabled:cursor-not-allowed"
            >
              {playback.isPlaying ? <Pause className="w-4 h-4" /> : <Play className="w-4 h-4" />}
            </button>

            {isHost && playback.activeMediaType !== 'none' && (
              <button
                onClick={onPlayNextInQueue}
                title="Play next item in queue"
                className="inline-flex items-center justify-center w-9 h-9 rounded-lg bg-white/5 hover:bg-white/10 text-slate-200 transition-colors shrink-0 cursor-pointer"
              >
                <SkipForward className="w-4 h-4" />
              </button>
            )}

            <button
              onClick={handleToggleMute}
              disabled={playback.activeMediaType === 'none'}
              title={isMuted ? 'Unmute local audio' : 'Mute local audio'}
              className="inline-flex items-center justify-center w-9 h-9 rounded-lg bg-white/5 hover:bg-white/10 disabled:opacity-40 text-slate-200 transition-colors shrink-0 cursor-pointer"
            >
              {isMuted ? <VolumeX className="w-4 h-4 text-rose-400" /> : <Volume2 className="w-4 h-4" />}
            </button>

            <button
              onClick={() => {
                if (playback.activeMediaType === 'upload') fetchSignedPlaybackUrl();
                onRequestSyncFromServer();
              }}
              title="Resynchronize with authoritative room state"
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-slate-300 bg-white/5 hover:bg-white/10 rounded-lg transition-colors shrink-0 cursor-pointer whitespace-nowrap"
            >
              <RotateCcw className="w-3.5 h-3.5" />
              <span>Resync</span>
            </button>

            <div className="min-w-0 pl-2">
              <div className="text-sm font-medium text-white truncate max-w-[220px] sm:max-w-[340px]">
                {playback.activeMediaTitle || 'No media playing'}
              </div>
              <div className="text-xs text-slate-400 flex items-center gap-1.5">
                <span>
                  {playback.activeMediaType === 'youtube'
                    ? 'YouTube Synchronized Stream'
                    : playback.activeMediaType === 'upload'
                    ? 'Private Signed Storage Stream'
                    : 'Idle Stage'}
                </span>
                <span aria-hidden="true">·</span>
                <span>{isHost ? 'You are Host (Authoritative)' : 'Synced to Host'}</span>
              </div>
            </div>
          </div>

          <div className="flex items-center gap-2 shrink-0">
            <button
              onClick={() => onOpenAddMediaModal('youtube')}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-slate-200 bg-white/5 hover:bg-white/10 border border-white/10 rounded-lg transition-colors cursor-pointer whitespace-nowrap shrink-0"
            >
              <Youtube className="w-3.5 h-3.5 text-rose-400" />
              <span>More YouTube Options</span>
            </button>
            <button
              onClick={() => onOpenAddMediaModal('upload')}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-slate-200 bg-white/5 hover:bg-white/10 border border-white/10 rounded-lg transition-colors cursor-pointer whitespace-nowrap shrink-0"
            >
              <Upload className="w-3.5 h-3.5 text-violet-400" />
              <span>Upload MP4/WebM</span>
            </button>
          </div>
        </div>

        {/* Dedicated Inline YouTube Video Link Input (100% Separate from Room Joining Code) */}
        {(isHost || allowParticipantQueue) && onQuickPlayYoutubeUrl && (
          <form
            onSubmit={async (e) => {
              e.preventDefault();
              const raw = quickYtUrl.trim();
              if (!raw) return;
              if (raw.toUpperCase().startsWith('FFX-')) {
                setPlayerError(
                  'That is a Room Joining Code! Paste only a YouTube video link (e.g. https://www.youtube.com/watch?v=...) in this video box.'
                );
                return;
              }
              const parsedId = parseYouTubeVideoId(raw);
              if (!parsedId) {
                setPlayerError(
                  'Invalid YouTube video link. Please paste a valid https://www.youtube.com/watch?v=... or https://youtu.be/... link.'
                );
                return;
              }
              setPlayerError(null);
              setQuickYtLoading(true);
              try {
                await onQuickPlayYoutubeUrl(parsedId);
                setQuickYtUrl('');
              } catch (err: any) {
                setPlayerError(err?.message || 'Failed to load YouTube video.');
              } finally {
                setQuickYtLoading(false);
              }
            }}
            className="pt-2 border-t border-white/10 flex flex-col sm:flex-row items-stretch sm:items-center gap-2"
          >
            <div className="flex items-center gap-2 flex-1 min-w-0 bg-[#09090F] border border-white/10 rounded-lg px-3 py-1.5 focus-within:border-violet-500">
              <Youtube className="w-4 h-4 text-rose-400 shrink-0" />
              <input
                type="text"
                value={quickYtUrl}
                onChange={(e) => setQuickYtUrl(e.target.value)}
                placeholder="Paste YouTube video link here (e.g. https://www.youtube.com/watch?v=...)"
                className="w-full text-xs sm:text-sm bg-transparent text-white placeholder-slate-500 focus:outline-none"
              />
            </div>
            <button
              type="submit"
              disabled={!quickYtUrl.trim() || quickYtLoading}
              className="inline-flex items-center justify-center gap-1.5 px-4 py-1.5 text-xs font-medium text-white bg-rose-600 hover:bg-rose-500 disabled:opacity-40 rounded-lg transition-colors cursor-pointer whitespace-nowrap shrink-0"
            >
              <Play className="w-3.5 h-3.5" />
              <span>{quickYtLoading ? 'Loading...' : isHost ? 'Play YouTube Video' : 'Queue YouTube Video'}</span>
            </button>
          </form>
        )}
      </div>
    </div>
  );
};
