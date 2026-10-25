export type PeerConnectionStatus = 'connecting' | 'connected' | 'reconnecting' | 'failed' | 'closed';

export interface SignalPayload {
  targetMemberId: string;
  signalType: 'offer' | 'answer' | 'ice-candidate';
  sdp?: RTCSessionDescriptionInit;
  candidate?: RTCIceCandidateInit;
}

export interface IncomingSignal {
  fromMemberId: string;
  fromDisplayName: string;
  signalType: 'offer' | 'answer' | 'ice-candidate';
  sdp?: RTCSessionDescriptionInit;
  candidate?: RTCIceCandidateInit;
}

interface PeerEntry {
  pc: RTCPeerConnection;
  makingOffer: boolean;
  ignoreOffer: boolean;
  pendingCandidates: RTCIceCandidateInit[];
  audioEl: HTMLAudioElement;
  status: PeerConnectionStatus;
}

const RTC_CONFIG: RTCConfiguration = {
  iceServers: [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun1.l.google.com:19302' },
  ],
};

export class WebRTCMeshManager {
  private selfMemberId: string;
  private sendSignal: (payload: SignalPayload) => void;
  private onSpeakingChange: (isSpeaking: boolean, level: number) => void;
  private onPeerStatusChange: (statuses: Record<string, PeerConnectionStatus>) => void;
  private onError: (message: string) => void;

  private localStream: MediaStream | null = null;
  private audioContext: AudioContext | null = null;
  private analyser: AnalyserNode | null = null;
  private speakingInterval: number | null = null;
  private isMuted = false;
  private isSpeaking = false;
  private peers = new Map<string, PeerEntry>();

  constructor(options: {
    selfMemberId: string;
    sendSignal: (payload: SignalPayload) => void;
    onSpeakingChange: (isSpeaking: boolean, level: number) => void;
    onPeerStatusChange: (statuses: Record<string, PeerConnectionStatus>) => void;
    onError: (message: string) => void;
  }) {
    this.selfMemberId = options.selfMemberId;
    this.sendSignal = options.sendSignal;
    this.onSpeakingChange = options.onSpeakingChange;
    this.onPeerStatusChange = options.onPeerStatusChange;
    this.onError = options.onError;
  }

  public async startLocalVoice(deviceId?: string): Promise<MediaDeviceInfo[]> {
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      throw new Error('WebRTC audio is not supported in this browser or context.');
    }

    const constraints: MediaStreamConstraints = {
      audio: deviceId
        ? {
            deviceId: { exact: deviceId },
            echoCancellation: true,
            noiseSuppression: true,
            autoGainControl: true,
          }
        : {
            echoCancellation: true,
            noiseSuppression: true,
            autoGainControl: true,
          },
      video: false,
    };

    const stream = await navigator.mediaDevices.getUserMedia(constraints);

    // If switching devices while already in voice, replace tracks on active peers
    if (this.localStream) {
      this.stopSpeakingDetector();
      for (const track of this.localStream.getTracks()) {
        track.stop();
      }
    }

    this.localStream = stream;
    for (const track of this.localStream.getAudioTracks()) {
      track.enabled = !this.isMuted;
    }

    const newAudioTrack = this.localStream.getAudioTracks()[0];
    if (newAudioTrack) {
      for (const peer of this.peers.values()) {
        const sender = peer.pc.getSenders().find((s) => s.track?.kind === 'audio');
        if (sender) {
          await sender.replaceTrack(newAudioTrack);
        }
      }
    }

    this.startSpeakingDetector(this.localStream);

    const devices = await navigator.mediaDevices.enumerateDevices();
    return devices.filter((d) => d.kind === 'audioinput');
  }

  private startSpeakingDetector(stream: MediaStream) {
    this.stopSpeakingDetector();
    try {
      const AudioCtx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      this.audioContext = new AudioCtx();
      const source = this.audioContext.createMediaStreamSource(stream);
      this.analyser = this.audioContext.createAnalyser();
      this.analyser.fftSize = 256;
      this.analyser.smoothingTimeConstant = 0.6;
      source.connect(this.analyser);

      const dataArray = new Uint8Array(this.analyser.frequencyBinCount);
      this.speakingInterval = window.setInterval(() => {
        if (!this.analyser || this.isMuted) {
          if (this.isSpeaking) {
            this.isSpeaking = false;
            this.onSpeakingChange(false, 0);
          }
          return;
        }
        this.analyser.getByteFrequencyData(dataArray);
        let sum = 0;
        for (let i = 0; i < dataArray.length; i++) {
          sum += dataArray[i];
        }
        const avg = sum / dataArray.length;
        const normalized = Math.min(100, Math.round((avg / 90) * 100));
        const speakingNow = avg > 16;

        if (speakingNow !== this.isSpeaking || speakingNow) {
          this.isSpeaking = speakingNow;
          this.onSpeakingChange(speakingNow, normalized);
        }
      }, 120);
    } catch {
      // Fallback if AudioContext is restricted
    }
  }

  private stopSpeakingDetector() {
    if (this.speakingInterval !== null) {
      clearInterval(this.speakingInterval);
      this.speakingInterval = null;
    }
    if (this.audioContext) {
      this.audioContext.close().catch(() => {});
      this.audioContext = null;
    }
    this.analyser = null;
  }

  public setMuted(muted: boolean) {
    this.isMuted = muted;
    if (this.localStream) {
      for (const track of this.localStream.getAudioTracks()) {
        track.enabled = !muted;
      }
    }
    if (muted && this.isSpeaking) {
      this.isSpeaking = false;
      this.onSpeakingChange(false, 0);
    }
  }

  public syncVoicePeers(activeVoiceMemberIds: string[]) {
    if (!this.localStream) return;

    const targetIds = new Set(activeVoiceMemberIds.filter((id) => id !== this.selfMemberId));

    // Clean up peers who left voice
    for (const existingId of Array.from(this.peers.keys())) {
      if (!targetIds.has(existingId)) {
        this.removePeer(existingId);
      }
    }

    // Create connections for new voice peers
    for (const remoteId of targetIds) {
      if (!this.peers.has(remoteId)) {
        const shouldInitiate = this.selfMemberId < remoteId;
        this.createPeer(remoteId, shouldInitiate);
      }
    }

    this.emitPeerStatuses();
  }

  private createPeer(remoteMemberId: string, initiateOffer: boolean): PeerEntry {
    const existing = this.peers.get(remoteMemberId);
    if (existing) return existing;

    const pc = new RTCPeerConnection(RTC_CONFIG);
    const audioEl = document.createElement('audio');
    audioEl.autoplay = true;
    audioEl.setAttribute('playsinline', 'true');

    const entry: PeerEntry = {
      pc,
      makingOffer: false,
      ignoreOffer: false,
      pendingCandidates: [],
      audioEl,
      status: 'connecting',
    };

    this.peers.set(remoteMemberId, entry);

    if (this.localStream) {
      for (const track of this.localStream.getTracks()) {
        pc.addTrack(track, this.localStream);
      }
    }

    pc.onicecandidate = (event) => {
      if (event.candidate) {
        this.sendSignal({
          targetMemberId: remoteMemberId,
          signalType: 'ice-candidate',
          candidate: event.candidate.toJSON(),
        });
      }
    };

    pc.ontrack = (event) => {
      const [remoteStream] = event.streams;
      if (remoteStream && entry.audioEl.srcObject !== remoteStream) {
        entry.audioEl.srcObject = remoteStream;
        entry.audioEl.play().catch(() => {
          // Browser may require user gesture if not yet interacted
        });
      }
    };

    const updateState = () => {
      const connState = pc.connectionState;
      const iceState = pc.iceConnectionState;
      if (connState === 'connected' || iceState === 'connected' || iceState === 'completed') {
        entry.status = 'connected';
      } else if (connState === 'disconnected' || iceState === 'disconnected') {
        entry.status = 'reconnecting';
      } else if (connState === 'failed' || iceState === 'failed') {
        entry.status = 'failed';
      } else if (connState === 'closed' || iceState === 'closed') {
        entry.status = 'closed';
      } else {
        entry.status = 'connecting';
      }
      this.emitPeerStatuses();
    };

    pc.onconnectionstatechange = updateState;
    pc.oniceconnectionstatechange = updateState;

    if (initiateOffer) {
      this.negotiateOffer(remoteMemberId, entry);
    }

    this.emitPeerStatuses();
    return entry;
  }

  private async negotiateOffer(remoteMemberId: string, entry: PeerEntry) {
    try {
      entry.makingOffer = true;
      const offer = await entry.pc.createOffer();
      if (entry.pc.signalingState !== 'stable') return;
      await entry.pc.setLocalDescription(offer);
      if (entry.pc.localDescription) {
        this.sendSignal({
          targetMemberId: remoteMemberId,
          signalType: 'offer',
          sdp: entry.pc.localDescription,
        });
      }
    } catch (err: any) {
      this.onError(`Voice negotiation warning with peer: ${err?.message || 'Unknown error'}`);
    } finally {
      entry.makingOffer = false;
    }
  }

  public async handleIncomingSignal(signal: IncomingSignal) {
    if (!this.localStream) return;
    const remoteId = signal.fromMemberId;
    const polite = this.selfMemberId > remoteId;
    const entry = this.createPeer(remoteId, false);
    const { pc } = entry;

    try {
      if (signal.signalType === 'offer' && signal.sdp) {
        const offerCollision = entry.makingOffer || pc.signalingState !== 'stable';
        entry.ignoreOffer = !polite && offerCollision;
        if (entry.ignoreOffer) {
          return;
        }

        await pc.setRemoteDescription(new RTCSessionDescription(signal.sdp));
        await this.flushPendingCandidates(entry);

        const answer = await pc.createAnswer();
        await pc.setLocalDescription(answer);
        if (pc.localDescription) {
          this.sendSignal({
            targetMemberId: remoteId,
            signalType: 'answer',
            sdp: pc.localDescription,
          });
        }
      } else if (signal.signalType === 'answer' && signal.sdp) {
        await pc.setRemoteDescription(new RTCSessionDescription(signal.sdp));
        await this.flushPendingCandidates(entry);
      } else if (signal.signalType === 'ice-candidate' && signal.candidate) {
        try {
          if (pc.remoteDescription && pc.remoteDescription.type) {
            await pc.addIceCandidate(new RTCIceCandidate(signal.candidate));
          } else {
            entry.pendingCandidates.push(signal.candidate);
          }
        } catch (err) {
          if (!entry.ignoreOffer) {
            console.warn('ICE candidate error:', err);
          }
        }
      }
    } catch (err: any) {
      console.warn('WebRTC signaling error:', err);
    }
  }

  private async flushPendingCandidates(entry: PeerEntry) {
    while (entry.pendingCandidates.length > 0) {
      const cand = entry.pendingCandidates.shift()!;
      try {
        await entry.pc.addIceCandidate(new RTCIceCandidate(cand));
      } catch {
        // ignore stale candidate
      }
    }
  }

  public removePeer(remoteMemberId: string) {
    const entry = this.peers.get(remoteMemberId);
    if (!entry) return;
    try {
      entry.audioEl.pause();
      entry.audioEl.srcObject = null;
      entry.pc.onicecandidate = null;
      entry.pc.ontrack = null;
      entry.pc.onconnectionstatechange = null;
      entry.pc.oniceconnectionstatechange = null;
      entry.pc.close();
    } catch {
      // ignore
    }
    this.peers.delete(remoteMemberId);
    this.emitPeerStatuses();
  }

  private emitPeerStatuses() {
    const map: Record<string, PeerConnectionStatus> = {};
    for (const [id, entry] of this.peers.entries()) {
      map[id] = entry.status;
    }
    this.onPeerStatusChange(map);
  }

  public destroyAll() {
    this.stopSpeakingDetector();
    for (const id of Array.from(this.peers.keys())) {
      this.removePeer(id);
    }
    if (this.localStream) {
      for (const track of this.localStream.getTracks()) {
        track.stop();
      }
      this.localStream = null;
    }
    this.isSpeaking = false;
    this.onPeerStatusChange({});
  }
}
