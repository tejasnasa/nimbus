/**
 * @module web/hooks/useVoiceChat
 * @description WebRTC voice-chat lifecycle for a workspace: TURN credential
 * fetch, muted-by-default mic acquisition, per-peer RTCPeerConnections with
 * offer/answer/ICE relay over Socket.IO, hidden `<audio>` playback, AnalyserNode
 * speaking indicators (requestAnimationFrame loop), and mute/deafen state
 * synced via `voice:mute-state`. ICE candidates arriving before the remote
 * description are queued and flushed after.
 *
 * @important Joins muted (`track.enabled = false`); the AudioContext-per-peer
 *            analysis loop must be torn down with peers to avoid leaks.
 */
import { VoiceUser } from "@nimbus/types";
import { useCallback, useEffect, useRef, useState } from "react";
import { socket } from "../lib/socket";

/** Identity + workspace for the voice session. */
export interface UseVoiceChatProps {
  userId: string;
  userName: string;
  userImage: string | null;
  workspaceId: string;
}

/**
 * Manages the full voice session.
 *
 * Lifecycle: fetch TURN creds → getUserMedia (muted) → `voice:join` →
 * mesh with `voice:current-users` (offer each) / answer incoming offers →
 * stream remote tracks to hidden audio elements → speaking detection →
 * `voice:leave` + full peer/mic/analyser teardown on unmount.
 *
 * @param props.userId - Current user's ID.
 * @param props.userName - Display name announced to peers.
 * @param props.userImage - Avatar URL (nullable).
 * @param props.workspaceId - Workspace voice channel.
 * @returns Connection/mute/deafen flags, rosters, and toggle controls.
 */
export function useVoiceChat({
  userId,
  userName,
  userImage,
  workspaceId,
}: UseVoiceChatProps) {
  // isMuted starts true to match the muted-by-default mic acquisition below —
  // the UI must never show "live" before the track is actually enabled.
  // speakingUsers is a Set (not an array) because membership is tested every
  // animation frame and must stay O(1).
  const [isConnected, setIsConnected] = useState(false);
  const [isMuted, setIsMuted] = useState(true);
  const [isDeafened, setIsDeafened] = useState(false);
  const [voiceUsers, setVoiceUsers] = useState<VoiceUser[]>([]);
  const [speakingUsers, setSpeakingUsers] = useState<Set<string>>(new Set());

  // Live objects live in refs (not state): socket/RTC callbacks outlive renders,
  // and re-rendering on every peer-map mutation would thrash the component.
  const localStreamRef = useRef<MediaStream | null>(null);
  const peersRef = useRef<Map<string, RTCPeerConnection>>(new Map());
  const audioElementsRef = useRef<Map<string, HTMLAudioElement>>(new Map());
  const analysersRef = useRef<
    Map<string, { analyser: AnalyserNode; audioCtx: AudioContext }>
  >(new Map());
  // rAF id so the speaking loop can be cancelled on unmount; per-peer FIFO
  // queues for ICE candidates that arrive before their remote description.
  const animationFrameRef = useRef<number | null>(null);
  const pendingCandidatesRef = useRef<Map<string, RTCIceCandidateInit[]>>(
    new Map(),
  );

  // Mirrors of state for use inside socket/RTC callbacks, which close over the
  // values from their registration render and would otherwise go stale.
  // mutedBeforeDeafen remembers the mic state so undeafening restores it.
  const isMutedRef = useRef(true);
  const isDeafenedRef = useRef(false);
  const mutedBeforeDeafen = useRef(false);
  const voiceUsersRef = useRef<VoiceUser[]>([]);

  // One-way mirrors: state → ref after every render. Socket/RTC handlers are
  // registered once per connection and close over whatever render created
  // them, so they read these refs instead of stale state variables.
  useEffect(() => {
    voiceUsersRef.current = voiceUsers;
  }, [voiceUsers]);

  useEffect(() => {
    isMutedRef.current = isMuted;
  }, [isMuted]);

  useEffect(() => {
    isDeafenedRef.current = isDeafened;
  }, [isDeafened]);

  /** Full per-peer teardown: connection, playback, analysis, and roster entries. */
  const cleanupPeer = useCallback((peerId: string) => {
    // close() halts ICE/DTLS and fires no further ontrack/onicecandidate —
    // safe to call on an already-closed peer, hence no state guard.
    const peer = peersRef.current.get(peerId);
    if (peer) {
      peer.close();
      peersRef.current.delete(peerId);
    }

    // Detach the stream before removing the node: otherwise the remote track
    // stays referenced and Chrome keeps the audio pipeline alive.
    const audio = audioElementsRef.current.get(peerId);
    if (audio) {
      audio.srcObject = null;
      audio.remove();
      audioElementsRef.current.delete(peerId);
    }

    // Each peer owns an AudioContext (its own DSP thread) — leaking one per
    // leave would eventually hit the browser's context limit (~6) and break
    // all audio. close() can throw when already closed, hence try/catch.
    const analysis = analysersRef.current.get(peerId);
    if (analysis) {
      try {
        analysis.audioCtx.close();
      } catch (e) {
        console.error("Error closing AudioContext:", e);
      }
      analysersRef.current.delete(peerId);
    }

    // Functional updates: cleanupPeer runs from socket callbacks holding stale
    // renders, so it must derive from previous state, never captured state.
    setVoiceUsers((prev) => prev.filter((u) => u.userId !== peerId));
    setSpeakingUsers((prev) => {
      if (prev.has(peerId)) {
        const next = new Set(prev);
        next.delete(peerId);
        return next;
      }
      return prev;
    });
  }, []);

  /** Attaches an AnalyserNode for speaking detection; failures are non-fatal. */
  const setupAudioAnalysis = useCallback(
    (stream: MediaStream, peerId: string) => {
      try {
        // webkitAudioContext fallback for older Safari; the `any` cast is
        // required because TS lib dom has no such property on window.
        const AudioContextClass =
          window.AudioContext || (window as any).webkitAudioContext;
        const audioCtx = new AudioContextClass();
        const source = audioCtx.createMediaStreamSource(stream);
        const analyser = audioCtx.createAnalyser();
        // fftSize 512 → 256 frequency bins: enough resolution for voice energy
        // without the per-frame cost of 2048. -90..-10dB spans mic noise floor
        // to clipping; 0.85 smoothing stops plosives ("p"/"b" bursts) from
        // flickering the speaking dot.
        analyser.fftSize = 512;
        analyser.minDecibels = -90;
        analyser.maxDecibels = -10;
        analyser.smoothingTimeConstant = 0.85;

        // Connected to the analyser only, NOT to audioCtx.destination — the
        // stream must be measured without playing the local mic back (feedback).
        source.connect(analyser);

        analysersRef.current.set(peerId, { analyser, audioCtx });
      } catch (e) {
        // Voice still works without analysis; only the speaking indicator dies.
        console.error("Failed to initialize audio analyzer", e);
      }
    },
    [],
  );

  // Mount effect: acquires mic + joins voice exactly once per workspace.
  // NOTE: `localStream`/`iceServers` are effect-locals (not refs) so the
  // cleanup closure always sees this mount's values, even across re-renders.
  useEffect(() => {
    if (!workspaceId) return;

    let isDestroyed = false;
    let localStream: MediaStream | null = null;
    let iceServers: RTCIceServer[] = [];

    async function initVoice() {
      try {
        // TURN first: without relay credentials, peers behind symmetric NATs can
        // never connect, so fail loudly before touching the microphone.
        const response = await fetch(
          `${process.env.NEXT_PUBLIC_BACKEND_URL}/api/turn/credentials`,
          { credentials: "include" },
        );
        if (!response.ok) {
          throw new Error("Failed to fetch ICE configuration");
        }
        const data = await response.json();
        iceServers = data.responseObject.iceServers;

        // Bail if unmounted mid-fetch — otherwise we'd prompt for mic access
        // and emit `voice:join` for a dead component.
        if (isDestroyed) return;

        localStream = await navigator.mediaDevices.getUserMedia({
          audio: true,
        });
        localStreamRef.current = localStream;

        // Join muted by default — the track stays live (so negotiation succeeds)
        // but captures silence until the user unmutes.
        localStream.getAudioTracks().forEach((track) => {
          track.enabled = false;
        });

        // Unmounted while the mic prompt was open: release the tracks at once
        // so the browser mic indicator doesn't stick on.
        if (isDestroyed) {
          localStream.getTracks().forEach((track) => track.stop());
          return;
        }

        setIsConnected(true);
        setIsMuted(true);
        // Seed the roster with self BEFORE joining: `voice:current-users` merges
        // around this entry, and the UI needs an immediate "you" row without
        // waiting for the server round-trip.
        setVoiceUsers([
          { userId, name: userName, image: userImage, isMuted: true },
        ]);

        // Analyse our own mic too — the speaking loop reads every analyser
        // including self, which drives our own talking indicator.
        setupAudioAnalysis(localStream, userId);

        // Joined LAST, only after mic + TURN + roster are ready: the server's
        // `voice:current-users` reply triggers outbound offers immediately, and
        // offering without a mic track would negotiate a recvonly dead call.
        socket.emit("voice:join", workspaceId);
      } catch (err) {
        console.error("Failed to initialize voice chat:", err);
      }
    }

    initVoice();

    return () => {
      // Teardown order matters: flag destruction (cancels in-flight init),
      // tell the server first (peers drop us from their UI), then close local
      // resources so no `voice:*` handler fires mid-cleanup.
      isDestroyed = true;
      socket.emit("voice:leave", workspaceId);
      setIsConnected(false);
      setVoiceUsers([]);

      for (const peerId of peersRef.current.keys()) {
        cleanupPeer(peerId);
      }
      // stop() (not just disable) releases the hardware: the OS mic indicator
      // clears and no capture continues in the background after leaving.
      if (localStreamRef.current) {
        localStreamRef.current.getTracks().forEach((track) => track.stop());
        localStreamRef.current = null;
      }

      // Self is never in peersRef (no loopback connection), so its analyser
      // needs separate teardown — otherwise our own AudioContext leaks.
      const ownAnalysis = analysersRef.current.get(userId);
      if (ownAnalysis) {
        try {
          ownAnalysis.audioCtx.close();
        } catch (e) {
          console.error(e);
        }
        analysersRef.current.delete(userId);
      }
    };
  }, [workspaceId, userId, setupAudioAnalysis, cleanupPeer]);

  // Factory: builds one RTCPeerConnection toward a single remote user.
  // NOTE: a fresh peer replaces any stale entry for the target — a re-joining
  // user reuses their id, and negotiating on a half-closed peer fails silently.
  const createPeerConnection = useCallback(
    (
      targetUserId: string,
      targetName: string,
      targetImage: string | null,
      iceServers: RTCIceServer[],
    ) => {
      if (peersRef.current.has(targetUserId)) {
        cleanupPeer(targetUserId);
      }

      // `iceTransportPolicy: "all"` lets WebRTC prefer host/srflx (low latency)
      // and fall back to TURN relay only when direct paths fail.
      const peer = new RTCPeerConnection({
        iceServers,
        iceTransportPolicy: "all",
      });

      // Trickle each candidate to the target as it's discovered — waiting for
      // gathering to complete would add seconds to join time. The final null
      // candidate (end-of-gathering) is intentionally not forwarded; the far
      // side needs no signal for it since queued candidates flush on answer.
      peer.onicecandidate = (event) => {
        if (event.candidate) {
          socket.emit("voice:ice-candidate", {
            workspaceId,
            targetUserId,
            candidate: event.candidate,
          });
        }
      };

      peer.ontrack = (event) => {
        const remoteStream = event.streams[0];
        if (!remoteStream) return;

        // Voice-only: a hidden autoplay element is enough, no visible player.
        const audio = document.createElement("audio");
        audio.srcObject = remoteStream;
        audio.autoplay = true;
        audio.style.display = "none";

        // Respect a deafen that happened before this track arrived.
        if (isDeafenedRef.current) {
          audio.volume = 0;
        } else {
          audio.volume = 1;
        }

        document.body.appendChild(audio);
        audioElementsRef.current.set(targetUserId, audio);

        setupAudioAnalysis(remoteStream, targetUserId);
      };

      // Share the single mic track with every peer (mesh) rather than one
      // stream per connection — getUserMedia is called exactly once. The
      // second arg binds the track to our stream so the far side's ontrack
      // receives it inside `event.streams[0]` instead of as a track orphan.
      if (localStreamRef.current) {
        localStreamRef.current.getTracks().forEach((track) => {
          peer.addTrack(track, localStreamRef.current!);
        });
      }

      // Registered BEFORE any offer/answer SDP flows: inbound ICE for this
      // peer may already be queued, and handlers look the peer up by id.
      peersRef.current.set(targetUserId, peer);
      return peer;
    },
    [workspaceId, setupAudioAnalysis, cleanupPeer],
  );

  // Signaling effect: subscribes to all server voice events once connected.
  // Re-subscribes when the connection flips so handlers are never attached
  // to a dead session, and unsubscribes symmetrically to prevent duplicate
  // handling after remounts (double offers = negotiation collisions).
  useEffect(() => {
    if (!isConnected) return;

    const handleCurrentUsers = async (data: { users: VoiceUser[] }) => {
      // Fresh TURN creds per mesh cycle: the 24h credential could have been
      // minted long ago in a long-lived tab, and stale creds fail allocation.
      const response = await fetch(
        `${process.env.NEXT_PUBLIC_BACKEND_URL}/api/turn/credentials`,
        { credentials: "include" },
      );
      if (!response.ok) return;
      const turnData = await response.json();
      const iceServers = turnData.responseObject.iceServers;

      // Keep self first: the roster doubles as the "who am I" record, and the
      // joiner (not the existing members) initiates an offer to each peer, so
      // exactly one offer exists per pair and no glare resolution is needed.
      setVoiceUsers((prev) => {
        const me = prev.find((u) => u.userId === userId);
        return me ? [me, ...data.users] : data.users;
      });

      // Sequential (not Promise.all): offers are independent, but a per-peer
      // try/catch keeps one failing negotiation (e.g. a user who left between
      // roster fetch and offer) from aborting the rest of the mesh.
      for (const u of data.users) {
        try {
          const peer = createPeerConnection(
            u.userId,
            u.name,
            u.image,
            iceServers,
          );
          // setLocalDescription BEFORE emitting: the local SDP must be the
          // peer's currentLocalDescription before any answer can be applied,
          // and emitting first would race the answer against this await.
          const offer = await peer.createOffer();
          await peer.setLocalDescription(offer);

          socket.emit("voice:offer", {
            workspaceId,
            targetUserId: u.userId,
            offer,
          });
        } catch (e) {
          console.error("Error initiating peer connection:", e);
        }
      }
    };

    // Late joiners are answered by US via the offer flow above — here we only
    // add the roster entry, optimistically muted until their mute-state arrives.
    // NOTE: the server's `voice:user-joined` carries id+name only (no avatar),
    // so image resolves later via `voice:current-users` refreshes or defaults.
    const handleUserJoined = (data: { userId: string; name: string }) => {
      setVoiceUsers((prev) => {
        // Dup guard: `voice:current-users` and `voice:user-joined` can race on
        // join (roster already includes the newcomer), and double entries
        // would spawn a second peer connection for the same user.
        if (prev.some((u) => u.userId === data.userId)) return prev;
        return [
          ...prev,
          { userId: data.userId, name: data.name, image: null, isMuted: true },
        ];
      });
    };

    const handleUserLeft = (data: { userId: string }) => {
      cleanupPeer(data.userId);
    };

    // Answer side: the EXISTING member handles the newcomer's offer (the
    // newcomer already offered to us in its handleCurrentUsers loop).
    const handleOffer = async (data: {
      fromUserId: string;
      offer: RTCSessionDescriptionInit;
    }) => {
      try {
        const response = await fetch(
          `${process.env.NEXT_PUBLIC_BACKEND_URL}/api/turn/credentials`,
          { credentials: "include" },
        );
        if (!response.ok) return;
        const turnData = await response.json();
        const iceServers = turnData.responseObject.iceServers;

        // Roster lookup via REF (not state): this handler was registered once
        // and its closed-over state is stale; the ref always has the latest.
        // "Peer"/null fallbacks cover offers from users not yet in our roster.
        const userDetails = voiceUsersRef.current.find(
          (u) => u.userId === data.fromUserId,
        );
        const name = userDetails?.name || "Peer";
        const image = userDetails?.image || null;

        const peer = createPeerConnection(
          data.fromUserId,
          name,
          image,
          iceServers,
        );
        // Remote first, then answer: the answer SDP is computed AGAINST the
        // offer (codecs, media sections), so reversing this order produces an
        // incompatible answer and the call never connects.
        await peer.setRemoteDescription(new RTCSessionDescription(data.offer));

        // Flush candidates that arrived before the offer (signaling order isn't
        // guaranteed) — they were queued in handleIceCandidate.
        const pending = pendingCandidatesRef.current.get(data.fromUserId) || [];
        for (const candidate of pending) {
          await peer.addIceCandidate(new RTCIceCandidate(candidate));
        }
        pendingCandidatesRef.current.delete(data.fromUserId);

        // Mirror of the offer path: local description set before emitting, so
        // our signaling state is stable when the far side's ICE arrives.
        const answer = await peer.createAnswer();
        await peer.setLocalDescription(answer);

        socket.emit("voice:answer", {
          workspaceId,
          targetUserId: data.fromUserId,
          answer,
        });
      } catch (e) {
        console.error("Error handling offer:", e);
      }
    };

    const handleAnswer = async (data: {
      fromUserId: string;
      answer: RTCSessionDescriptionInit;
    }) => {
      try {
        const peer = peersRef.current.get(data.fromUserId);
        // Unknown peers (left mid-handshake) are ignored — no peer, no work.
        if (peer) {
          await peer.setRemoteDescription(
            new RTCSessionDescription(data.answer),
          );

          // Same early-candidate flush as the offer path.
          const pending =
            pendingCandidatesRef.current.get(data.fromUserId) || [];
          for (const candidate of pending) {
            await peer.addIceCandidate(new RTCIceCandidate(candidate));
          }
          pendingCandidatesRef.current.delete(data.fromUserId);
        }
      } catch (e) {
        console.error("Error setting remote description:", e);
      }
    };

    const handleIceCandidate = async (data: {
      fromUserId: string;
      candidate: RTCIceCandidateInit;
    }) => {
      try {
        const peer = peersRef.current.get(data.fromUserId);
        // Queue candidates until the remote description exists — addIceCandidate
        // before setRemoteDescription throws InvalidStateError.
        if (!peer || !peer.remoteDescription) {
          const queue = pendingCandidatesRef.current.get(data.fromUserId) || [];
          queue.push(data.candidate);
          pendingCandidatesRef.current.set(data.fromUserId, queue);
          return;
        }
        await peer.addIceCandidate(new RTCIceCandidate(data.candidate));
      } catch (e) {
        console.error("Error adding ICE candidate:", e);
      }
    };

    // Display-only: the actual audio gating happens via track.enabled/volume
    // on the sender/receiver; this just keeps mic icons in sync. Our OWN
    // toggles never come back through here (server broadcasts with socket.to,
    // which excludes the sender), so self updates are applied optimistically
    // in toggleMute/toggleDeafen instead.
    const handleMuteState = (data: { userId: string; isMuted: boolean }) => {
      setVoiceUsers((prev) =>
        prev.map((u) =>
          u.userId === data.userId ? { ...u, isMuted: data.isMuted } : u,
        ),
      );
    };

    socket.on("voice:current-users", handleCurrentUsers);
    socket.on("voice:user-joined", handleUserJoined);
    socket.on("voice:user-left", handleUserLeft);
    socket.on("voice:offer", handleOffer);
    socket.on("voice:answer", handleAnswer);
    socket.on("voice:ice-candidate", handleIceCandidate);
    socket.on("voice:mute-state", handleMuteState);

    return () => {
      socket.off("voice:current-users", handleCurrentUsers);
      socket.off("voice:user-joined", handleUserJoined);
      socket.off("voice:user-left", handleUserLeft);
      socket.off("voice:offer", handleOffer);
      socket.off("voice:answer", handleAnswer);
      socket.off("voice:ice-candidate", handleIceCandidate);
      socket.off("voice:mute-state", handleMuteState);
    };
  }, [isConnected, workspaceId, createPeerConnection, cleanupPeer]);

  // Speaking loop: polls every AnalyserNode each animation frame and derives
  // the talking set from average frequency energy. Runs even when muted (a
  // muted mic reads ~0 energy, so it naturally reports silence).
  useEffect(() => {
    let active = true;

    function checkSpeaking() {
      // `active` guards the trailing frame: cancelAnimationFrame stops future
      // ticks, but one may already be queued after unmount — it must no-op.
      if (!active) return;

      const currentlySpeaking = new Set<string>();
      // 256 bins matches fftSize/2 (one byte per frequency bin). The buffer is
      // reused across peers within a frame — getByteFrequencyData overwrites
      // it fully on each call, so no stale-bin leakage between participants.
      const bufferLength = 256;
      const dataArray = new Uint8Array(bufferLength);

      analysersRef.current.forEach(({ analyser }, participantId) => {
        analyser.getByteFrequencyData(dataArray);
        let total = 0;
        dataArray.forEach((val) => {
          total += val;
        });
        // Mean energy across the spectrum: voice averages well above ambient
        // mic noise even at low volume, hence a single flat threshold works.
        const average = total / bufferLength;

        // Threshold 12/255 average energy; state only replaced when the set
        // actually changes to avoid re-rendering every animation frame.
        if (average > 12) {
          currentlySpeaking.add(participantId);
        }
      });

      // Identity-preserving update: returning `prev` when the set is equal
      // bails out of the render entirely (React skips identical state), which
      // is what keeps a 60fps poll from re-rendering 60 times a second.
      setSpeakingUsers((prev) => {
        const isSame =
          prev.size === currentlySpeaking.size &&
          [...currentlySpeaking].every((item) => prev.has(item));
        return isSame ? prev : currentlySpeaking;
      });

      // Self-perpetuating: each frame schedules the next, forming the poll
      // loop. The id is stored so unmount can break the chain.
      animationFrameRef.current = requestAnimationFrame(checkSpeaking);
    }

    animationFrameRef.current = requestAnimationFrame(checkSpeaking);

    return () => {
      active = false;
      if (animationFrameRef.current) {
        cancelAnimationFrame(animationFrameRef.current);
      }
    };
  }, []);

  /** Toggles mic; unmutes (undeafens) first when deafened. Syncs via `voice:mute-state`. */
  const toggleMute = useCallback(() => {
    // NOTE: all three state writes here (local flag, roster, server emit) are
    // needed because the server relays mute-state with socket.to (excludes the
    // sender) — without the optimistic local updates our own UI would lag a
    // full round-trip behind, or never update if the emit is lost.
    // Deafened + "unmute" really means "undeafen": restore remote audio and go
    // live in one gesture instead of leaving the user deaf but unmuted.
    if (isDeafened) {
      audioElementsRef.current.forEach((audio) => {
        audio.volume = 1;
      });
      localStreamRef.current?.getAudioTracks().forEach((track) => {
        track.enabled = true;
      });

      setIsDeafened(false);
      setIsMuted(false);
      setVoiceUsers((prev) =>
        prev.map((u) => (u.userId === userId ? { ...u, isMuted: false } : u)),
      );
      socket.emit("voice:mute-state", { workspaceId, isMuted: false });
      return;
    }

    if (!localStreamRef.current) return;
    // Mute = disable the track, not stop it: renegotiation is avoided and
    // unmuting is instant (peers just receive silence meanwhile).
    const nextMute = !isMuted;
    localStreamRef.current.getAudioTracks().forEach((track) => {
      track.enabled = !nextMute;
    });

    setIsMuted(nextMute);
    setVoiceUsers((prev) =>
      prev.map((u) => (u.userId === userId ? { ...u, isMuted: nextMute } : u)),
    );
    socket.emit("voice:mute-state", { workspaceId, isMuted: nextMute });
  }, [workspaceId, isMuted, isDeafened, userId]);

  /**
   * Toggles deafen: mutes mic + silences remote audio, remembering the prior
   * mute state so undeafening restores it instead of forcing unmute.
   */
  const toggleDeafen = useCallback(() => {
    const nextDeafen = !isDeafened;

    if (nextDeafen) {
      // Snapshot BEFORE muting: isMuted is about to become true, and the
      // pre-deafen value is what undeafening must restore.
      mutedBeforeDeafen.current = isMuted;

      localStreamRef.current?.getAudioTracks().forEach((track) => {
        track.enabled = false;
      });
      setIsMuted(true);
      setVoiceUsers((prev) =>
        prev.map((u) => (u.userId === userId ? { ...u, isMuted: true } : u)),
      );
      socket.emit("voice:mute-state", { workspaceId, isMuted: true });

      audioElementsRef.current.forEach((audio) => {
        audio.volume = 0;
      });
    } else {
      // Restore remote audio first so the first unmuted frames aren't clipped,
      // then re-apply whichever mic state predates the deafen.
      audioElementsRef.current.forEach((audio) => {
        audio.volume = 1;
      });
      const wasAlreadyMuted = mutedBeforeDeafen.current;
      localStreamRef.current?.getAudioTracks().forEach((track) => {
        track.enabled = !wasAlreadyMuted;
      });

      setIsMuted(wasAlreadyMuted);
      setVoiceUsers((prev) =>
        prev.map((u) =>
          u.userId === userId ? { ...u, isMuted: wasAlreadyMuted } : u,
        ),
      );
      socket.emit("voice:mute-state", {
        workspaceId,
        isMuted: wasAlreadyMuted,
      });
    }

    setIsDeafened(nextDeafen);
  }, [workspaceId, isDeafened, isMuted, userId]);

  return {
    isConnected,
    isMuted,
    isDeafened,
    voiceUsers,
    speakingUsers,
    toggleMute,
    toggleDeafen,
  };
}
