import React from 'react';
import {
  Play,
  Mic,
  MessageSquare,
  Shield,
  Upload,
  Users,
  Lock,
  ArrowRight,
  LogIn,
  LogOut,
  Sliders,
  Volume2,
} from 'lucide-react';
import { BrandLogo } from './BrandLogo';

interface LandingPageProps {
  onOpenCreateRoom: () => void;
  onOpenJoinRoom: () => void;
  onOpenInfoModal: (section: 'architecture' | 'privacy' | 'terms' | 'contact') => void;
  currentUser: {
    displayName: string;
    authType: 'firebase' | 'guest';
    avatarUrl?: string;
  } | null;
  onGoogleSignIn: () => Promise<void>;
  onSignOut: () => Promise<void>;
}

export const LandingPage: React.FC<LandingPageProps> = ({
  onOpenCreateRoom,
  onOpenJoinRoom,
  onOpenInfoModal,
  currentUser,
  onGoogleSignIn,
  onSignOut,
}) => {
  return (
    <div className="min-h-screen bg-[#09090F] text-[#F3F4F8] flex flex-col">
      {/* Top Bar Contract: 3 Zones separated by gap-8 */}
      <header className="sticky top-0 z-30 bg-[#09090F]/90 backdrop-blur-md border-b border-white/10">
        <div className="max-w-7xl mx-auto flex items-center justify-between gap-8 px-6 py-4">
          {/* Zone 1: Brand Wordmark */}
          <a href="#top" className="focus:outline-none whitespace-nowrap shrink-0">
            <BrandLogo />
          </a>

          {/* Zone 2: 4 Single-line Navigation Links */}
          <nav className="hidden md:flex items-center gap-7 text-sm font-medium text-slate-300">
            <a
              href="#how-it-works"
              className="hover:text-white hover:underline underline-offset-4 transition-colors whitespace-nowrap shrink-0"
            >
              How It Works
            </a>
            <a
              href="#capabilities"
              className="hover:text-white hover:underline underline-offset-4 transition-colors whitespace-nowrap shrink-0"
            >
              Capabilities
            </a>
            <a
              href="#limits"
              className="hover:text-white hover:underline underline-offset-4 transition-colors whitespace-nowrap shrink-0"
            >
              Free-Tier Limits
            </a>
            <button
              type="button"
              onClick={() => onOpenInfoModal('architecture')}
              className="hover:text-white hover:underline underline-offset-4 transition-colors whitespace-nowrap shrink-0 cursor-pointer"
            >
              Configuration Status
            </button>
          </nav>

          {/* Zone 3: 1 Primary Action */}
          <div className="flex items-center shrink-0">
            <button
              type="button"
              onClick={onOpenCreateRoom}
              className="px-4 py-2 text-xs font-medium text-white bg-violet-600 hover:bg-violet-500 rounded-lg transition-colors whitespace-nowrap shrink-0 cursor-pointer"
            >
              Create Room
            </button>
          </div>
        </div>
      </header>

      <main id="top" className="flex-1">
        {/* Hero Section */}
        <section className="max-w-7xl mx-auto px-6 pt-12 pb-16 lg:pt-20 lg:pb-24">
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-12 items-stretch">
            {/* Left Column: Proposition & Primary Conversion */}
            <div className="lg:col-span-6 flex flex-col justify-center space-y-6">
              <div className="text-xs font-medium text-violet-300 tracking-wide">
                Your friends. Your movie night. · Zero subscriptions or paywalls
              </div>

              <h1
                className="font-display font-bold text-white tracking-tight leading-[1.1]"
                style={{ fontSize: 'clamp(2.25rem, 4vw, 3.6rem)', textWrap: 'balance' } as React.CSSProperties}
              >
                Watch YouTube or private video uploads in lockstep with your room.
              </h1>

              <p className="text-base text-slate-300 leading-relaxed max-w-xl">
                FriendsFlix synchronizes play, pause, seek, and shared queues across phones, tablets, and desktops while
                connecting your group over peer-to-peer WebRTC voice and real-time chat.
              </p>

              {/* Primary & Secondary CTAs */}
              <div className="flex flex-wrap items-center gap-3.5 pt-2">
                <button
                  type="button"
                  onClick={onOpenCreateRoom}
                  className="inline-flex items-center gap-2 px-6 py-3 text-sm font-medium text-white bg-violet-600 hover:bg-violet-500 rounded-lg transition-colors whitespace-nowrap shrink-0 cursor-pointer shadow-lg shadow-violet-950/50"
                >
                  <span>Create Room</span>
                  <ArrowRight className="w-4 h-4" />
                </button>

                <button
                  type="button"
                  onClick={onOpenJoinRoom}
                  className="inline-flex items-center gap-2 px-5 py-3 text-sm font-medium text-slate-200 bg-white/5 hover:bg-white/10 border border-white/10 rounded-lg transition-colors whitespace-nowrap shrink-0 cursor-pointer"
                >
                  <span>Join Room with Code</span>
                </button>
              </div>

              {/* Optional Persistent Account Bar */}
              <div className="pt-3 border-t border-white/10 flex flex-wrap items-center justify-between gap-4 text-xs text-slate-400">
                {currentUser && currentUser.authType !== 'guest' ? (
                  <div className="flex items-center gap-3">
                    <span>
                      Signed in as <strong className="text-white">{currentUser.displayName}</strong>
                    </span>
                    <span aria-hidden="true">·</span>
                    <button
                      type="button"
                      onClick={onSignOut}
                      className="inline-flex items-center gap-1 text-slate-300 hover:text-white underline underline-offset-4 cursor-pointer"
                    >
                      <LogOut className="w-3.5 h-3.5" />
                      <span>Sign Out</span>
                    </button>
                  </div>
                ) : (
                  <div className="flex flex-wrap items-center gap-3">
                    <span>Join immediately as a guest or use a persistent account:</span>
                    <button
                      type="button"
                      onClick={onGoogleSignIn}
                      className="inline-flex items-center gap-1.5 text-violet-300 hover:text-violet-200 font-medium underline underline-offset-4 cursor-pointer"
                    >
                      <LogIn className="w-3.5 h-3.5" />
                      <span>Sign in with Google</span>
                    </button>
                  </div>
                )}
              </div>
            </div>

            {/* Right Column: Interactive Watch-Party Interface Preview */}
            <div className="lg:col-span-6 flex flex-col justify-center">
              <div className="bg-[#11111C] border border-white/10 rounded-xl overflow-hidden shadow-2xl flex flex-col h-full">
                {/* Preview Header Bar */}
                <div className="px-4 py-3 bg-[#151524] border-b border-white/10 flex items-center justify-between gap-4">
                  <div className="flex items-center gap-2.5 min-w-0">
                    <Lock className="w-3.5 h-3.5 text-violet-400 shrink-0" />
                    <span className="text-xs font-medium text-white truncate">
                      Friday Sci-Fi Screening · Room FFX-9K4M
                    </span>
                  </div>
                  <div className="text-xs font-mono tabular-nums text-slate-400 shrink-0">
                    4 / 8 Members · Voice Active
                  </div>
                </div>

                {/* Preview Split Layout: Video Canvas + Mini Sidebar */}
                <div className="grid grid-cols-1 sm:grid-cols-12 flex-1">
                  {/* Simulated Cinema Canvas */}
                  <div className="sm:col-span-8 bg-[#07070C] flex flex-col justify-between p-5 relative overflow-hidden min-h-[250px]">
                    {/* Atmospheric SVG Cinema Backdrop */}
                    <svg
                      className="absolute inset-0 w-full h-full object-cover opacity-80 pointer-events-none"
                      viewBox="0 0 600 360"
                      fill="none"
                      xmlns="http://www.w3.org/2000/svg"
                      aria-hidden="true"
                    >
                      <defs>
                        <radialGradient id="nebula" cx="50%" cy="40%" r="65%">
                          <stop offset="0%" stopColor="#4C1D95" stopOpacity="0.55" />
                          <stop offset="55%" stopColor="#1E1B4B" stopOpacity="0.3" />
                          <stop offset="100%" stopColor="#07070C" stopOpacity="1" />
                        </radialGradient>
                        <linearGradient id="horizon" x1="0" y1="220" x2="0" y2="360" gradientUnits="userSpaceOnUse">
                          <stop offset="0%" stopColor="#7C3AED" stopOpacity="0.22" />
                          <stop offset="100%" stopColor="#07070C" stopOpacity="0.98" />
                        </linearGradient>
                      </defs>
                      <rect width="600" height="360" fill="url(#nebula)" />
                      <circle cx="310" cy="135" r="54" fill="#6D28D9" fillOpacity="0.25" />
                      <circle cx="310" cy="135" r="32" fill="#A78BFA" fillOpacity="0.2" />
                      <path
                        d="M0 270L110 215L215 255L340 190L465 245L600 205V360H0V270Z"
                        fill="url(#horizon)"
                      />
                      <path
                        d="M0 295L140 250L270 285L410 230L600 275V360H0V295Z"
                        fill="#0A0A12"
                      />
                    </svg>

                    <div className="relative z-10 flex items-center justify-between text-xs text-slate-300">
                      <span>Tears of Steel — 4K Open Cinema</span>
                      <span className="font-mono tabular-nums text-violet-300">Synced ±0.12s</span>
                    </div>

                    <div className="relative z-10 my-auto flex flex-col items-center text-center py-6">
                      <button
                        type="button"
                        onClick={onOpenCreateRoom}
                        className="w-12 h-12 rounded-full bg-violet-600/90 hover:bg-violet-500 text-white flex items-center justify-center transition-transform hover:scale-105 cursor-pointer shadow-lg"
                        aria-label="Start a watch room"
                      >
                        <Play className="w-5 h-5 ml-0.5" />
                      </button>
                      <span className="text-xs text-slate-300 mt-2.5 font-medium">
                        Launch Interactive Watch Room
                      </span>
                    </div>

                    {/* Transport Bar */}
                    <div className="relative z-10 space-y-2 bg-black/60 backdrop-blur-sm p-2.5 rounded-lg border border-white/10">
                      <div className="w-full h-1 bg-white/15 rounded-full overflow-hidden">
                        <div className="w-2/5 h-full bg-violet-500" />
                      </div>
                      <div className="flex items-center justify-between text-[11px] font-mono tabular-nums text-slate-300">
                        <span>04:52 / 12:14</span>
                        <span className="flex items-center gap-1.5 text-slate-400">
                          <Volume2 className="w-3.5 h-3.5 text-violet-400" />
                          <span>1080p · Host Authority</span>
                        </span>
                      </div>
                    </div>
                  </div>

                  {/* Simulated Voice & Chat Column */}
                  <div className="sm:col-span-4 bg-[#12121E] border-t sm:border-t-0 sm:border-l border-white/10 p-4 flex flex-col justify-between space-y-4">
                    <div className="space-y-2.5">
                      <div className="text-xs font-medium text-slate-400 flex items-center justify-between">
                        <span>Voice Mesh (3/4)</span>
                        <Mic className="w-3.5 h-3.5 text-violet-400" />
                      </div>
                      <div className="space-y-1.5 text-xs">
                        <div className="flex items-center justify-between p-2 rounded bg-[#09090F] border border-violet-500/30">
                          <span className="text-white font-medium truncate">Elena (Host)</span>
                          <span className="text-[11px] font-mono text-violet-300">Speaking</span>
                        </div>
                        <div className="flex items-center justify-between p-2 rounded bg-[#09090F] border border-white/5">
                          <span className="text-slate-300 truncate">Marcus</span>
                          <span className="text-[11px] font-mono text-slate-400">Connected</span>
                        </div>
                        <div className="flex items-center justify-between p-2 rounded bg-[#09090F] border border-white/5">
                          <span className="text-slate-300 truncate">Devon</span>
                          <span className="text-[11px] font-mono text-slate-500">Muted</span>
                        </div>
                      </div>
                    </div>

                    <div className="space-y-2 pt-2 border-t border-white/10 text-xs">
                      <div className="text-slate-400 font-medium">Room Chat</div>
                      <div className="space-y-1.5 text-[11px]">
                        <p className="text-slate-300">
                          <strong className="text-violet-300">Marcus:</strong> That orbital shot looks incredible in
                          sync.
                        </p>
                        <p className="text-slate-300">
                          <strong className="text-emerald-300">Elena:</strong> Queued my MP4 short film next!
                        </p>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* How It Works Section */}
        <section id="how-it-works" className="border-t border-white/10 bg-[#0C0C14] py-16">
          <div className="max-w-7xl mx-auto px-6 space-y-10">
            <div className="max-w-2xl space-y-2">
              <h2 className="text-2xl sm:text-3xl font-display font-bold text-white tracking-tight">
                How FriendsFlix Works
              </h2>
              <p className="text-sm text-slate-400 leading-relaxed">
                Start a private room in seconds without requiring friends to pay or install browser extensions.
              </p>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
              <div className="space-y-2.5">
                <div className="text-xs font-mono text-violet-400">01. Create & Invite</div>
                <h3 className="text-base font-display font-semibold text-white">
                  Generate an unguessable room link
                </h3>
                <p className="text-sm text-slate-400 leading-relaxed">
                  Pick a room name and nickname. FriendsFlix generates a cryptographic room ID and invite code so only
                  invited friends can join private rooms.
                </p>
              </div>

              <div className="space-y-2.5">
                <div className="text-xs font-mono text-violet-400">02. Queue YouTube or Private Video Files</div>
                <h3 className="text-base font-display font-semibold text-white">
                  Authoritative playback synchronization
                </h3>
                <p className="text-sm text-slate-400 leading-relaxed">
                  Paste any embeddable YouTube URL or upload an authorized MP4/WebM file up to 50 MB. Play, pause, and
                  seek events stay synchronized across all connected browsers.
                </p>
              </div>

              <div className="space-y-2.5">
                <div className="text-xs font-mono text-violet-400">03. Talk Live on Voice & Chat</div>
                <h3 className="text-base font-display font-semibold text-white">
                  Peer-to-peer WebRTC audio & live reactions
                </h3>
                <p className="text-sm text-slate-400 leading-relaxed">
                  Click Join Voice when you are ready to enable your microphone. Speak with up to 4 active voice peers
                  while messaging and reacting in real time.
                </p>
              </div>
            </div>
          </div>
        </section>

        {/* Capabilities Bento Grid */}
        <section id="capabilities" className="border-t border-white/10 py-16">
          <div className="max-w-7xl mx-auto px-6 space-y-10">
            <div className="max-w-2xl space-y-2">
              <h2 className="text-2xl sm:text-3xl font-display font-bold text-white tracking-tight">
                Engineered for Synchronized Watch Parties
              </h2>
              <p className="text-sm text-slate-400 leading-relaxed">
                Built with strict membership verification, drift-corrected playback, and zero-trust media access.
              </p>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
              {/* Span 2 Card: Synchronized Video */}
              <div className="md:col-span-2 bg-[#11111C] border border-white/10 rounded-xl p-6 flex flex-col justify-between space-y-4">
                <div className="space-y-2">
                  <div className="flex items-center gap-2 text-violet-400 text-xs font-medium">
                    <Play className="w-4 h-4" />
                    <span>Synchronized Video Engine</span>
                  </div>
                  <h3 className="text-lg font-display font-semibold text-white">
                    Official YouTube IFrame API & Signed Private Uploads
                  </h3>
                  <p className="text-sm text-slate-400 leading-relaxed">
                    Whether watching YouTube premieres or your own uploaded MP4/WebM recordings, the host&apos;s
                    transport state broadcasts with timestamps and automatic drift correction. Uploaded files are
                    validated by binary container magic bytes and served exclusively via 15-minute HMAC-signed URLs to
                    verified room members.
                  </p>
                </div>
                <div className="pt-2 border-t border-white/10 flex flex-wrap items-center gap-4 text-xs text-slate-400 font-mono tabular-nums">
                  <span>Drift Tolerance: 1.85s</span>
                  <span>·</span>
                  <span>Signed Stream TTL: 15 min</span>
                  <span>·</span>
                  <span>HTTP Range Seeking: 206 Partial Content</span>
                </div>
              </div>

              {/* Span 1 Card: Voice Chat */}
              <div className="bg-[#11111C] border border-white/10 rounded-xl p-6 flex flex-col justify-between space-y-4">
                <div className="space-y-2">
                  <div className="flex items-center gap-2 text-violet-400 text-xs font-medium">
                    <Mic className="w-4 h-4" />
                    <span>WebRTC Mesh Voice</span>
                  </div>
                  <h3 className="text-lg font-display font-semibold text-white">
                    Explicit Opt-In Group Audio
                  </h3>
                  <p className="text-sm text-slate-400 leading-relaxed">
                    Your microphone never activates until you click Join Voice. Includes live WebAudio speaking
                    detection, mute toggles, input device switching, and room-scoped signaling.
                  </p>
                </div>
                <div className="pt-2 border-t border-white/10 text-xs text-slate-400 font-mono">
                  Up to 4 active voice peers per room
                </div>
              </div>

              {/* Span 1 Card: Host Moderation */}
              <div className="bg-[#11111C] border border-white/10 rounded-xl p-6 flex flex-col justify-between space-y-4">
                <div className="space-y-2">
                  <div className="flex items-center gap-2 text-violet-400 text-xs font-medium">
                    <Shield className="w-4 h-4" />
                    <span>Server-Enforced Permissions</span>
                  </div>
                  <h3 className="text-lg font-display font-semibold text-white">
                    Host Controls & Room Locking
                  </h3>
                  <p className="text-sm text-slate-400 leading-relaxed">
                    Lock the room at any time, transfer host ownership to a friend, remove disruptive participants, or
                    toggle whether guests can add videos to the shared queue.
                  </p>
                </div>
                <div className="pt-2 border-t border-white/10 text-xs text-slate-400 font-mono">
                  HMAC-SHA256 Session & Firestore ABAC
                </div>
              </div>

              {/* Span 2 Card: Live Chat & Shared Queue */}
              <div className="md:col-span-2 bg-[#11111C] border border-white/10 rounded-xl p-6 flex flex-col justify-between space-y-4">
                <div className="space-y-2">
                  <div className="flex items-center gap-2 text-violet-400 text-xs font-medium">
                    <MessageSquare className="w-4 h-4" />
                    <span>Real-Time Chat, Presence & Shared Queue</span>
                  </div>
                  <h3 className="text-lg font-display font-semibold text-white">
                    Live Reactions, Typing Indicators, and Playlist Recovery
                  </h3>
                  <p className="text-sm text-slate-400 leading-relaxed">
                    Send rate-limited, XSS-safe text messages, react with quick emojis, see who is online or speaking,
                    and build a shared queue of YouTube links and uploaded clips that automatically advances when a
                    video ends.
                  </p>
                </div>
                <div className="pt-2 border-t border-white/10 flex flex-wrap items-center gap-4 text-xs text-slate-400 font-mono tabular-nums">
                  <span>Max Message: 500 chars</span>
                  <span>·</span>
                  <span>Rate Limit: 5 msgs / 5s</span>
                  <span>·</span>
                  <span>Auto Host Failover: 25s</span>
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* Free-Tier Limits & Network Transparency Section */}
        <section id="limits" className="border-t border-white/10 bg-[#0C0C14] py-16">
          <div className="max-w-7xl mx-auto px-6 space-y-8">
            <div className="flex flex-col md:flex-row md:items-end justify-between gap-4">
              <div className="space-y-2 max-w-2xl">
                <h2 className="text-2xl font-display font-bold text-white tracking-tight">
                  Free-Tier Operation & Resource Boundaries
                </h2>
                <p className="text-sm text-slate-400 leading-relaxed">
                  FriendsFlix enforces explicit, conservative application limits to keep storage and bandwidth costs
                  sustainable without charging users or requiring paid voice infrastructure.
                </p>
              </div>
              <button
                type="button"
                onClick={() => onOpenInfoModal('architecture')}
                className="inline-flex items-center gap-2 px-4 py-2 text-xs font-medium text-slate-200 bg-white/5 hover:bg-white/10 border border-white/10 rounded-lg transition-colors shrink-0 cursor-pointer whitespace-nowrap"
              >
                <Sliders className="w-3.5 h-3.5 text-violet-400" />
                <span>Inspect Configuration & SQL Policies</span>
              </button>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
              <div className="p-5 rounded-xl bg-[#11111C] border border-white/10 space-y-1">
                <div className="text-xs text-slate-400 flex items-center gap-1.5">
                  <Users className="w-3.5 h-3.5 text-violet-400" />
                  <span>Room Capacity</span>
                </div>
                <div className="text-2xl font-display font-bold font-mono tabular-nums text-white">8 Members</div>
                <p className="text-xs text-slate-400 pt-1">
                  Maximum concurrent participants per room, enforced on join.
                </p>
              </div>

              <div className="p-5 rounded-xl bg-[#11111C] border border-white/10 space-y-1">
                <div className="text-xs text-slate-400 flex items-center gap-1.5">
                  <Mic className="w-3.5 h-3.5 text-violet-400" />
                  <span>Voice Mesh Peers</span>
                </div>
                <div className="text-2xl font-display font-bold font-mono tabular-nums text-white">4 Active Peers</div>
                <p className="text-xs text-slate-400 pt-1">
                  Peer-to-peer WebRTC audio mesh; symmetric NATs may require TURN relay.
                </p>
              </div>

              <div className="p-5 rounded-xl bg-[#11111C] border border-white/10 space-y-1">
                <div className="text-xs text-slate-400 flex items-center gap-1.5">
                  <Upload className="w-3.5 h-3.5 text-violet-400" />
                  <span>Private Video Upload</span>
                </div>
                <div className="text-2xl font-display font-bold font-mono tabular-nums text-white">50 MB / File</div>
                <p className="text-xs text-slate-400 pt-1">
                  Supports MP4 and WebM containers with binary header verification.
                </p>
              </div>

              <div className="p-5 rounded-xl bg-[#11111C] border border-white/10 space-y-1">
                <div className="text-xs text-slate-400 flex items-center gap-1.5">
                  <Lock className="w-3.5 h-3.5 text-violet-400" />
                  <span>Idle Room Expiration</span>
                </div>
                <div className="text-2xl font-display font-bold font-mono tabular-nums text-white">120 Minutes</div>
                <p className="text-xs text-slate-400 pt-1">
                  Inactive rooms and temporary video uploads are purged automatically.
                </p>
              </div>
            </div>
          </div>
        </section>
      </main>

      {/* Quiet Footer */}
      <footer className="border-t border-white/10 bg-[#09090F] py-8">
        <div className="max-w-7xl mx-auto px-6 flex flex-col sm:flex-row items-center justify-between gap-4 text-xs text-slate-400">
          <div className="flex items-center gap-3">
            <BrandLogo size="sm" />
            <span>·</span>
            <span>Your friends. Your movie night.</span>
          </div>

          <div className="flex flex-wrap items-center gap-6">
            <button
              type="button"
              onClick={() => onOpenInfoModal('privacy')}
              className="hover:text-white transition-colors cursor-pointer"
            >
              Privacy
            </button>
            <button
              type="button"
              onClick={() => onOpenInfoModal('terms')}
              className="hover:text-white transition-colors cursor-pointer"
            >
              Terms
            </button>
            <button
              type="button"
              onClick={() => onOpenInfoModal('contact')}
              className="hover:text-white transition-colors cursor-pointer"
            >
              Contact
            </button>
            <button
              type="button"
              onClick={() => onOpenInfoModal('architecture')}
              className="hover:text-white transition-colors cursor-pointer"
            >
              Service Status
            </button>
          </div>
        </div>
      </footer>
    </div>
  );
};
