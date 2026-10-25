import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
  Copy,
  Check,
  Lock,
  Unlock,
  Mic,
  MicOff,
  PhoneOff,
  PhoneCall,
  Send,
  Trash2,
  ArrowUp,
  ArrowDown,
  Play,
  Plus,
  Users,
  MessageSquare,
  ListVideo,
  Settings,
  LogOut,
  Crown,
  UserX,
  AlertCircle,
  Wifi,
  WifiOff,
  RefreshCw,
  FileVideo,
  Youtube,
  Smile,
  Volume2,
} from 'lucide-react';
import { BrandLogo } from './BrandLogo';
import { VideoStage, PlaybackStateSnapshot } from './VideoStage';
import { AddMediaModal } from './Modals';
import { WebRTCMeshManager, PeerConnectionStatus, IncomingSignal } from '../lib/webrtc';
import { mirrorChatMessageToFirestore, mirrorRoomPlaybackToFirestore } from '../lib/firebase';

export interface ClientMember {
  memberId: string;
  displayName: string;
  avatarUrl: string;
  authType: 'firebase' | 'guest';
  role: 'host' | 'participant' | 'guest';
  joinedAt: string;
  lastSeenAt: string;
  isOnline: boolean;
  inVoice: boolean;
  isMuted: boolean;
  isSpeaking: boolean;
}

export interface ClientMediaItem {
  id: string;
  ownerId: string;
  ownerName: string;
  roomId: string;
  sourceType: 'youtube' | 'upload';
  title: string;
  mimeType: string;
  fileSize: number | null;
  createdAt: string;
}

export interface ClientQueueItem {
  id: string;
  roomId: string;
  mediaItemId: string;
  sourceType: 'youtube' | 'upload';
  sourceId: string;
  title: string;
  mimeType?: string;
  fileSize?: number | null;
  position: number;
  addedBy: string;
  addedByName: string;
  createdAt: string;
}

export interface ClientChatMessage {
  id: string;
  roomId: string;
  senderId: string;
  displayName: string;
  avatarUrl: string;
  message: string;
  reactions: Record<string, string[]>;
  createdAt: string;
  isSystem?: boolean;
}

export interface ClientRoomState {
  id: string;
  name: string;
  hostId: string;
  inviteCode: string;
  isPrivate: boolean;
  isLocked: boolean;
  allowParticipantQueue: boolean;
  status: 'active' | 'ended';
  activeMediaId: string;
  activeMediaType: 'youtube' | 'upload' | 'none';
  activeMediaSource: string;
  activeMediaTitle: string;
  playbackPosition: number;
  isPlaying: boolean;
  playbackUpdatedAt: number;
  createdAt: string;
  expiresAt: number;
  members: ClientMember[];
  mediaItems: ClientMediaItem[];
  queue: ClientQueueItem[];
  messages: ClientChatMessage[];
}

interface WatchRoomPageProps {
  initialRoom: ClientRoomState;
  actor: {
    id: string;
    displayName: string;
    avatarUrl: string;
    authType: 'firebase' | 'guest';
  };
  sessionToken: string;
  onLeaveRoom: (reason?: string) => void;
}

type ConnectionState = 'connecting' | 'connected' | 'reconnecting' | 'disconnected';

const ALLOWED_REACTIONS = ['👍', '❤️', '😂', '🔥', '👏', '😮'];

export const WatchRoomPage: React.FC<WatchRoomPageProps> = ({
  initialRoom,
  actor,
  sessionToken,
  onLeaveRoom,
}) => {
  const [room, setRoom] = useState<ClientRoomState>(initialRoom);
  const [connectionState, setConnectionState] = useState<ConnectionState>('connecting');
  const [copiedInvite, setCopiedInvite] = useState(false);
  const [bottomDeckTab, setBottomDeckTab] = useState<'queue' | 'uploads' | 'members' | 'settings'>('queue');

  // Add Media Modal State
  const [addMediaOpen, setAddMediaOpen] = useState(false);
  const [addMediaTab, setAddMediaTab] = useState<'youtube' | 'upload'>('youtube');

  // Chat State
  const [chatInput, setChatInput] = useState('');
  const [chatError, setChatError] = useState<string | null>(null);
  const [typingUsers, setTypingUsers] = useState<Record<string, string>>({});
  const [activeReactionPickerId, setActiveReactionPickerId] = useState<string | null>(null);
  const chatScrollContainerRef = useRef<HTMLDivElement | null>(null);
  const typingTimeoutRef = useRef<number | null>(null);

  // Voice Call (WebRTC) State
  const [inVoice, setInVoice] = useState(false);
  const [isVoiceMuted, setIsVoiceMuted] = useState(false);
  const [localSpeaking, setLocalSpeaking] = useState(false);
  const [localAudioLevel, setLocalAudioLevel] = useState(0);
  const [audioDevices, setAudioDevices] = useState<MediaDeviceInfo[]>([]);
  const [selectedDeviceId, setSelectedDeviceId] = useState<string>('');
  const [peerStatuses, setPeerStatuses] = useState<Record<string, PeerConnectionStatus>>({});
  const [voiceError, setVoiceError] = useState<string | null>(null);
  const [joiningVoice, setJoiningVoice] = useState(false);

  // Action feedback error banner
  const [actionBanner, setActionBanner] = useState<string | null>(null);

  const wsRef = useRef<WebSocket | null>(null);
  const reconnectTimerRef = useRef<number | null>(null);
  const unmountedRef = useRef<boolean>(false);
  const webrtcRef = useRef<WebRTCMeshManager | null>(null);

  const isHost = room.hostId === actor.id;

  // Send JSON payload over WebSocket
  const sendWsMessage = useCallback((payload: Record<string, unknown>) => {
    if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify(payload));
    }
  }, []);

  // Initialize WebRTC Manager
  useEffect(() => {
    const manager = new WebRTCMeshManager({
      selfMemberId: actor.id,
      sendSignal: (signal) => {
        sendWsMessage({
          type: 'webrtc:signal',
          targetMemberId: signal.targetMemberId,
          signalType: signal.signalType,
          sdp: signal.sdp,
          candidate: signal.candidate,
        });
      },
      onSpeakingChange: (speaking, level) => {
        setLocalSpeaking(speaking);
        setLocalAudioLevel(level);
        sendWsMessage({
          type: 'voice:status',
          isMuted: isVoiceMuted,
          isSpeaking: speaking,
        });
      },
      onPeerStatusChange: (statuses) => {
        setPeerStatuses(statuses);
      },
      onError: (msg) => {
        setVoiceError(msg);
      },
    });

    webrtcRef.current = manager;
    return () => {
      manager.destroyAll();
      webrtcRef.current = null;
    };
  }, [actor.id, sendWsMessage]);

  // Keep WebRTC Mesh Peers in sync with room members who have inVoice === true
  useEffect(() => {
    if (!inVoice || !webrtcRef.current) return;
    const activeVoiceIds = room.members
      .filter((m) => m.inVoice && m.isOnline)
      .map((m) => m.memberId);
    webrtcRef.current.syncVoicePeers(activeVoiceIds);
  }, [inVoice, room.members]);

  // Connect WebSocket
  useEffect(() => {
    unmountedRef.current = false;

    const connectWebSocket = (isReconnect = false) => {
      if (unmountedRef.current) return;
      setConnectionState(isReconnect ? 'reconnecting' : 'connecting');

      const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
      const wsUrl = `${protocol}//${window.location.host}/ws?roomId=${encodeURIComponent(
        initialRoom.id
      )}&token=${encodeURIComponent(sessionToken)}`;

      const ws = new WebSocket(wsUrl);
      wsRef.current = ws;

      ws.onopen = () => {
        if (unmountedRef.current) return;
        setConnectionState('connected');
        ws.send(JSON.stringify({ type: 'playback:request_sync' }));
      };

      ws.onmessage = (event) => {
        if (unmountedRef.current) return;
        let data: any;
        try {
          data = JSON.parse(event.data);
        } catch {
          return;
        }

        switch (data.type) {
          case 'room:init': {
            if (data.room) {
              setRoom(data.room);
            }
            break;
          }

          case 'playback:sync': {
            setRoom((prev) => ({
              ...prev,
              activeMediaId: data.activeMediaId ?? prev.activeMediaId,
              activeMediaType: data.activeMediaType ?? prev.activeMediaType,
              activeMediaSource: data.activeMediaSource ?? prev.activeMediaSource,
              activeMediaTitle: data.activeMediaTitle ?? prev.activeMediaTitle,
              playbackPosition:
                typeof data.playbackPosition === 'number' ? data.playbackPosition : prev.playbackPosition,
              isPlaying: typeof data.isPlaying === 'boolean' ? data.isPlaying : prev.isPlaying,
              playbackUpdatedAt: data.updatedAt || Date.now(),
            }));
            break;
          }

          case 'presence:sync': {
            if (Array.isArray(data.members)) {
              setRoom((prev) => ({ ...prev, members: data.members }));
            }
            if (data.leftVoiceMemberId && webrtcRef.current) {
              webrtcRef.current.removePeer(data.leftVoiceMemberId);
            }
            break;
          }

          case 'member:joined': {
            setRoom((prev) => {
              const nextMessages =
                data.systemMessage && !prev.messages.some((m) => m.id === data.systemMessage.id)
                  ? [...prev.messages, data.systemMessage]
                  : prev.messages;
              return {
                ...prev,
                members: Array.isArray(data.members) ? data.members : prev.members,
                messages: nextMessages,
              };
            });
            break;
          }

          case 'member:kicked': {
            if (data.targetMemberId === actor.id) {
              webrtcRef.current?.destroyAll();
              onLeaveRoom('You were removed from the room by the host.');
              return;
            }
            if (Array.isArray(data.members)) {
              setRoom((prev) => ({ ...prev, members: data.members }));
            }
            break;
          }

          case 'room:settings_updated': {
            setRoom((prev) => ({
              ...prev,
              name: data.name ?? prev.name,
              isPrivate: typeof data.isPrivate === 'boolean' ? data.isPrivate : prev.isPrivate,
              isLocked: typeof data.isLocked === 'boolean' ? data.isLocked : prev.isLocked,
              allowParticipantQueue:
                typeof data.allowParticipantQueue === 'boolean'
                  ? data.allowParticipantQueue
                  : prev.allowParticipantQueue,
            }));
            break;
          }

          case 'room:host_transferred': {
            setRoom((prev) => {
              const nextMessages =
                data.systemMessage && !prev.messages.some((m) => m.id === data.systemMessage.id)
                  ? [...prev.messages, data.systemMessage]
                  : prev.messages;
              return {
                ...prev,
                hostId: data.hostId || prev.hostId,
                members: Array.isArray(data.members) ? data.members : prev.members,
                messages: nextMessages,
              };
            });
            break;
          }

          case 'room:ended': {
            webrtcRef.current?.destroyAll();
            onLeaveRoom(`Watch room was ended by ${data.endedBy || 'the host'}.`);
            break;
          }

          case 'queue:updated': {
            setRoom((prev) => ({
              ...prev,
              queue: Array.isArray(data.queue) ? data.queue : prev.queue,
              mediaItems: Array.isArray(data.mediaItems) ? data.mediaItems : prev.mediaItems,
            }));
            break;
          }

          case 'chat:message': {
            if (data.message) {
              setRoom((prev) => {
                if (prev.messages.some((m) => m.id === data.message.id)) return prev;
                return {
                  ...prev,
                  messages: [...prev.messages, data.message],
                };
              });
            }
            break;
          }

          case 'chat:reaction_updated': {
            setRoom((prev) => ({
              ...prev,
              messages: prev.messages.map((m) =>
                m.id === data.messageId ? { ...m, reactions: data.reactions || {} } : m
              ),
            }));
            break;
          }

          case 'chat:rate_limited': {
            setChatError(data.message || 'Sending messages too quickly.');
            setTimeout(() => setChatError(null), 3500);
            break;
          }

          case 'chat:typing': {
            if (data.memberId && data.memberId !== actor.id) {
              setTypingUsers((prev) => {
                const next = { ...prev };
                if (data.isTyping) {
                  next[data.memberId] = data.displayName || 'Friend';
                } else {
                  delete next[data.memberId];
                }
                return next;
              });
            }
            break;
          }

          case 'voice:state_sync': {
            if (Array.isArray(data.members)) {
              setRoom((prev) => ({ ...prev, members: data.members }));
            }
            if (data.leftMemberId && webrtcRef.current) {
              webrtcRef.current.removePeer(data.leftMemberId);
            }
            break;
          }

          case 'voice:member_status': {
            setRoom((prev) => ({
              ...prev,
              members: prev.members.map((m) =>
                m.memberId === data.memberId
                  ? {
                      ...m,
                      isMuted: typeof data.isMuted === 'boolean' ? data.isMuted : m.isMuted,
                      isSpeaking: typeof data.isSpeaking === 'boolean' ? data.isSpeaking : m.isSpeaking,
                    }
                  : m
              ),
            }));
            break;
          }

          case 'voice:limit_reached': {
            setVoiceError(data.message || 'Voice room limit reached.');
            webrtcRef.current?.destroyAll();
            setInVoice(false);
            break;
          }

          case 'webrtc:signal': {
            if (webrtcRef.current) {
              webrtcRef.current.handleIncomingSignal(data as IncomingSignal);
            }
            break;
          }

          case 'error': {
            setActionBanner(data.message || 'Action rejected by server.');
            setTimeout(() => setActionBanner(null), 4000);
            break;
          }
        }
      };

      ws.onclose = (ev) => {
        if (unmountedRef.current) return;
        if (ev.code === 4001 || ev.code === 4003) {
          setConnectionState('disconnected');
          onLeaveRoom(ev.reason || 'Session disconnected.');
          return;
        }
        setConnectionState('reconnecting');
        reconnectTimerRef.current = window.setTimeout(() => {
          connectWebSocket(true);
        }, 2500);
      };
    };

    connectWebSocket(false);

    return () => {
      unmountedRef.current = true;
      if (reconnectTimerRef.current) clearTimeout(reconnectTimerRef.current);
      if (wsRef.current) {
        try {
          wsRef.current.close(1000, 'Leaving watch room');
        } catch {
          // ignore
        }
        wsRef.current = null;
      }
    };
  }, [initialRoom.id, sessionToken, actor.id, actor.displayName]);

  // Keep chat scrolled to latest message inside the chat box without jumping window scroll
  useEffect(() => {
    const el = chatScrollContainerRef.current;
    if (el) {
      el.scrollTop = el.scrollHeight;
    }
  }, [room.messages.length]);

  // Copy Invite Link
  const handleCopyInvite = async () => {
    const url = `${window.location.origin}/?room=${encodeURIComponent(room.id)}&code=${encodeURIComponent(
      room.inviteCode
    )}`;
    await navigator.clipboard.writeText(url);
    setCopiedInvite(true);
    setTimeout(() => setCopiedInvite(false), 2000);
  };

  // Host Broadcast Playback State
  const handleHostBroadcastPlayback = useCallback(
    (nextState: Partial<PlaybackStateSnapshot>) => {
      if (!isHost) return;
      setRoom((prev) => {
        const merged = {
          ...prev,
          activeMediaId: nextState.activeMediaId ?? prev.activeMediaId,
          activeMediaType: nextState.activeMediaType ?? prev.activeMediaType,
          activeMediaSource: nextState.activeMediaSource ?? prev.activeMediaSource,
          activeMediaTitle: nextState.activeMediaTitle ?? prev.activeMediaTitle,
          playbackPosition:
            typeof nextState.playbackPosition === 'number'
              ? nextState.playbackPosition
              : prev.playbackPosition,
          isPlaying: typeof nextState.isPlaying === 'boolean' ? nextState.isPlaying : prev.isPlaying,
          playbackUpdatedAt: Date.now(),
        };

        sendWsMessage({
          type: 'playback:update',
          activeMediaId: merged.activeMediaId,
          activeMediaType: merged.activeMediaType,
          activeMediaSource: merged.activeMediaSource,
          activeMediaTitle: merged.activeMediaTitle,
          playbackPosition: merged.playbackPosition,
          isPlaying: merged.isPlaying,
        });

        mirrorRoomPlaybackToFirestore({
          roomId: merged.id,
          activeMediaId: merged.activeMediaId,
          activeMediaType: merged.activeMediaType,
          activeMediaSource: merged.activeMediaSource,
          activeMediaTitle: merged.activeMediaTitle,
          playbackPosition: merged.playbackPosition,
          isPlaying: merged.isPlaying,
        }).catch(() => {});

        return merged;
      });
    },
    [isHost, sendWsMessage]
  );

  const handleRequestSyncFromServer = useCallback(() => {
    sendWsMessage({ type: 'playback:request_sync' });
  }, [sendWsMessage]);

  // Voice Call Actions
  const handleJoinVoice = async () => {
    if (!webrtcRef.current) return;
    setVoiceError(null);
    setJoiningVoice(true);

    try {
      const devices = await webrtcRef.current.startLocalVoice(selectedDeviceId || undefined);
      setAudioDevices(devices);
      if (!selectedDeviceId && devices.length > 0) {
        setSelectedDeviceId(devices[0].deviceId);
      }
      setInVoice(true);
      setIsVoiceMuted(false);
      sendWsMessage({
        type: 'voice:join',
        isMuted: false,
      });
    } catch (err: any) {
      const msg =
        err?.name === 'NotAllowedError' || err?.name === 'PermissionDeniedError'
          ? 'Microphone access was denied. Please allow microphone permission in your browser address bar to join voice chat.'
          : err?.message || 'Could not access microphone.';
      setVoiceError(msg);
      setInVoice(false);
    } finally {
      setJoiningVoice(false);
    }
  };

  const handleLeaveVoice = () => {
    webrtcRef.current?.destroyAll();
    setInVoice(false);
    setLocalSpeaking(false);
    setLocalAudioLevel(0);
    sendWsMessage({ type: 'voice:leave' });
  };

  const handleToggleVoiceMute = () => {
    const nextMuted = !isVoiceMuted;
    setIsVoiceMuted(nextMuted);
    webrtcRef.current?.setMuted(nextMuted);
    sendWsMessage({
      type: 'voice:status',
      isMuted: nextMuted,
      isSpeaking: false,
    });
  };

  const handleSwitchAudioDevice = async (deviceId: string) => {
    setSelectedDeviceId(deviceId);
    if (inVoice && webrtcRef.current) {
      try {
        await webrtcRef.current.startLocalVoice(deviceId);
      } catch (err: any) {
        setVoiceError(err?.message || 'Failed to switch audio input device.');
      }
    }
  };

  // Chat Actions
  const handleChatInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setChatInput(e.target.value);
    sendWsMessage({ type: 'chat:typing', isTyping: e.target.value.trim().length > 0 });
    if (typingTimeoutRef.current) clearTimeout(typingTimeoutRef.current);
    typingTimeoutRef.current = window.setTimeout(() => {
      sendWsMessage({ type: 'chat:typing', isTyping: false });
    }, 2000);
  };

  const handleSendChat = (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = chatInput.trim();
    if (!trimmed) return;
    if (trimmed.length > 500) {
      setChatError('Message cannot exceed 500 characters.');
      return;
    }

    const clientId = `msg_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    sendWsMessage({
      type: 'chat:send',
      clientId,
      message: trimmed,
    });
    sendWsMessage({ type: 'chat:typing', isTyping: false });

    mirrorChatMessageToFirestore({
      id: clientId,
      roomId: room.id,
      displayName: actor.displayName,
      message: trimmed,
    }).catch(() => {});

    setChatInput('');
  };

  const handleToggleReaction = (messageId: string, emoji: string) => {
    sendWsMessage({
      type: 'chat:reaction',
      messageId,
      emoji,
    });
    setActiveReactionPickerId(null);
  };

  // Queue & Media API Actions
  const handleAddYoutubeToQueue = async (params: {
    videoId: string;
    title: string;
    playImmediately: boolean;
  }) => {
    const resp = await fetch(`/api/rooms/${encodeURIComponent(room.id)}/queue`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${sessionToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        sourceType: 'youtube',
        sourceId: params.videoId,
        title: params.title,
        playImmediately: params.playImmediately,
      }),
    });
    const data = await resp.json();
    if (!resp.ok) {
      throw new Error(data.error || 'Failed to add video to queue.');
    }
    if (data.room) setRoom(data.room);
  };

  const handleQueueAction = async (
    action: 'select' | 'play-next' | 'reorder',
    payload?: { queueId?: string; orderedIds?: string[] }
  ) => {
    try {
      const resp = await fetch(`/api/rooms/${encodeURIComponent(room.id)}/queue`, {
        method: 'PATCH',
        headers: {
          Authorization: `Bearer ${sessionToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ action, ...payload }),
      });
      const data = await resp.json();
      if (!resp.ok) throw new Error(data.error || 'Queue update failed.');
      if (data.room) setRoom(data.room);
    } catch (err: any) {
      setActionBanner(err?.message || 'Could not update queue.');
      setTimeout(() => setActionBanner(null), 3500);
    }
  };

  const handleRemoveQueueItem = async (queueId: string) => {
    try {
      const resp = await fetch(
        `/api/rooms/${encodeURIComponent(room.id)}/queue/${encodeURIComponent(queueId)}`,
        {
          method: 'DELETE',
          headers: { Authorization: `Bearer ${sessionToken}` },
        }
      );
      const data = await resp.json();
      if (!resp.ok) throw new Error(data.error || 'Failed to remove item.');
      if (Array.isArray(data.queue)) {
        setRoom((prev) => ({ ...prev, queue: data.queue }));
      }
    } catch (err: any) {
      setActionBanner(err?.message || 'Failed to remove queue item.');
      setTimeout(() => setActionBanner(null), 3500);
    }
  };

  const handleMoveQueueItem = (index: number, direction: -1 | 1) => {
    const targetIdx = index + direction;
    if (targetIdx < 0 || targetIdx >= room.queue.length) return;
    const copy = [...room.queue];
    const [moved] = copy.splice(index, 1);
    copy.splice(targetIdx, 0, moved);
    handleQueueAction('reorder', { orderedIds: copy.map((q) => q.id) });
  };

  const handleDeleteUploadedMedia = async (mediaId: string) => {
    try {
      const resp = await fetch(
        `/api/rooms/${encodeURIComponent(room.id)}/media/${encodeURIComponent(mediaId)}`,
        {
          method: 'DELETE',
          headers: { Authorization: `Bearer ${sessionToken}` },
        }
      );
      const data = await resp.json();
      if (!resp.ok) throw new Error(data.error || 'Could not delete uploaded video.');
      setRoom((prev) => ({
        ...prev,
        mediaItems: prev.mediaItems.filter((m) => m.id !== data.deletedId),
        queue: prev.queue.filter((q) => q.mediaItemId !== data.deletedId),
      }));
    } catch (err: any) {
      setActionBanner(err?.message || 'Failed to delete video.');
      setTimeout(() => setActionBanner(null), 3500);
    }
  };

  const handleQueueUploadedMedia = async (mediaItem: ClientMediaItem, playImmediately: boolean) => {
    try {
      const resp = await fetch(`/api/rooms/${encodeURIComponent(room.id)}/queue`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${sessionToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          sourceType: 'upload',
          sourceId: mediaItem.id,
          title: mediaItem.title,
          playImmediately,
        }),
      });
      const data = await resp.json();
      if (!resp.ok) throw new Error(data.error || 'Could not queue uploaded file.');
      if (data.room) setRoom(data.room);
      setBottomDeckTab('queue');
    } catch (err: any) {
      setActionBanner(err?.message || 'Failed to queue uploaded video.');
      setTimeout(() => setActionBanner(null), 3500);
    }
  };

  // Host Room Settings & Moderation
  const handleUpdateRoomSettings = async (patch: {
    name?: string;
    isPrivate?: boolean;
    isLocked?: boolean;
    allowParticipantQueue?: boolean;
  }) => {
    try {
      const resp = await fetch(`/api/rooms/${encodeURIComponent(room.id)}/settings`, {
        method: 'PATCH',
        headers: {
          Authorization: `Bearer ${sessionToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(patch),
      });
      const data = await resp.json();
      if (!resp.ok) throw new Error(data.error || 'Failed to update settings.');
      if (data.room) setRoom(data.room);
    } catch (err: any) {
      setActionBanner(err?.message || 'Could not update settings.');
      setTimeout(() => setActionBanner(null), 3500);
    }
  };

  const handleTransferHost = async (targetMemberId: string) => {
    try {
      const resp = await fetch(`/api/rooms/${encodeURIComponent(room.id)}/transfer-host`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${sessionToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ targetMemberId }),
      });
      const data = await resp.json();
      if (!resp.ok) throw new Error(data.error || 'Failed to transfer host role.');
      if (data.room) setRoom(data.room);
    } catch (err: any) {
      setActionBanner(err?.message || 'Transfer host failed.');
      setTimeout(() => setActionBanner(null), 3500);
    }
  };

  const handleKickMember = async (targetMemberId: string) => {
    try {
      const resp = await fetch(`/api/rooms/${encodeURIComponent(room.id)}/kick`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${sessionToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ targetMemberId }),
      });
      const data = await resp.json();
      if (!resp.ok) throw new Error(data.error || 'Failed to remove participant.');
      if (data.room) setRoom(data.room);
    } catch (err: any) {
      setActionBanner(err?.message || 'Kick failed.');
      setTimeout(() => setActionBanner(null), 3500);
    }
  };

  const handleEndRoom = async () => {
    try {
      const resp = await fetch(`/api/rooms/${encodeURIComponent(room.id)}/end`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${sessionToken}` },
      });
      if (!resp.ok) {
        const data = await resp.json();
        throw new Error(data.error || 'Failed to end room.');
      }
      webrtcRef.current?.destroyAll();
      onLeaveRoom('You ended the watch room.');
    } catch (err: any) {
      setActionBanner(err?.message || 'Could not end room.');
      setTimeout(() => setActionBanner(null), 3500);
    }
  };

  const uploadedFiles = room.mediaItems.filter((m) => m.sourceType === 'upload');
  const activeVoiceMembers = room.members.filter((m) => m.inVoice && m.isOnline);
  const currentlySpeakingMembers = activeVoiceMembers.filter((m) =>
    m.memberId === actor.id ? localSpeaking && !isVoiceMuted : m.isSpeaking && !m.isMuted
  );
  const typingNames = Object.values(typingUsers);

  return (
    <div className="min-h-screen bg-[#09090F] text-[#F3F4F8] flex flex-col">
      {/* Watch Room Top Navigation Bar */}
      <header className="sticky top-0 z-30 bg-[#0D0D16]/95 backdrop-blur-md border-b border-white/10 px-4 sm:px-6 py-3">
        <div className="max-w-6xl mx-auto flex items-center justify-between gap-4">
          {/* Left: Brand + Room Context */}
          <div className="flex items-center gap-3 min-w-0">
            <button
              type="button"
              onClick={() => {
                webrtcRef.current?.destroyAll();
                onLeaveRoom();
              }}
              className="focus:outline-none cursor-pointer shrink-0"
              title="Leave room and return to home"
            >
              <BrandLogo size="sm" />
            </button>

            <span className="text-white/20 hidden sm:inline">/</span>

            <div
              className="min-w-0 flex items-center gap-2"
              title={room.isLocked ? 'Room is locked' : 'Room is unlocked'}
            >
              {room.isLocked ? (
                <Lock className="w-3.5 h-3.5 text-amber-400 shrink-0" />
              ) : (
                <Unlock className="w-3.5 h-3.5 text-slate-400 shrink-0" />
              )}
              <h1 className="text-sm font-display font-semibold text-white truncate max-w-[140px] sm:max-w-[260px]">
                {room.name}
              </h1>
            </div>
          </div>

          {/* Right Controls: Connection State, Copy Invite, Leave */}
          <div className="flex items-center gap-2.5 shrink-0">
            <div className="hidden md:flex items-center gap-1.5 text-xs text-slate-300 px-2.5 py-1 rounded-md bg-white/5 border border-white/10">
              {connectionState === 'connected' && (
                <>
                  <Wifi className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
                  <span>Connected</span>
                </>
              )}
              {connectionState === 'connecting' && (
                <>
                  <RefreshCw className="w-3.5 h-3.5 text-violet-400 animate-spin shrink-0" />
                  <span>Connecting...</span>
                </>
              )}
              {connectionState === 'reconnecting' && (
                <>
                  <RefreshCw className="w-3.5 h-3.5 text-amber-400 animate-spin shrink-0" />
                  <span>Reconnecting...</span>
                </>
              )}
              {connectionState === 'disconnected' && (
                <>
                  <WifiOff className="w-3.5 h-3.5 text-rose-400 shrink-0" />
                  <span>Disconnected</span>
                </>
              )}
            </div>

            <button
              type="button"
              onClick={handleCopyInvite}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-white bg-violet-600/20 hover:bg-violet-600/30 border border-violet-500/40 rounded-lg transition-colors cursor-pointer whitespace-nowrap shrink-0"
              title="Copy room invite link"
            >
              {copiedInvite ? (
                <>
                  <Check className="w-3.5 h-3.5 text-emerald-400" />
                  <span>Copied Link</span>
                </>
              ) : (
                <>
                  <Copy className="w-3.5 h-3.5 text-violet-300" />
                  <span className="font-mono">{room.inviteCode}</span>
                </>
              )}
            </button>

            <button
              type="button"
              onClick={() => {
                webrtcRef.current?.destroyAll();
                onLeaveRoom();
              }}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-slate-300 hover:text-white bg-white/5 hover:bg-rose-500/20 hover:border-rose-500/30 border border-white/10 rounded-lg transition-colors cursor-pointer whitespace-nowrap shrink-0"
            >
              <LogOut className="w-3.5 h-3.5" />
              <span className="hidden sm:inline">Leave</span>
            </button>
          </div>
        </div>
      </header>

      {/* Action Alert Banner */}
      {actionBanner && (
        <div className="bg-amber-500/15 border-b border-amber-500/30 px-6 py-2 text-xs text-amber-200 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <AlertCircle className="w-4 h-4 text-amber-400 shrink-0" />
            <span>{actionBanner}</span>
          </div>
          <button onClick={() => setActionBanner(null)} className="text-amber-300 hover:text-white cursor-pointer">
            Dismiss
          </button>
        </div>
      )}

      {/* Vertical Cinema Stack: 1. Video Player -> 2. Live Chat & Active Speakers Box Below Video -> 3. Queue/Members Deck */}
      <div className="flex-1 max-w-6xl w-full mx-auto flex flex-col gap-4 p-3 sm:p-6 overflow-x-hidden">
        {/* 1. Synchronized Video Stage */}
        <VideoStage
          roomId={room.id}
          sessionToken={sessionToken}
          isHost={isHost}
          playback={{
            activeMediaId: room.activeMediaId,
            activeMediaType: room.activeMediaType,
            activeMediaSource: room.activeMediaSource,
            activeMediaTitle: room.activeMediaTitle,
            playbackPosition: room.playbackPosition,
            isPlaying: room.isPlaying,
            updatedAt: room.playbackUpdatedAt,
          }}
          onHostBroadcastPlayback={handleHostBroadcastPlayback}
          onRequestSyncFromServer={handleRequestSyncFromServer}
          onPlayNextInQueue={() => handleQueueAction('play-next')}
          onOpenAddMediaModal={(tab) => {
            setAddMediaTab(tab);
            setAddMediaOpen(true);
          }}
        />

        {/* 2. Directly Below Video: Unified Live Chat & Active Voice Speakers Box */}
        <section
          aria-label="Live Room Chat and Voice Activity"
          className="bg-[#11111C] border border-white/10 rounded-xl overflow-hidden flex flex-col shadow-xl"
        >
          {/* Top Bar of Chat Box: Live Voice Controls + Real-Time "Who is Speaking" Indicator */}
          <div className="px-4 py-2.5 bg-[#161625] border-b border-white/10 flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-3 min-w-0 flex-wrap">
              <div className="flex items-center gap-1.5 text-xs font-display font-semibold text-white shrink-0">
                <MessageSquare className="w-4 h-4 text-violet-400" />
                <span>Live Room Chat</span>
                <span className="text-slate-400 font-mono font-normal">
                  · {room.members.filter((m) => m.isOnline).length} online
                </span>
              </div>

              {/* Live Speaking Now Banner */}
              {currentlySpeakingMembers.length > 0 ? (
                <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-violet-600/20 border border-violet-500/40 text-xs text-violet-200">
                  <Volume2 className="w-3.5 h-3.5 text-violet-400 shrink-0" />
                  <span className="font-medium truncate max-w-[220px] sm:max-w-[320px]">
                    Speaking now:{' '}
                    {currentlySpeakingMembers
                      .map((m) => (m.memberId === actor.id ? `${m.displayName} (You)` : m.displayName))
                      .join(', ')}
                  </span>
                </div>
              ) : activeVoiceMembers.length > 0 ? (
                <div className="text-xs text-slate-400 font-mono">
                  Voice Active ({activeVoiceMembers.length}/4):{' '}
                  {activeVoiceMembers.map((m) => m.displayName).join(', ')}
                </div>
              ) : (
                <div className="text-xs text-slate-400 hidden sm:block">
                  Voice channel idle · Click Join Voice to talk while watching
                </div>
              )}
            </div>

            {/* Inline Voice Call Controls right above the chat */}
            <div className="flex items-center gap-2 shrink-0">
              {inVoice && audioDevices.length > 1 && (
                <select
                  value={selectedDeviceId}
                  onChange={(e) => handleSwitchAudioDevice(e.target.value)}
                  aria-label="Select microphone input device"
                  className="hidden sm:block px-2 py-1 text-xs bg-[#09090F] border border-white/10 rounded-lg text-slate-200 max-w-[150px] truncate"
                >
                  {audioDevices.map((dev, i) => (
                    <option key={dev.deviceId || i} value={dev.deviceId}>
                      {dev.label || `Mic ${i + 1}`}
                    </option>
                  ))}
                </select>
              )}

              {inVoice ? (
                <>
                  <button
                    type="button"
                    onClick={handleToggleVoiceMute}
                    className={`inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg border transition-colors cursor-pointer whitespace-nowrap shrink-0 ${
                      isVoiceMuted
                        ? 'bg-rose-500/20 border-rose-500/40 text-rose-200'
                        : localSpeaking
                        ? 'bg-violet-600/30 border-violet-400 text-white'
                        : 'bg-white/5 hover:bg-white/10 border-white/10 text-white'
                    }`}
                  >
                    {isVoiceMuted ? (
                      <MicOff className="w-3.5 h-3.5 text-rose-400" />
                    ) : (
                      <Mic className="w-3.5 h-3.5 text-emerald-400" />
                    )}
                    <span>
                      {isVoiceMuted
                        ? 'Unmute Mic'
                        : localSpeaking
                        ? `Speaking (${localAudioLevel}%)`
                        : 'Mute Mic'}
                    </span>
                  </button>

                  <button
                    type="button"
                    onClick={handleLeaveVoice}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-rose-200 bg-rose-500/20 hover:bg-rose-500/30 border border-rose-500/30 rounded-lg transition-colors cursor-pointer whitespace-nowrap shrink-0"
                  >
                    <PhoneOff className="w-3.5 h-3.5" />
                    <span>Leave Voice</span>
                  </button>
                </>
              ) : (
                <button
                  type="button"
                  disabled={joiningVoice}
                  onClick={handleJoinVoice}
                  className="inline-flex items-center gap-1.5 px-3.5 py-1.5 text-xs font-medium text-white bg-violet-600 hover:bg-violet-500 disabled:opacity-50 rounded-lg transition-colors cursor-pointer whitespace-nowrap shrink-0"
                >
                  <PhoneCall className="w-3.5 h-3.5" />
                  <span>{joiningVoice ? 'Requesting Mic...' : 'Join Voice'}</span>
                </button>
              )}
            </div>
          </div>

          {/* Participant Strip Showing Online / Voice / Speaking Status */}
          <div className="px-4 py-2 bg-[#0D0D17] border-b border-white/10 flex items-center gap-2 overflow-x-auto">
            {room.members.map((m) => {
              const isSelf = m.memberId === actor.id;
              const speaking = isSelf ? localSpeaking && !isVoiceMuted : m.isSpeaking && !m.isMuted;
              const muted = isSelf ? isVoiceMuted : m.isMuted;
              const peerState = isSelf ? 'connected' : peerStatuses[m.memberId] || 'connecting';

              return (
                <div
                  key={m.memberId}
                  className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md border text-xs shrink-0 transition-colors ${
                    speaking
                      ? 'bg-violet-600/25 border-violet-400 text-white'
                      : m.isOnline
                      ? 'bg-[#141422] border-white/10 text-slate-200'
                      : 'bg-[#09090F] border-white/5 text-slate-500'
                  }`}
                >
                  {m.role === 'host' && <Crown className="w-3 h-3 text-amber-400 shrink-0" />}
                  <span className="font-medium truncate max-w-[120px]">
                    {m.displayName}
                    {isSelf ? ' (You)' : ''}
                  </span>
                  {m.inVoice && (
                    <span className="inline-flex items-center gap-1 text-[11px] font-mono text-violet-300 pl-1">
                      {muted ? (
                        <MicOff className="w-3 h-3 text-rose-400" />
                      ) : (
                        <Mic className={`w-3 h-3 ${speaking ? 'text-violet-300' : 'text-emerald-400'}`} />
                      )}
                      <span>
                        {muted
                          ? 'Muted'
                          : speaking
                          ? 'Speaking'
                          : isSelf || peerState === 'connected'
                          ? 'Voice'
                          : 'Connecting'}
                      </span>
                    </span>
                  )}
                </div>
              );
            })}
          </div>

          {voiceError && (
            <div className="px-4 py-2 bg-rose-500/10 border-b border-rose-500/30 flex items-center justify-between gap-3 text-xs text-rose-200">
              <div className="flex items-center gap-2">
                <AlertCircle className="w-4 h-4 text-rose-400 shrink-0" />
                <span>{voiceError}</span>
              </div>
              <button
                onClick={() => setVoiceError(null)}
                className="text-rose-300 hover:text-white shrink-0 cursor-pointer"
              >
                Dismiss
              </button>
            </div>
          )}

          {/* Live Chat Feed Directly Under the Video */}
          <div
            ref={chatScrollContainerRef}
            className="h-64 sm:h-72 overflow-y-auto p-4 space-y-2.5 bg-[#0B0B13]"
          >
            {room.messages.length === 0 ? (
              <div className="text-center text-xs text-slate-500 py-10">
                No messages yet. Type below to chat live while watching!
              </div>
            ) : (
              room.messages.map((msg) => {
                if (msg.isSystem) {
                  return (
                    <div
                      key={msg.id}
                      className="text-[11px] text-slate-400 bg-white/5 border border-white/5 rounded-lg px-3 py-1.5 leading-relaxed"
                    >
                      {msg.message}
                    </div>
                  );
                }

                const isSelf = msg.senderId === actor.id;
                const senderMember = room.members.find((m) => m.memberId === msg.senderId);
                const senderSpeaking =
                  senderMember &&
                  senderMember.inVoice &&
                  (isSelf ? localSpeaking && !isVoiceMuted : senderMember.isSpeaking && !senderMember.isMuted);

                const timeStr = new Date(msg.createdAt).toLocaleTimeString([], {
                  hour: '2-digit',
                  minute: '2-digit',
                });

                return (
                  <div
                    key={msg.id}
                    className="group bg-[#12121F] border border-white/10 rounded-lg px-3.5 py-2 space-y-1"
                  >
                    <div className="flex items-center justify-between gap-2 text-[11px]">
                      <div className="flex items-center gap-2 min-w-0">
                        <span className={`font-semibold truncate ${isSelf ? 'text-violet-300' : 'text-white'}`}>
                          {msg.displayName}
                        </span>
                        {senderSpeaking && (
                          <span className="text-[10px] font-mono text-emerald-400">· Speaking on Mic</span>
                        )}
                      </div>

                      <div className="flex items-center gap-2 shrink-0">
                        <button
                          type="button"
                          onClick={() =>
                            setActiveReactionPickerId(activeReactionPickerId === msg.id ? null : msg.id)
                          }
                          className="text-slate-400 hover:text-white transition-colors cursor-pointer"
                          title="React to message"
                        >
                          <Smile className="w-3.5 h-3.5" />
                        </button>
                        <span className="font-mono tabular-nums text-slate-500">{timeStr}</span>
                      </div>
                    </div>

                    {/* Safe Plain-Text Message Content */}
                    <p className="text-xs sm:text-sm text-slate-200 break-words leading-relaxed">
                      {msg.message}
                    </p>

                    {/* Emoji Reaction Picker Popover */}
                    {activeReactionPickerId === msg.id && (
                      <div className="flex items-center gap-1 p-1 bg-[#1B1B2E] border border-white/15 rounded-lg w-fit">
                        {ALLOWED_REACTIONS.map((emoji) => (
                          <button
                            key={emoji}
                            type="button"
                            onClick={() => handleToggleReaction(msg.id, emoji)}
                            className="px-1.5 py-0.5 text-sm hover:bg-white/10 rounded cursor-pointer"
                          >
                            {emoji}
                          </button>
                        ))}
                      </div>
                    )}

                    {/* Active Emoji Reactions */}
                    {msg.reactions && Object.keys(msg.reactions).length > 0 && (
                      <div className="flex flex-wrap gap-1.5 pt-0.5">
                        {Object.entries(msg.reactions).map(([emoji, reactors]) => {
                          const reacted = reactors.includes(actor.id);
                          return (
                            <button
                              key={emoji}
                              type="button"
                              onClick={() => handleToggleReaction(msg.id, emoji)}
                              className={`inline-flex items-center gap-1 px-2 py-0.5 text-[11px] rounded border transition-colors cursor-pointer ${
                                reacted
                                  ? 'bg-violet-600/25 border-violet-500/50 text-white'
                                  : 'bg-white/5 border-white/10 text-slate-300'
                              }`}
                            >
                              <span>{emoji}</span>
                              <span className="font-mono tabular-nums">{reactors.length}</span>
                            </button>
                          );
                        })}
                      </div>
                    )}
                  </div>
                );
              })
            )}
          </div>

          {/* Typing Indicator */}
          {typingNames.length > 0 && (
            <div className="px-4 py-1 bg-[#12121F] border-t border-white/5 text-[11px] text-violet-300 italic truncate">
              {typingNames.join(', ')} {typingNames.length === 1 ? 'is' : 'are'} typing...
            </div>
          )}

          {chatError && (
            <div className="px-4 py-1.5 bg-rose-500/15 text-[11px] text-rose-200">{chatError}</div>
          )}

          {/* Chat Input Form */}
          <form onSubmit={handleSendChat} className="p-3 bg-[#151524] border-t border-white/10 flex flex-col gap-1.5">
            <div className="flex items-center gap-2">
              <input
                type="text"
                maxLength={500}
                value={chatInput}
                onChange={handleChatInputChange}
                placeholder="Write a live message while watching..."
                className="flex-1 px-3.5 py-2 text-xs sm:text-sm bg-[#09090F] border border-white/10 rounded-lg text-white placeholder-slate-500 focus:outline-none focus:border-violet-500"
              />
              <button
                type="submit"
                disabled={!chatInput.trim()}
                className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-violet-600 hover:bg-violet-500 disabled:opacity-40 text-xs font-medium text-white transition-colors shrink-0 cursor-pointer"
              >
                <Send className="w-3.5 h-3.5" />
                <span>Send</span>
              </button>
            </div>
            <div className="flex justify-between text-[10px] font-mono tabular-nums text-slate-500">
              <span>Live room chat · Visible to all members watching</span>
              <span>{chatInput.length} / 500</span>
            </div>
          </form>
        </section>

        {/* 3. Shared Queue, Uploaded Videos, Members & Host Settings Deck */}
        <div className="bg-[#11111C] border border-white/10 rounded-xl p-4 space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-white/10 pb-3">
            {/* Segmented Tabs */}
            <div className="flex flex-wrap items-center gap-1 p-1 bg-[#09090F] border border-white/10 rounded-lg">
              <button
                type="button"
                onClick={() => setBottomDeckTab('queue')}
                className={`inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-md transition-colors cursor-pointer whitespace-nowrap ${
                  bottomDeckTab === 'queue' ? 'bg-violet-600 text-white' : 'text-slate-400 hover:text-white'
                }`}
              >
                <ListVideo className="w-3.5 h-3.5" />
                <span>Shared Queue ({room.queue.length})</span>
              </button>

              <button
                type="button"
                onClick={() => setBottomDeckTab('uploads')}
                className={`inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-md transition-colors cursor-pointer whitespace-nowrap ${
                  bottomDeckTab === 'uploads' ? 'bg-violet-600 text-white' : 'text-slate-400 hover:text-white'
                }`}
              >
                <FileVideo className="w-3.5 h-3.5" />
                <span>Uploaded Files ({uploadedFiles.length})</span>
              </button>

              <button
                type="button"
                onClick={() => setBottomDeckTab('members')}
                className={`inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-md transition-colors cursor-pointer whitespace-nowrap ${
                  bottomDeckTab === 'members' ? 'bg-violet-600 text-white' : 'text-slate-400 hover:text-white'
                }`}
              >
                <Users className="w-3.5 h-3.5" />
                <span>Members ({room.members.length}/8)</span>
              </button>

              <button
                type="button"
                onClick={() => setBottomDeckTab('settings')}
                className={`inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-md transition-colors cursor-pointer whitespace-nowrap ${
                  bottomDeckTab === 'settings' ? 'bg-violet-600 text-white' : 'text-slate-400 hover:text-white'
                }`}
              >
                <Settings className="w-3.5 h-3.5" />
                <span>{isHost ? 'Host Controls' : 'Room Info'}</span>
              </button>
            </div>

            {(isHost || room.allowParticipantQueue) && (
              <button
                type="button"
                onClick={() => {
                  setAddMediaTab('youtube');
                  setAddMediaOpen(true);
                }}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-white bg-violet-600 hover:bg-violet-500 rounded-lg transition-colors cursor-pointer whitespace-nowrap shrink-0"
              >
                <Plus className="w-3.5 h-3.5" />
                <span>Add Video</span>
              </button>
            )}
          </div>

          {/* Tab 1: Shared Queue */}
          {bottomDeckTab === 'queue' && (
            <div className="space-y-2">
              {room.queue.length === 0 ? (
                <div className="p-6 text-center text-xs text-slate-400 space-y-2">
                  <p>The shared playback queue is empty.</p>
                  {(isHost || room.allowParticipantQueue) && (
                    <button
                      type="button"
                      onClick={() => {
                        setAddMediaTab('youtube');
                        setAddMediaOpen(true);
                      }}
                      className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-medium text-white bg-white/10 hover:bg-white/15 rounded-lg transition-colors cursor-pointer"
                    >
                      <Plus className="w-3.5 h-3.5" />
                      <span>Add First Video to Queue</span>
                    </button>
                  )}
                </div>
              ) : (
                <div className="divide-y divide-white/10">
                  {room.queue.map((item, idx) => {
                    const isPlayingThis = room.activeMediaId === item.mediaItemId;
                    return (
                      <div
                        key={item.id}
                        className={`py-2.5 px-3 flex items-center justify-between gap-3 rounded-lg ${
                          isPlayingThis ? 'bg-violet-600/15' : 'hover:bg-white/5'
                        }`}
                      >
                        <div className="flex items-center gap-3 min-w-0">
                          <span className="text-xs font-mono tabular-nums text-slate-500 w-5">
                            {String(idx + 1).padStart(2, '0')}
                          </span>
                          {item.sourceType === 'youtube' ? (
                            <Youtube className="w-4 h-4 text-rose-400 shrink-0" />
                          ) : (
                            <FileVideo className="w-4 h-4 text-violet-400 shrink-0" />
                          )}
                          <div className="min-w-0">
                            <div className="text-xs font-medium text-white truncate">{item.title}</div>
                            <div className="text-[11px] text-slate-400">
                              Added by {item.addedByName} ·{' '}
                              {item.sourceType === 'youtube' ? 'YouTube' : 'Private Upload'}
                              {isPlayingThis && ' · Now Playing'}
                            </div>
                          </div>
                        </div>

                        {isHost && (
                          <div className="flex items-center gap-1 shrink-0">
                            {!isPlayingThis && (
                              <button
                                type="button"
                                onClick={() => handleQueueAction('select', { queueId: item.id })}
                                title="Play this item now"
                                className="p-1.5 text-slate-300 hover:text-white hover:bg-white/10 rounded transition-colors cursor-pointer"
                              >
                                <Play className="w-3.5 h-3.5" />
                              </button>
                            )}
                            <button
                              type="button"
                              disabled={idx === 0}
                              onClick={() => handleMoveQueueItem(idx, -1)}
                              title="Move up"
                              className="p-1.5 text-slate-400 hover:text-white disabled:opacity-30 rounded transition-colors cursor-pointer"
                            >
                              <ArrowUp className="w-3.5 h-3.5" />
                            </button>
                            <button
                              type="button"
                              disabled={idx === room.queue.length - 1}
                              onClick={() => handleMoveQueueItem(idx, 1)}
                              title="Move down"
                              className="p-1.5 text-slate-400 hover:text-white disabled:opacity-30 rounded transition-colors cursor-pointer"
                            >
                              <ArrowDown className="w-3.5 h-3.5" />
                            </button>
                            <button
                              type="button"
                              onClick={() => handleRemoveQueueItem(item.id)}
                              title="Remove from queue"
                              className="p-1.5 text-slate-400 hover:text-rose-400 rounded transition-colors cursor-pointer"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          )}

          {/* Tab 2: Private Uploaded Video Library */}
          {bottomDeckTab === 'uploads' && (
            <div className="space-y-3">
              {uploadedFiles.length === 0 ? (
                <div className="p-6 text-center text-xs text-slate-400 space-y-2">
                  <p>No private MP4 or WebM videos have been uploaded to this room yet.</p>
                  <button
                    type="button"
                    onClick={() => {
                      setAddMediaTab('upload');
                      setAddMediaOpen(true);
                    }}
                    className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-medium text-white bg-white/10 hover:bg-white/15 rounded-lg transition-colors cursor-pointer"
                  >
                    <Plus className="w-3.5 h-3.5" />
                    <span>Upload MP4 / WebM (Max 50 MB)</span>
                  </button>
                </div>
              ) : (
                <div className="divide-y divide-white/10">
                  {uploadedFiles.map((media) => {
                    const canDelete = isHost || media.ownerId === actor.id;
                    const sizeMb = media.fileSize ? (media.fileSize / (1024 * 1024)).toFixed(2) : '0.0';
                    return (
                      <div key={media.id} className="py-2.5 px-3 flex items-center justify-between gap-3">
                        <div className="min-w-0">
                          <div className="text-xs font-medium text-white truncate">{media.title}</div>
                          <div className="text-[11px] text-slate-400 font-mono tabular-nums">
                            Uploaded by {media.ownerName} · {sizeMb} MB · {media.mimeType}
                          </div>
                        </div>
                        <div className="flex items-center gap-2 shrink-0">
                          {(isHost || room.allowParticipantQueue) && (
                            <button
                              type="button"
                              onClick={() => handleQueueUploadedMedia(media, isHost)}
                              className="px-2.5 py-1 text-xs font-medium text-white bg-violet-600 hover:bg-violet-500 rounded transition-colors cursor-pointer"
                            >
                              {isHost ? 'Play Now' : 'Queue'}
                            </button>
                          )}
                          {canDelete && (
                            <button
                              type="button"
                              onClick={() => handleDeleteUploadedMedia(media.id)}
                              title="Delete uploaded file from storage"
                              className="p-1.5 text-slate-400 hover:text-rose-400 rounded transition-colors cursor-pointer"
                            >
                              <Trash2 className="w-4 h-4" />
                            </button>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          )}

          {/* Tab 3: Room Members & Host Moderation */}
          {bottomDeckTab === 'members' && (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
              {room.members.map((m) => {
                const isMemberHost = m.memberId === room.hostId;
                const isSelf = m.memberId === actor.id;
                return (
                  <div
                    key={m.memberId}
                    className="p-3 rounded-lg bg-[#09090F] border border-white/10 flex items-center justify-between gap-2"
                  >
                    <div className="min-w-0">
                      <div className="flex items-center gap-1.5">
                        <span className="text-xs font-medium text-white truncate">
                          {m.displayName} {isSelf && '(You)'}
                        </span>
                        {isMemberHost && <Crown className="w-3.5 h-3.5 text-amber-400 shrink-0" />}
                      </div>
                      <div className="text-[11px] text-slate-400 flex items-center gap-1.5 mt-0.5">
                        <span>{isMemberHost ? 'Host' : m.role === 'guest' ? 'Guest' : 'Member'}</span>
                        <span>·</span>
                        <span>{m.isOnline ? 'Online' : 'Offline'}</span>
                        {m.inVoice && (
                          <>
                            <span>·</span>
                            <span className="text-violet-300">
                              {m.isMuted ? 'Voice (Muted)' : 'In Voice'}
                            </span>
                          </>
                        )}
                      </div>
                    </div>

                    {isHost && !isSelf && (
                      <div className="flex items-center gap-1.5 shrink-0">
                        <button
                          type="button"
                          onClick={() => handleTransferHost(m.memberId)}
                          title="Make Host"
                          className="px-2 py-1 text-[11px] font-medium text-amber-200 bg-amber-500/15 hover:bg-amber-500/25 border border-amber-500/30 rounded transition-colors cursor-pointer"
                        >
                          Make Host
                        </button>
                        <button
                          type="button"
                          onClick={() => handleKickMember(m.memberId)}
                          title="Remove participant from room"
                          className="p-1.5 text-slate-400 hover:text-rose-400 rounded transition-colors cursor-pointer"
                        >
                          <UserX className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}

          {/* Tab 4: Host Controls & Room Settings */}
          {bottomDeckTab === 'settings' && (
            <div className="space-y-4 text-xs">
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <div className="p-3.5 rounded-lg bg-[#09090F] border border-white/10 flex items-center justify-between">
                  <div>
                    <div className="font-medium text-white">Room Lock</div>
                    <div className="text-slate-400 text-[11px]">Block new members from joining</div>
                  </div>
                  <input
                    type="checkbox"
                    disabled={!isHost}
                    checked={room.isLocked}
                    onChange={(e) => handleUpdateRoomSettings({ isLocked: e.target.checked })}
                    className="rounded accent-violet-500 cursor-pointer disabled:cursor-not-allowed"
                  />
                </div>

                <div className="p-3.5 rounded-lg bg-[#09090F] border border-white/10 flex items-center justify-between">
                  <div>
                    <div className="font-medium text-white">Private Invite Gate</div>
                    <div className="text-slate-400 text-[11px]">Require invite code to join</div>
                  </div>
                  <input
                    type="checkbox"
                    disabled={!isHost}
                    checked={room.isPrivate}
                    onChange={(e) => handleUpdateRoomSettings({ isPrivate: e.target.checked })}
                    className="rounded accent-violet-500 cursor-pointer disabled:cursor-not-allowed"
                  />
                </div>

                <div className="p-3.5 rounded-lg bg-[#09090F] border border-white/10 flex items-center justify-between">
                  <div>
                    <div className="font-medium text-white">Shared Queue Access</div>
                    <div className="text-slate-400 text-[11px]">Let participants add videos</div>
                  </div>
                  <input
                    type="checkbox"
                    disabled={!isHost}
                    checked={room.allowParticipantQueue}
                    onChange={(e) => handleUpdateRoomSettings({ allowParticipantQueue: e.target.checked })}
                    className="rounded accent-violet-500 cursor-pointer disabled:cursor-not-allowed"
                  />
                </div>
              </div>

              {isHost && (
                <div className="pt-2 border-t border-white/10 flex flex-wrap items-center justify-between gap-4">
                  <div className="text-slate-400">
                    Ending the room disconnects all members and deletes uploaded video files immediately.
                  </div>
                  <button
                    type="button"
                    onClick={handleEndRoom}
                    className="px-4 py-2 text-xs font-medium text-rose-200 bg-rose-500/20 hover:bg-rose-500/30 border border-rose-500/30 rounded-lg transition-colors cursor-pointer"
                  >
                    End Watch Room for All
                  </button>
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Add Media Modal */}
      <AddMediaModal
        isOpen={addMediaOpen}
        initialTab={addMediaTab}
        onClose={() => setAddMediaOpen(false)}
        roomId={room.id}
        sessionToken={sessionToken}
        isHost={isHost}
        allowParticipantQueue={room.allowParticipantQueue}
        onAddYoutubeToQueue={handleAddYoutubeToQueue}
        onUploadCompleted={() => {
          setBottomDeckTab('uploads');
        }}
      />
    </div>
  );
};
