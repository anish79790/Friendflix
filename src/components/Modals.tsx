import React, { useState, useRef, useEffect } from 'react';
import {
  X,
  Copy,
  Check,
  Lock,
  Globe,
  ArrowRight,
  AlertCircle,
  Loader2,
  Youtube,
  Upload,
  FileVideo,
  RotateCcw,
  ShieldCheck,
  Database,
  RefreshCw,
  KeyRound,
  UserCheck,
  Clock,
} from 'lucide-react';
import { CURATED_YOUTUBE_PRESETS, parseYouTubeVideoId } from '../lib/youtube';
import { generateUniqueInviteCode, isYouTubeLink } from '../lib/roomEngine';

// ============================================================================
// 1. Create Room Dialog (Separated Unique Room Code & Optional YouTube Link)
// ============================================================================
interface CreateRoomModalProps {
  isOpen: boolean;
  onClose: () => void;
  defaultDisplayName: string;
  isAuthenticatedUser: boolean;
  onCreateRoom: (params: {
    roomName: string;
    displayName: string;
    isPrivate: boolean;
    customInviteCode: string;
    initialYoutubeId: string;
    initialYoutubeTitle: string;
  }) => Promise<{ id: string; inviteCode: string; name: string; isPrivate: boolean }>;
  onEnterCreatedRoom: (roomId: string) => void;
}

export const CreateRoomModal: React.FC<CreateRoomModalProps> = ({
  isOpen,
  onClose,
  defaultDisplayName,
  isAuthenticatedUser,
  onCreateRoom,
  onEnterCreatedRoom,
}) => {
  const [roomName, setRoomName] = useState('Friday Night Cinema');
  const [displayName, setDisplayName] = useState(defaultDisplayName || '');
  const [isPrivate, setIsPrivate] = useState(true);
  const [uniqueRoomCode, setUniqueRoomCode] = useState<string>(() => generateUniqueInviteCode());
  const [copiedPreviewCode, setCopiedPreviewCode] = useState(false);

  // Separate YouTube Link state — empty by default so it is never confused with the Room Code
  const [youtubeUrlInput, setYoutubeUrlInput] = useState('');
  const [youtubeTitle, setYoutubeTitle] = useState('');

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [createdRoom, setCreatedRoom] = useState<{
    id: string;
    inviteCode: string;
    name: string;
    isPrivate: boolean;
  } | null>(null);
  const [copiedLink, setCopiedLink] = useState(false);
  const [copiedCode, setCopiedCode] = useState(false);

  // Generate a brand-new unique random room code every time the Create Room modal opens
  useEffect(() => {
    if (isOpen) {
      setUniqueRoomCode(generateUniqueInviteCode());
      setCreatedRoom(null);
      setError(null);
      setYoutubeUrlInput('');
      setYoutubeTitle('');
      if (defaultDisplayName && !displayName) {
        setDisplayName(defaultDisplayName);
      }
    }
  }, [isOpen]);

  if (!isOpen) return null;

  const handleRegenerateCode = () => {
    setUniqueRoomCode(generateUniqueInviteCode());
    setCopiedPreviewCode(false);
  };

  const handleCopyPreviewCode = async () => {
    await navigator.clipboard.writeText(uniqueRoomCode);
    setCopiedPreviewCode(true);
    setTimeout(() => setCopiedPreviewCode(false), 2000);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    const cleanRoomName = roomName.trim();
    const cleanName = (displayName || defaultDisplayName).trim();

    if (cleanRoomName.length < 2 || cleanRoomName.length > 80) {
      setError('Room name must be between 2 and 80 characters.');
      return;
    }
    if (cleanName.length < 2 || cleanName.length > 40) {
      setError('Your nickname must be between 2 and 40 characters.');
      return;
    }

    let parsedYtId = '';
    const trimmedYt = youtubeUrlInput.trim();
    if (trimmedYt) {
      if (trimmedYt.toUpperCase().startsWith('FFX-')) {
        setError(
          'You pasted a Room Joining Code into the YouTube Video Link box. Leave the YouTube box blank or paste a YouTube video link.'
        );
        return;
      }
      const id = parseYouTubeVideoId(trimmedYt);
      if (!id) {
        setError('Please paste a valid YouTube video link (e.g. https://www.youtube.com/watch?v=...) or leave it blank.');
        return;
      }
      parsedYtId = id;
    }

    setLoading(true);
    try {
      const result = await onCreateRoom({
        roomName: cleanRoomName,
        displayName: cleanName,
        isPrivate,
        customInviteCode: uniqueRoomCode,
        initialYoutubeId: parsedYtId,
        initialYoutubeTitle: youtubeTitle.trim() || (parsedYtId ? 'Featured Watch Party Video' : ''),
      });
      setCreatedRoom(result);
    } catch (err: any) {
      setError(err?.message || 'Failed to create room. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  const shareUrl = createdRoom
    ? `${window.location.origin}/?room=${encodeURIComponent(createdRoom.id)}&code=${encodeURIComponent(
        createdRoom.inviteCode
      )}`
    : '';

  const handleCopyLink = async () => {
    if (!shareUrl) return;
    await navigator.clipboard.writeText(shareUrl);
    setCopiedLink(true);
    setTimeout(() => setCopiedLink(false), 2000);
  };

  const handleCopyCode = async () => {
    if (!createdRoom) return;
    await navigator.clipboard.writeText(createdRoom.inviteCode);
    setCopiedCode(true);
    setTimeout(() => setCopiedCode(false), 2000);
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4 overflow-y-auto">
      <div className="bg-[#12121E] border border-white/10 rounded-xl max-w-lg w-full p-6 space-y-5 shadow-2xl my-auto">
        <div className="flex items-center justify-between border-b border-white/10 pb-4">
          <div>
            <h2 className="text-lg font-display font-semibold text-white">
              {createdRoom ? 'Watch Room Ready' : 'Create a Watch Room'}
            </h2>
            <p className="text-xs text-slate-400 mt-0.5">
              {createdRoom
                ? 'Share your unique Room Code or invite link with friends.'
                : 'Configure your synchronized room, unique joining code, and privacy mode.'}
            </p>
          </div>
          <button
            onClick={() => {
              setCreatedRoom(null);
              setError(null);
              onClose();
            }}
            className="p-1.5 text-slate-400 hover:text-white rounded-lg hover:bg-white/5 transition-colors cursor-pointer"
            aria-label="Close modal"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {createdRoom ? (
          <div className="space-y-5">
            <div className="p-4 rounded-lg bg-[#0B0B13] border border-violet-500/30 space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-xs text-slate-400">Room Name</span>
                <span className="text-sm font-medium text-white">{createdRoom.name}</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-xs text-slate-400">Privacy Mode</span>
                <span className="text-xs font-medium text-violet-300">
                  {createdRoom.isPrivate
                    ? 'Private Room (Friends send Join Request)'
                    : 'Public Room (Friends join directly)'}
                </span>
              </div>
              <div className="pt-2 border-t border-white/10 flex items-center justify-between">
                <span className="text-xs font-medium text-slate-300">Unique Room Joining Code</span>
                <div className="flex items-center gap-2">
                  <span className="text-base font-mono font-bold text-violet-300 tracking-wider bg-violet-500/10 px-2.5 py-1 rounded border border-violet-500/30">
                    {createdRoom.inviteCode}
                  </span>
                  <button
                    onClick={handleCopyCode}
                    className="inline-flex items-center gap-1 px-2.5 py-1.5 text-xs font-medium text-white bg-violet-600 hover:bg-violet-500 rounded-md transition-colors cursor-pointer"
                  >
                    {copiedCode ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
                    <span>{copiedCode ? 'Copied' : 'Copy Code'}</span>
                  </button>
                </div>
              </div>
            </div>

            <div className="space-y-1.5">
              <label className="block text-xs font-medium text-slate-300">Direct Shareable Room Link</label>
              <div className="flex items-center gap-2">
                <input
                  type="text"
                  readOnly
                  value={shareUrl}
                  className="w-full px-3 py-2 text-xs font-mono bg-[#09090F] border border-white/10 rounded-lg text-slate-300 focus:outline-none"
                />
                <button
                  onClick={handleCopyLink}
                  className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-medium text-white bg-white/10 hover:bg-white/15 rounded-lg transition-colors shrink-0 cursor-pointer whitespace-nowrap"
                >
                  {copiedLink ? <Check className="w-4 h-4 text-emerald-400" /> : <Copy className="w-4 h-4" />}
                  <span>{copiedLink ? 'Copied Link' : 'Copy Link'}</span>
                </button>
              </div>
            </div>

            <div className="pt-2 flex items-center justify-end gap-3">
              <button
                onClick={() => {
                  const id = createdRoom.id;
                  setCreatedRoom(null);
                  onEnterCreatedRoom(id);
                }}
                className="w-full inline-flex items-center justify-center gap-2 px-5 py-2.5 text-sm font-medium text-white bg-violet-600 hover:bg-violet-500 rounded-lg transition-colors cursor-pointer"
              >
                <span>Enter Watch Room Now</span>
                <ArrowRight className="w-4 h-4" />
              </button>
            </div>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="space-y-4">
            {error && (
              <div className="p-3 rounded-lg bg-rose-500/10 border border-rose-500/30 flex items-center gap-2.5 text-xs text-rose-200">
                <AlertCircle className="w-4 h-4 text-rose-400 shrink-0" />
                <span>{error}</span>
              </div>
            )}

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <label htmlFor="create-room-name" className="block text-xs font-medium text-slate-300">
                  Room Name
                </label>
                <input
                  id="create-room-name"
                  type="text"
                  required
                  maxLength={80}
                  value={roomName}
                  onChange={(e) => setRoomName(e.target.value)}
                  placeholder="e.g., Friday Night Cinema"
                  className="w-full px-3.5 py-2 text-sm bg-[#09090F] border border-white/10 rounded-lg text-white placeholder-slate-500 focus:outline-none focus:border-violet-500"
                />
              </div>

              <div className="space-y-1.5">
                <label htmlFor="create-host-nickname" className="block text-xs font-medium text-slate-300">
                  {isAuthenticatedUser ? 'Your Host Name' : 'Your Host Nickname'}
                </label>
                <input
                  id="create-host-nickname"
                  type="text"
                  required
                  maxLength={40}
                  value={displayName}
                  onChange={(e) => setDisplayName(e.target.value)}
                  placeholder="Enter your nickname"
                  className="w-full px-3.5 py-2 text-sm bg-[#09090F] border border-white/10 rounded-lg text-white placeholder-slate-500 focus:outline-none focus:border-violet-500"
                />
              </div>
            </div>

            {/* Room Privacy Selector: Private (Join Request) vs Public (Direct Join) */}
            <div className="space-y-1.5">
              <label className="block text-xs font-medium text-slate-300">Room Access & Join Mode</label>
              <div className="grid grid-cols-2 gap-2.5">
                <button
                  type="button"
                  onClick={() => setIsPrivate(true)}
                  className={`flex items-start gap-2.5 p-3 rounded-lg border text-left transition-colors cursor-pointer ${
                    isPrivate
                      ? 'bg-violet-600/15 border-violet-500/60 text-white'
                      : 'bg-[#09090F] border-white/10 text-slate-400 hover:text-slate-200'
                  }`}
                >
                  <Lock className="w-4 h-4 text-violet-400 shrink-0 mt-0.5" />
                  <div>
                    <div className="text-xs font-semibold">Private Room</div>
                    <div className="text-[11px] text-slate-400 leading-snug mt-0.5">
                      Code sends Join Request for Host approval
                    </div>
                  </div>
                </button>
                <button
                  type="button"
                  onClick={() => setIsPrivate(false)}
                  className={`flex items-start gap-2.5 p-3 rounded-lg border text-left transition-colors cursor-pointer ${
                    !isPrivate
                      ? 'bg-violet-600/15 border-violet-500/60 text-white'
                      : 'bg-[#09090F] border-white/10 text-slate-400 hover:text-slate-200'
                  }`}
                >
                  <Globe className="w-4 h-4 text-emerald-400 shrink-0 mt-0.5" />
                  <div>
                    <div className="text-xs font-semibold">Public Room</div>
                    <div className="text-[11px] text-slate-400 leading-snug mt-0.5">
                      Code joins directly without request
                    </div>
                  </div>
                </button>
              </div>
            </div>

            {/* SECTION 1: Dedicated Unique Room Joining Code Box (Completely Separate from YouTube Video) */}
            <div className="p-3.5 rounded-xl bg-[#09090F] border border-violet-500/35 space-y-2">
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-1.5 text-xs font-medium text-violet-200">
                  <KeyRound className="w-3.5 h-3.5 text-violet-400 shrink-0" />
                  <span>Unique Room Joining Code (Share with Friends)</span>
                </div>
                <span className="text-[11px] font-mono text-emerald-400">Auto-Generated Unique</span>
              </div>

              <div className="flex items-center justify-between gap-2 pt-0.5">
                <div className="px-3 py-2 rounded-lg bg-[#12121E] border border-white/10 font-mono text-sm sm:text-base font-bold tracking-wider text-white select-all flex-1">
                  {uniqueRoomCode}
                </div>
                <button
                  type="button"
                  onClick={handleCopyPreviewCode}
                  className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-medium text-slate-200 bg-white/5 hover:bg-white/10 border border-white/10 rounded-lg transition-colors cursor-pointer shrink-0"
                  title="Copy unique room code"
                >
                  {copiedPreviewCode ? (
                    <>
                      <Check className="w-3.5 h-3.5 text-emerald-400" />
                      <span>Copied</span>
                    </>
                  ) : (
                    <>
                      <Copy className="w-3.5 h-3.5" />
                      <span>Copy</span>
                    </>
                  )}
                </button>
                <button
                  type="button"
                  onClick={handleRegenerateCode}
                  className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-medium text-violet-200 bg-violet-600/20 hover:bg-violet-600/30 border border-violet-500/40 rounded-lg transition-colors cursor-pointer shrink-0"
                  title="Generate a new random unique room code"
                >
                  <RefreshCw className="w-3.5 h-3.5" />
                  <span>New Code</span>
                </button>
              </div>

              <p className="text-[11px] text-slate-400 leading-relaxed">
                {isPrivate
                  ? 'Private Mode: Friends enter this code in "Join Room" to send a Join Request. You approve them inside the room.'
                  : 'Public Mode: Friends enter this code in "Join Room" to join directly without waiting for approval.'}
              </p>
            </div>

            {/* SECTION 2: Completely Separate Optional YouTube Video URL Input */}
            <div className="pt-2 border-t border-white/10 space-y-2">
              <div className="flex items-center justify-between">
                <label htmlFor="initial-yt-input" className="flex items-center gap-1.5 text-xs font-medium text-slate-300">
                  <Youtube className="w-4 h-4 text-rose-400 shrink-0" />
                  <span>Starting YouTube Video Link (Optional — Separate from Room Code)</span>
                </label>
                {youtubeUrlInput && (
                  <button
                    type="button"
                    onClick={() => {
                      setYoutubeUrlInput('');
                      setYoutubeTitle('');
                    }}
                    className="text-[11px] text-slate-400 hover:text-white cursor-pointer"
                  >
                    Clear Video
                  </button>
                )}
              </div>
              <input
                id="initial-yt-input"
                type="text"
                value={youtubeUrlInput}
                onChange={(e) => setYoutubeUrlInput(e.target.value)}
                placeholder="https://www.youtube.com/watch?v=... (Leave empty to add video later)"
                className="w-full px-3.5 py-2 text-xs sm:text-sm bg-[#09090F] border border-white/10 rounded-lg text-white placeholder-slate-500 focus:outline-none focus:border-violet-500"
              />
              <div className="space-y-1 pt-0.5">
                <span className="block text-[11px] text-slate-400">
                  Or load a sample open-cinema film link (optional):
                </span>
                <div className="flex flex-wrap gap-1.5">
                  {CURATED_YOUTUBE_PRESETS.map((preset) => {
                    const fullUrl = `https://www.youtube.com/watch?v=${preset.id}`;
                    const isSelected = youtubeUrlInput === fullUrl;
                    return (
                      <button
                        key={preset.id}
                        type="button"
                        onClick={() => {
                          setYoutubeUrlInput(fullUrl);
                          setYoutubeTitle(preset.title);
                        }}
                        className={`px-2.5 py-1 text-[11px] rounded-md border transition-colors cursor-pointer ${
                          isSelected
                            ? 'bg-rose-500/20 border-rose-500/50 text-rose-200'
                            : 'bg-white/5 border-white/10 text-slate-400 hover:text-slate-200'
                        }`}
                      >
                        ▶ {preset.title.split('—')[0].trim()}
                      </button>
                    );
                  })}
                </div>
              </div>
            </div>

            <div className="pt-2 flex items-center justify-end gap-3">
              <button
                type="button"
                onClick={onClose}
                className="px-4 py-2 text-xs font-medium text-slate-300 hover:text-white bg-white/5 hover:bg-white/10 rounded-lg transition-colors cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={loading}
                className="inline-flex items-center gap-2 px-5 py-2 text-xs font-medium text-white bg-violet-600 hover:bg-violet-500 disabled:opacity-50 rounded-lg transition-colors cursor-pointer"
              >
                {loading && <Loader2 className="w-4 h-4 animate-spin" />}
                <span>{loading ? 'Creating Room...' : 'Create Watch Room'}</span>
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
};

// ============================================================================
// 2. Join Room Dialog (Direct Join for Public Rooms, Join Request for Private Rooms)
// ============================================================================
export type JoinRoomResult =
  | { status: 'joined' }
  | {
      status: 'pending_approval';
      roomId: string;
      roomName: string;
      inviteCode: string;
      message: string;
    };

interface JoinRoomModalProps {
  isOpen: boolean;
  onClose: () => void;
  initialCodeOrLink?: string;
  defaultDisplayName: string;
  onJoinRoom: (params: { roomCodeOrLink: string; displayName: string }) => Promise<JoinRoomResult>;
  onCheckJoinRequestStatus: (roomId: string) => Promise<{
    status: 'approved' | 'rejected' | 'pending';
    error?: string;
  }>;
}

export const JoinRoomModal: React.FC<JoinRoomModalProps> = ({
  isOpen,
  onClose,
  initialCodeOrLink = '',
  defaultDisplayName,
  onJoinRoom,
  onCheckJoinRequestStatus,
}) => {
  const [roomCodeOrLink, setRoomCodeOrLink] = useState(initialCodeOrLink);
  const [displayName, setDisplayName] = useState(defaultDisplayName || '');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Pending approval state for Private Rooms
  const [pendingRequest, setPendingRequest] = useState<{
    roomId: string;
    roomName: string;
    inviteCode: string;
    message: string;
  } | null>(null);

  useEffect(() => {
    if (initialCodeOrLink) setRoomCodeOrLink(initialCodeOrLink);
  }, [initialCodeOrLink]);

  useEffect(() => {
    if (defaultDisplayName && !displayName) setDisplayName(defaultDisplayName);
  }, [defaultDisplayName]);

  useEffect(() => {
    if (!isOpen) {
      setPendingRequest(null);
      setError(null);
      setLoading(false);
    }
  }, [isOpen]);

  // Poll join request status every 2 seconds while waiting for Private Room host approval
  useEffect(() => {
    if (!isOpen || !pendingRequest) return;

    let cancelled = false;
    const interval = window.setInterval(async () => {
      if (cancelled) return;
      try {
        const res = await onCheckJoinRequestStatus(pendingRequest.roomId);
        if (cancelled) return;
        if (res.status === 'approved') {
          setPendingRequest(null);
        } else if (res.status === 'rejected') {
          setPendingRequest(null);
          setError(res.error || 'The room host declined your join request.');
        }
      } catch {
        // ignore transient polling errors
      }
    }, 2000);

    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [isOpen, pendingRequest, onCheckJoinRequestStatus]);

  if (!isOpen) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    const cleanInput = roomCodeOrLink.trim();
    const cleanName = displayName.trim();

    if (!cleanInput) {
      setError('Please enter a Unique Room Code (e.g. FFX-7K9M-4P2X) or paste a shareable room link.');
      return;
    }

    if (isYouTubeLink(cleanInput)) {
      setError(
        'That looks like a YouTube video link! Please enter your friend’s Unique Room Code (e.g. FFX-7K9M-4P2X) here. YouTube links are added inside the room’s video player.'
      );
      return;
    }

    if (cleanName.length < 2 || cleanName.length > 40) {
      setError('Please enter a nickname between 2 and 40 characters.');
      return;
    }

    setLoading(true);
    try {
      const result = await onJoinRoom({ roomCodeOrLink: cleanInput, displayName: cleanName });
      if (result.status === 'pending_approval') {
        setPendingRequest({
          roomId: result.roomId,
          roomName: result.roomName,
          inviteCode: result.inviteCode,
          message: result.message,
        });
      }
    } catch (err: any) {
      setError(err?.message || 'Unable to join room. Verify the unique Room Code and try again.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4">
      <div className="bg-[#12121E] border border-white/10 rounded-xl max-w-md w-full p-6 space-y-5 shadow-2xl">
        <div className="flex items-center justify-between border-b border-white/10 pb-4">
          <div>
            <h2 className="text-lg font-display font-semibold text-white">
              {pendingRequest ? 'Join Request Sent' : 'Join a Watch Room'}
            </h2>
            <p className="text-xs text-slate-400 mt-0.5">
              {pendingRequest
                ? 'Waiting for the room host to approve your request.'
                : 'Public rooms join immediately. Private rooms send a join request to the host.'}
            </p>
          </div>
          <button
            onClick={() => {
              setPendingRequest(null);
              onClose();
            }}
            className="p-1.5 text-slate-400 hover:text-white rounded-lg hover:bg-white/5 transition-colors cursor-pointer"
            aria-label="Close modal"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {pendingRequest ? (
          <div className="space-y-4">
            <div className="p-4 rounded-xl bg-[#09090F] border border-violet-500/40 flex flex-col items-center text-center space-y-3">
              <div className="w-12 h-12 rounded-full bg-violet-600/20 border border-violet-500/40 flex items-center justify-center text-violet-300">
                <Clock className="w-6 h-6 animate-pulse" />
              </div>
              <div className="space-y-1">
                <div className="text-sm font-display font-semibold text-white">
                  Waiting for Host Approval...
                </div>
                <p className="text-xs text-slate-400 leading-relaxed">
                  Your request to join <span className="text-white font-medium">{pendingRequest.roomName}</span> (
                  <span className="font-mono text-violet-300">{pendingRequest.inviteCode}</span>) has been sent to the
                  host. You will enter the room automatically as soon as the host clicks Approve.
                </p>
              </div>
            </div>

            <div className="flex items-center justify-between gap-3 pt-1">
              <button
                type="button"
                onClick={() => setPendingRequest(null)}
                className="w-full px-4 py-2 text-xs font-medium text-slate-300 hover:text-white bg-white/5 hover:bg-white/10 rounded-lg transition-colors cursor-pointer"
              >
                Cancel Request
              </button>
            </div>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="space-y-4">
            {error && (
              <div className="p-3 rounded-lg bg-rose-500/10 border border-rose-500/30 flex items-center gap-2.5 text-xs text-rose-200">
                <AlertCircle className="w-4 h-4 text-rose-400 shrink-0" />
                <span>{error}</span>
              </div>
            )}

            <div className="space-y-1.5">
              <label htmlFor="join-code-input" className="block text-xs font-medium text-slate-300">
                Unique Room Joining Code (or Share Link)
              </label>
              <input
                id="join-code-input"
                type="text"
                required
                value={roomCodeOrLink}
                onChange={(e) => setRoomCodeOrLink(e.target.value)}
                placeholder="e.g., FFX-7K9M-4P2X"
                className="w-full px-3.5 py-2 text-sm font-mono bg-[#09090F] border border-white/10 rounded-lg text-white placeholder-slate-500 focus:outline-none focus:border-violet-500 uppercase"
              />
              <p className="text-[11px] text-slate-400">
                Do not paste YouTube video links here. Enter only the Room Joining Code shared by the host.
              </p>
            </div>

            <div className="space-y-1.5">
              <label htmlFor="join-nickname-input" className="block text-xs font-medium text-slate-300">
                Your Display Name
              </label>
              <input
                id="join-nickname-input"
                type="text"
                required
                maxLength={40}
                value={displayName}
                onChange={(e) => setDisplayName(e.target.value)}
                placeholder="How friends will see you in chat & voice"
                className="w-full px-3.5 py-2 text-sm bg-[#09090F] border border-white/10 rounded-lg text-white placeholder-slate-500 focus:outline-none focus:border-violet-500"
              />
            </div>

            <div className="p-3 rounded-lg bg-[#09090F] border border-white/10 text-[11px] text-slate-400 space-y-1">
              <div className="flex items-center gap-1.5 text-slate-300 font-medium">
                <UserCheck className="w-3.5 h-3.5 text-violet-400" />
                <span>How Room Joining Works:</span>
              </div>
              <div>· Public Room: Joins the watch party immediately.</div>
              <div>· Private Room: Sends a join request to the host for instant approval.</div>
            </div>

            <div className="pt-2 flex items-center justify-end gap-3">
              <button
                type="button"
                onClick={onClose}
                className="px-4 py-2 text-xs font-medium text-slate-300 hover:text-white bg-white/5 hover:bg-white/10 rounded-lg transition-colors cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={loading}
                className="inline-flex items-center gap-2 px-5 py-2 text-xs font-medium text-white bg-violet-600 hover:bg-violet-500 disabled:opacity-50 rounded-lg transition-colors cursor-pointer"
              >
                {loading && <Loader2 className="w-4 h-4 animate-spin" />}
                <span>{loading ? 'Checking Room Code...' : 'Join / Send Request'}</span>
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
};

// ============================================================================
// 3. Add Media Modal (YouTube URL & Private Video File Upload with Progress)
// ============================================================================
interface AddMediaModalProps {
  isOpen: boolean;
  initialTab: 'youtube' | 'upload';
  onClose: () => void;
  roomId: string;
  sessionToken: string;
  isHost: boolean;
  allowParticipantQueue: boolean;
  onAddYoutubeToQueue: (params: {
    videoId: string;
    title: string;
    playImmediately: boolean;
  }) => Promise<void>;
  onUploadCompleted: () => void;
}

const MAX_UPLOAD_BYTES = 50 * 1024 * 1024; // 50 MB

export const AddMediaModal: React.FC<AddMediaModalProps> = ({
  isOpen,
  initialTab,
  onClose,
  roomId,
  sessionToken,
  isHost,
  allowParticipantQueue,
  onAddYoutubeToQueue,
  onUploadCompleted,
}) => {
  const [activeTab, setActiveTab] = useState<'youtube' | 'upload'>(initialTab);
  const [ytInput, setYtInput] = useState('');
  const [ytTitle, setYtTitle] = useState('');
  const [playImmediately, setPlayImmediately] = useState(true);
  const [ytLoading, setYtLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Upload state
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [uploadTitle, setUploadTitle] = useState('');
  const [uploading, setUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [uploadedBytes, setUploadedBytes] = useState(0);
  const xhrRef = useRef<XMLHttpRequest | null>(null);

  useEffect(() => {
    setActiveTab(initialTab);
    setError(null);
  }, [initialTab, isOpen]);

  if (!isOpen) return null;

  const canModifyQueue = isHost || allowParticipantQueue;

  const handleYoutubeSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (!canModifyQueue) {
      setError('Only the room host can add items to the queue right now.');
      return;
    }

    if (ytInput.trim().toUpperCase().startsWith('FFX-')) {
      setError('That is a Room Joining Code. Please paste a YouTube video link (e.g. https://www.youtube.com/watch?v=...).');
      return;
    }

    const parsedId = parseYouTubeVideoId(ytInput);
    if (!parsedId) {
      setError(
        'Invalid YouTube URL or video ID. Supported formats: https://www.youtube.com/watch?v=..., https://youtu.be/..., or 11-char ID.'
      );
      return;
    }

    setYtLoading(true);
    try {
      await onAddYoutubeToQueue({
        videoId: parsedId,
        title: ytTitle.trim() || `YouTube Video (${parsedId})`,
        playImmediately: isHost && playImmediately,
      });
      setYtInput('');
      setYtTitle('');
      onClose();
    } catch (err: any) {
      setError(err?.message || 'Failed to add YouTube video.');
    } finally {
      setYtLoading(false);
    }
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setError(null);
    const file = e.target.files?.[0] || null;
    if (!file) {
      setSelectedFile(null);
      return;
    }

    const ext = file.name.toLowerCase().endsWith('.mp4')
      ? '.mp4'
      : file.name.toLowerCase().endsWith('.webm')
      ? '.webm'
      : '';
    const validMime = file.type === 'video/mp4' || file.type === 'video/webm';

    if (!ext || !validMime) {
      setError('Unsupported file format. Only MP4 (.mp4) and WebM (.webm) video files are supported.');
      setSelectedFile(null);
      return;
    }

    if (file.size > MAX_UPLOAD_BYTES) {
      const sizeMb = (file.size / (1024 * 1024)).toFixed(1);
      setError(
        `Selected file is ${sizeMb} MB, which exceeds the conservative 50 MB free-tier per-file upload limit.`
      );
      setSelectedFile(null);
      return;
    }

    setSelectedFile(file);
    if (!uploadTitle) {
      setUploadTitle(file.name.replace(/\.(mp4|webm)$/i, ''));
    }
  };

  const startFileUpload = () => {
    if (!selectedFile) {
      setError('Please select a valid MP4 or WebM file up to 50 MB.');
      return;
    }

    setError(null);
    setUploading(true);
    setUploadProgress(0);
    setUploadedBytes(0);

    const formData = new FormData();
    formData.append('video', selectedFile);
    formData.append('title', uploadTitle.trim() || selectedFile.name);
    formData.append('playImmediately', String(isHost && playImmediately));

    const xhr = new XMLHttpRequest();
    xhrRef.current = xhr;

    xhr.upload.onprogress = (event) => {
      if (event.lengthComputable) {
        const pct = Math.round((event.loaded / event.total) * 100);
        setUploadProgress(pct);
        setUploadedBytes(event.loaded);
      }
    };

    xhr.onload = () => {
      setUploading(false);
      xhrRef.current = null;
      if (xhr.status >= 200 && xhr.status < 300) {
        setSelectedFile(null);
        setUploadTitle('');
        setUploadProgress(100);
        onUploadCompleted();
        onClose();
      } else {
        try {
          const resp = JSON.parse(xhr.responseText);
          setError(resp.error || `Upload failed with status ${xhr.status}.`);
        } catch {
          setError(`Upload failed with status ${xhr.status}. Note: Private file uploads require the Node/Express server runtime.`);
        }
      }
    };

    xhr.onerror = () => {
      setUploading(false);
      xhrRef.current = null;
      setError('Network error interrupted the video upload. Check your connection and click Retry.');
    };

    xhr.onabort = () => {
      setUploading(false);
      xhrRef.current = null;
      setUploadProgress(0);
      setError('Upload was cancelled.');
    };

    xhr.open('POST', `/api/rooms/${encodeURIComponent(roomId)}/upload`);
    xhr.setRequestHeader('Authorization', `Bearer ${sessionToken}`);
    xhr.send(formData);
  };

  const cancelFileUpload = () => {
    if (xhrRef.current) {
      xhrRef.current.abort();
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4 overflow-y-auto">
      <div className="bg-[#12121E] border border-white/10 rounded-xl max-w-lg w-full p-6 space-y-5 shadow-2xl">
        <div className="flex items-center justify-between border-b border-white/10 pb-4">
          <h2 className="text-lg font-display font-semibold text-white">Add Video to Watch Room</h2>
          <button
            onClick={() => {
              if (uploading) cancelFileUpload();
              onClose();
            }}
            className="p-1.5 text-slate-400 hover:text-white rounded-lg hover:bg-white/5 transition-colors cursor-pointer"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Segmented Control */}
        <div className="flex items-center gap-1 p-1 bg-[#09090F] border border-white/10 rounded-lg">
          <button
            type="button"
            onClick={() => {
              setActiveTab('youtube');
              setError(null);
            }}
            className={`flex-1 inline-flex items-center justify-center gap-2 py-2 text-xs font-medium rounded-md transition-colors cursor-pointer ${
              activeTab === 'youtube' ? 'bg-violet-600 text-white' : 'text-slate-400 hover:text-white'
            }`}
          >
            <Youtube className="w-4 h-4" />
            <span>YouTube Video Link</span>
          </button>
          <button
            type="button"
            onClick={() => {
              setActiveTab('upload');
              setError(null);
            }}
            className={`flex-1 inline-flex items-center justify-center gap-2 py-2 text-xs font-medium rounded-md transition-colors cursor-pointer ${
              activeTab === 'upload' ? 'bg-violet-600 text-white' : 'text-slate-400 hover:text-white'
            }`}
          >
            <Upload className="w-4 h-4" />
            <span>Private Video Upload (50 MB max)</span>
          </button>
        </div>

        {error && (
          <div className="p-3 rounded-lg bg-rose-500/10 border border-rose-500/30 flex items-center gap-2.5 text-xs text-rose-200">
            <AlertCircle className="w-4 h-4 text-rose-400 shrink-0" />
            <span>{error}</span>
          </div>
        )}

        {activeTab === 'youtube' ? (
          <form onSubmit={handleYoutubeSubmit} className="space-y-4">
            <div className="space-y-1.5">
              <label className="block text-xs font-medium text-slate-300">
                YouTube Video URL (Separate from Room Invite Code)
              </label>
              <input
                type="text"
                required
                value={ytInput}
                onChange={(e) => setYtInput(e.target.value)}
                placeholder="https://www.youtube.com/watch?v=..."
                className="w-full px-3.5 py-2 text-sm bg-[#09090F] border border-white/10 rounded-lg text-white placeholder-slate-500 focus:outline-none focus:border-violet-500"
              />
            </div>

            <div className="space-y-1.5">
              <label className="block text-xs font-medium text-slate-300">Display Title (Optional)</label>
              <input
                type="text"
                maxLength={160}
                value={ytTitle}
                onChange={(e) => setYtTitle(e.target.value)}
                placeholder="Custom title for the shared queue"
                className="w-full px-3.5 py-2 text-sm bg-[#09090F] border border-white/10 rounded-lg text-white placeholder-slate-500 focus:outline-none focus:border-violet-500"
              />
            </div>

            {/* Quick Open-Movie Presets */}
            <div className="space-y-2">
              <div className="text-xs text-slate-400">Or pick an embed-ready open cinema short:</div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                {CURATED_YOUTUBE_PRESETS.map((preset) => (
                  <button
                    key={preset.id}
                    type="button"
                    onClick={() => {
                      setYtInput(`https://www.youtube.com/watch?v=${preset.id}`);
                      setYtTitle(preset.title);
                    }}
                    className="p-2.5 rounded-lg bg-[#09090F] hover:bg-white/5 border border-white/10 text-left transition-colors cursor-pointer"
                  >
                    <div className="text-xs font-medium text-white truncate">{preset.title}</div>
                    <div className="text-[11px] text-slate-400 mt-0.5">
                      {preset.category} · <span className="font-mono">{preset.durationLabel}</span>
                    </div>
                  </button>
                ))}
              </div>
            </div>

            {isHost && (
              <label className="flex items-center gap-2.5 text-xs text-slate-300 cursor-pointer pt-1">
                <input
                  type="checkbox"
                  checked={playImmediately}
                  onChange={(e) => setPlayImmediately(e.target.checked)}
                  className="rounded accent-violet-500"
                />
                <span>Load onto main stage and start synchronized playback immediately</span>
              </label>
            )}

            <div className="pt-2 flex items-center justify-end gap-3">
              <button
                type="button"
                onClick={onClose}
                className="px-4 py-2 text-xs font-medium text-slate-300 bg-white/5 hover:bg-white/10 rounded-lg transition-colors cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={ytLoading || !canModifyQueue}
                className="inline-flex items-center gap-2 px-5 py-2 text-xs font-medium text-white bg-violet-600 hover:bg-violet-500 disabled:opacity-50 rounded-lg transition-colors cursor-pointer"
              >
                {ytLoading && <Loader2 className="w-4 h-4 animate-spin" />}
                <span>{isHost && playImmediately ? 'Play Video Now' : 'Add to Shared Queue'}</span>
              </button>
            </div>
          </form>
        ) : (
          <div className="space-y-4">
            <div className="p-3.5 rounded-lg bg-[#09090F] border border-white/10 text-xs text-slate-300 space-y-1">
              <div className="font-medium text-white flex items-center gap-2">
                <ShieldCheck className="w-4 h-4 text-violet-400 shrink-0" />
                <span>Private Room Storage & Time-Limited Signed Access</span>
              </div>
              <p className="text-slate-400 leading-relaxed">
                Accepted formats: <span className="text-slate-200 font-mono">MP4 (.mp4)</span> and{' '}
                <span className="text-slate-200 font-mono">WebM (.webm)</span> up to{' '}
                <span className="text-slate-200 font-mono">50 MB</span>. Files are validated by binary container header
                and streamed exclusively to verified room members via short-lived signed URLs.
              </p>
            </div>

            <div className="space-y-1.5">
              <label className="block text-xs font-medium text-slate-300">Choose Video File</label>
              <label className="flex flex-col items-center justify-center border border-dashed border-white/20 hover:border-violet-500/60 rounded-xl p-5 bg-[#09090F] cursor-pointer transition-colors">
                <FileVideo className="w-7 h-7 text-violet-400 mb-2" />
                <span className="text-xs font-medium text-white">
                  {selectedFile ? selectedFile.name : 'Click to select an MP4 or WebM file (max 50 MB)'}
                </span>
                {selectedFile && (
                  <span className="text-[11px] font-mono text-slate-400 mt-1">
                    {(selectedFile.size / (1024 * 1024)).toFixed(2)} MB · {selectedFile.type}
                  </span>
                )}
                <input
                  type="file"
                  accept="video/mp4,video/webm,.mp4,.webm"
                  onChange={handleFileChange}
                  disabled={uploading}
                  className="hidden"
                />
              </label>
            </div>

            <div className="space-y-1.5">
              <label className="block text-xs font-medium text-slate-300">Video Title</label>
              <input
                type="text"
                maxLength={160}
                value={uploadTitle}
                onChange={(e) => setUploadTitle(e.target.value)}
                disabled={uploading}
                placeholder="Title displayed in room player and queue"
                className="w-full px-3.5 py-2 text-sm bg-[#09090F] border border-white/10 rounded-lg text-white placeholder-slate-500 focus:outline-none focus:border-violet-500"
              />
            </div>

            {isHost && (
              <label className="flex items-center gap-2.5 text-xs text-slate-300 cursor-pointer">
                <input
                  type="checkbox"
                  checked={playImmediately}
                  onChange={(e) => setPlayImmediately(e.target.checked)}
                  disabled={uploading}
                  className="rounded accent-violet-500"
                />
                <span>Start synchronized playback for all room members once upload completes</span>
              </label>
            )}

            {uploading && (
              <div className="space-y-2 p-3.5 rounded-lg bg-[#09090F] border border-white/10">
                <div className="flex items-center justify-between text-xs">
                  <span className="text-slate-300 font-medium">Uploading & verifying media container...</span>
                  <span className="font-mono tabular-nums text-violet-300">
                    {uploadProgress}% ({(uploadedBytes / (1024 * 1024)).toFixed(1)} MB)
                  </span>
                </div>
                <div className="w-full h-2 bg-white/10 rounded-full overflow-hidden">
                  <div
                    className="h-full bg-violet-500 transition-all duration-150"
                    style={{ width: `${uploadProgress}%` }}
                  />
                </div>
              </div>
            )}

            <div className="pt-2 flex items-center justify-end gap-3">
              {uploading ? (
                <button
                  type="button"
                  onClick={cancelFileUpload}
                  className="px-4 py-2 text-xs font-medium text-rose-200 bg-rose-500/20 hover:bg-rose-500/30 border border-rose-500/30 rounded-lg transition-colors cursor-pointer"
                >
                  Cancel Upload
                </button>
              ) : (
                <>
                  <button
                    type="button"
                    onClick={onClose}
                    className="px-4 py-2 text-xs font-medium text-slate-300 bg-white/5 hover:bg-white/10 rounded-lg transition-colors cursor-pointer"
                  >
                    Close
                  </button>
                  {error && selectedFile && (
                    <button
                      type="button"
                      onClick={startFileUpload}
                      className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-medium text-amber-200 bg-amber-500/20 hover:bg-amber-500/30 border border-amber-500/30 rounded-lg transition-colors cursor-pointer"
                    >
                      <RotateCcw className="w-3.5 h-3.5" />
                      <span>Retry Upload</span>
                    </button>
                  )}
                  <button
                    type="button"
                    disabled={!selectedFile}
                    onClick={startFileUpload}
                    className="inline-flex items-center gap-2 px-5 py-2 text-xs font-medium text-white bg-violet-600 hover:bg-violet-500 disabled:opacity-40 rounded-lg transition-colors cursor-pointer"
                  >
                    <Upload className="w-4 h-4" />
                    <span>Upload & Share</span>
                  </button>
                </>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

// ============================================================================
// 4. System Configuration, Legal & Free-Tier Info Modal
// ============================================================================
interface InfoModalProps {
  section: 'architecture' | 'privacy' | 'terms' | 'contact' | null;
  onClose: () => void;
  configStatus: {
    firebaseConfigured: boolean;
    realtimeEngine: string;
    storageEngine: string;
    limits: {
      maxRoomParticipants: number;
      recommendedVoiceParticipants: number;
      maxUploadSizeMb: number;
      maxChatMessageLength: number;
      idleRoomExpiryMinutes: number;
    };
  } | null;
}

export const InfoModal: React.FC<InfoModalProps> = ({ section, onClose, configStatus }) => {
  if (!section) return null;

  return (
    <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4 overflow-y-auto">
      <div className="bg-[#12121E] border border-white/10 rounded-xl max-w-xl w-full p-6 space-y-4 shadow-2xl">
        <div className="flex items-center justify-between border-b border-white/10 pb-3.5">
          <div className="flex items-center gap-2.5">
            <Database className="w-5 h-5 text-violet-400" />
            <h2 className="text-lg font-display font-semibold text-white">
              {section === 'architecture' && 'Firebase & Server Configuration Status'}
              {section === 'privacy' && 'Privacy Policy & Data Handling'}
              {section === 'terms' && 'Terms of Use & Content Guidelines'}
              {section === 'contact' && 'Support & Project Documentation'}
            </h2>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 text-slate-400 hover:text-white rounded-lg hover:bg-white/5 transition-colors cursor-pointer"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {section === 'architecture' && (
          <div className="space-y-4 text-xs text-slate-300 leading-relaxed">
            <div className="p-3.5 rounded-lg bg-[#09090F] border border-white/10 space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-slate-400">Firebase Authentication & Firestore</span>
                <span className="font-mono text-emerald-400">Active (Zero-Trust Rules Deployed)</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-slate-400">Realtime & WebRTC Signaling Engine</span>
                <span className="font-mono text-violet-300">
                  {configStatus?.realtimeEngine || 'firebase-firestore + websocket-authoritative'}
                </span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-slate-400">Private Video Storage Provider</span>
                <span className="font-mono text-violet-300">
                  {configStatus?.storageEngine || 'private-signed-media-storage'}
                </span>
              </div>
            </div>

            <div className="space-y-1.5">
              <h3 className="text-sm font-semibold text-white">Enforced Free-Tier Operational Limits</h3>
              <ul className="space-y-1 text-slate-400">
                <li>
                  · Maximum room capacity:{' '}
                  <span className="text-white font-mono">
                    {configStatus?.limits.maxRoomParticipants ?? 8} participants
                  </span>
                </li>
                <li>
                  · Recommended active voice call peers:{' '}
                  <span className="text-white font-mono">
                    {configStatus?.limits.recommendedVoiceParticipants ?? 4} participants (P2P WebRTC mesh)
                  </span>
                </li>
                <li>
                  · Maximum uploaded video file size:{' '}
                  <span className="text-white font-mono">{configStatus?.limits.maxUploadSizeMb ?? 50} MB</span> (.mp4 /
                  .webm)
                </li>
                <li>
                  · Maximum chat message length:{' '}
                  <span className="text-white font-mono">
                    {configStatus?.limits.maxChatMessageLength ?? 500} characters
                  </span>
                </li>
                <li>
                  · Automatic idle room & media cleanup:{' '}
                  <span className="text-white font-mono">
                    {configStatus?.limits.idleRoomExpiryMinutes ?? 120} minutes
                  </span>
                </li>
              </ul>
            </div>

            <div className="space-y-1.5">
              <h3 className="text-sm font-semibold text-white">Zero Extra Setup Needed</h3>
              <p className="text-slate-400">
                Firebase Authentication, Cloud Firestore (<span className="font-mono text-slate-200">firestore.rules</span>),
                and the built-in Express/WebSocket server are already provisioned and wired via{' '}
                <span className="font-mono text-slate-200">firebase-applet-config.json</span>.
              </p>
            </div>
          </div>
        )}

        {section === 'privacy' && (
          <div className="space-y-3 text-xs text-slate-300 leading-relaxed">
            <p>
              FriendsFlix stores only the minimum metadata required to operate synchronized watch rooms: your chosen
              display name, room membership state, chat messages within active rooms, and uploaded video metadata.
            </p>
            <p>
              Uploaded video files are stored in private server/bucket storage and streamed exclusively to verified room
              members using short-lived HMAC-signed URLs (15-minute expiration). When a room is ended by the host or
              expires due to inactivity, uploaded video files and room histories are automatically purged.
            </p>
            <p>
              Peer-to-peer voice audio streams are transmitted directly between room participants via encrypted WebRTC
              (DTLS-SRTP) and are never recorded or stored on our servers.
            </p>
          </div>
        )}

        {section === 'terms' && (
          <div className="space-y-3 text-xs text-slate-300 leading-relaxed">
            <p>
              By creating or joining a FriendsFlix watch room, you agree to stream only content that you have the legal
              right to view and share with your invited friends.
            </p>
            <p>
              YouTube playback uses the official YouTube IFrame Player API and abides by all YouTube terms, embed
              permissions, and platform restrictions. FriendsFlix does not download, rip, or bypass DRM on third-party
              videos.
            </p>
            <p>
              Room hosts are responsible for moderating their room participants, managing room lock settings, and
              removing any inappropriate uploaded files.
            </p>
          </div>
        )}

        {section === 'contact' && (
          <div className="space-y-3 text-xs text-slate-300 leading-relaxed">
            <p>
              FriendsFlix is an open-architecture watch party web application. For deployment configuration, Firebase
              security rules verification, or operational limit tuning, refer to the repository documentation in{' '}
              <span className="font-mono text-white">README.md</span> and{' '}
              <span className="font-mono text-white">firestore.rules</span>.
            </p>
            <p className="text-slate-400">
              No external support email or phone number is fabricated in this preview build. Configure your organization
              support endpoint in your deployment environment variables if hosting publicly.
            </p>
          </div>
        )}

        <div className="pt-2 flex justify-end">
          <button
            onClick={onClose}
            className="px-4 py-2 text-xs font-medium text-white bg-violet-600 hover:bg-violet-500 rounded-lg transition-colors cursor-pointer"
          >
            Done
          </button>
        </div>
      </div>
    </div>
  );
};
