import { VoiceUser } from "@nimbus/types";
import { useCallback, useEffect, useRef, useState } from "react";
import { socket } from "../lib/socket";

export interface UseVoiceChatProps {
  userId: string;
  userName: string;
  userImage: string | null;
  workspaceId: string;
}

export function useVoiceChat({
  userId,
  userName,
  userImage,
  workspaceId,
}: UseVoiceChatProps) {
  const [isConnected, setIsConnected] = useState(false);
  const [isMuted, setIsMuted] = useState(true);
  const [isDeafened, setIsDeafened] = useState(false);
  const [voiceUsers, setVoiceUsers] = useState<VoiceUser[]>([]);
  const [speakingUsers, setSpeakingUsers] = useState<Set<string>>(new Set());

  const localStreamRef = useRef<MediaStream | null>(null);
  const peersRef = useRef<Map<string, RTCPeerConnection>>(new Map());
  const audioElementsRef = useRef<Map<string, HTMLAudioElement>>(new Map());
  const analysersRef = useRef<
    Map<string, { analyser: AnalyserNode; audioCtx: AudioContext }>
  >(new Map());
  const animationFrameRef = useRef<number | null>(null);

  const isMutedRef = useRef(true);
  const isDeafenedRef = useRef(false);

  useEffect(() => {
    isMutedRef.current = isMuted;
  }, [isMuted]);

  useEffect(() => {
    isDeafenedRef.current = isDeafened;
  }, [isDeafened]);

  const cleanupPeer = useCallback((peerId: string) => {
    const peer = peersRef.current.get(peerId);
    if (peer) {
      peer.close();
      peersRef.current.delete(peerId);
    }

    const audio = audioElementsRef.current.get(peerId);
    if (audio) {
      audio.srcObject = null;
      audio.remove();
      audioElementsRef.current.delete(peerId);
    }

    const analysis = analysersRef.current.get(peerId);
    if (analysis) {
      try {
        analysis.audioCtx.close();
      } catch (e) {
        console.error("Error closing AudioContext:", e);
      }
      analysersRef.current.delete(peerId);
    }

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

  const setupAudioAnalysis = useCallback(
    (stream: MediaStream, peerId: string) => {
      try {
        const AudioContextClass =
          window.AudioContext || (window as any).webkitAudioContext;
        const audioCtx = new AudioContextClass();
        const source = audioCtx.createMediaStreamSource(stream);
        const analyser = audioCtx.createAnalyser();
        analyser.fftSize = 512;
        analyser.minDecibels = -90;
        analyser.maxDecibels = -10;
        analyser.smoothingTimeConstant = 0.85;

        source.connect(analyser);

        analysersRef.current.set(peerId, { analyser, audioCtx });
      } catch (e) {
        console.error("Failed to initialize audio analyzer", e);
      }
    },
    [],
  );

  useEffect(() => {
    if (!workspaceId) return;

    let isDestroyed = false;
    let localStream: MediaStream | null = null;
    let iceServers: RTCIceServer[] = [];

    async function initVoice() {
      try {
        const response = await fetch(
          `${process.env.NEXT_PUBLIC_BACKEND_URL}/api/turn/credentials`,
          { credentials: "include" },
        );
        if (!response.ok) {
          throw new Error("Failed to fetch ICE configuration");
        }
        const data = await response.json();
        iceServers = data.responseObject.iceServers;

        if (isDestroyed) return;

        localStream = await navigator.mediaDevices.getUserMedia({
          audio: true,
        });
        localStreamRef.current = localStream;

        localStream.getAudioTracks().forEach((track) => {
          track.enabled = false;
        });

        if (isDestroyed) {
          localStream.getTracks().forEach((track) => track.stop());
          return;
        }

        setIsConnected(true);
        setIsMuted(true);

        setupAudioAnalysis(localStream, userId);

        socket.emit("voice:join", workspaceId);
      } catch (err) {
        console.error("Failed to initialize voice chat:", err);
      }
    }

    initVoice();

    return () => {
      isDestroyed = true;
      socket.emit("voice:leave", workspaceId);
      setIsConnected(false);

      for (const peerId of peersRef.current.keys()) {
        cleanupPeer(peerId);
      }
      if (localStreamRef.current) {
        localStreamRef.current.getTracks().forEach((track) => track.stop());
        localStreamRef.current = null;
      }

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

      const peer = new RTCPeerConnection({ iceServers });

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

        const audio = document.createElement("audio");
        audio.srcObject = remoteStream;
        audio.autoplay = true;
        audio.style.display = "none";

        if (isDeafenedRef.current) {
          audio.volume = 0;
        } else {
          audio.volume = 1;
        }

        document.body.appendChild(audio);
        audioElementsRef.current.set(targetUserId, audio);

        setupAudioAnalysis(remoteStream, targetUserId);
      };

      if (localStreamRef.current) {
        localStreamRef.current.getTracks().forEach((track) => {
          peer.addTrack(track, localStreamRef.current!);
        });
      }

      peersRef.current.set(targetUserId, peer);
      return peer;
    },
    [workspaceId, setupAudioAnalysis, cleanupPeer],
  );

  useEffect(() => {
    if (!isConnected) return;

    const handleCurrentUsers = async (data: { users: VoiceUser[] }) => {
      const response = await fetch(
        `${process.env.NEXT_PUBLIC_BACKEND_URL}/api/turn/credentials`,
        { credentials: "include" },
      );
      if (!response.ok) return;
      const turnData = await response.json();
      const iceServers = turnData.responseObject.iceServers;

      setVoiceUsers(data.users);

      for (const u of data.users) {
        try {
          const peer = createPeerConnection(
            u.userId,
            u.name,
            u.image,
            iceServers,
          );
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

    const handleUserJoined = (data: { userId: string; name: string }) => {
      setVoiceUsers((prev) => {
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

        const userDetails = voiceUsers.find(
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
        await peer.setRemoteDescription(new RTCSessionDescription(data.offer));

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
        if (peer) {
          await peer.setRemoteDescription(
            new RTCSessionDescription(data.answer),
          );
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
        if (peer) {
          await peer.addIceCandidate(new RTCIceCandidate(data.candidate));
        }
      } catch (e) {
        console.error("Error adding ICE candidate:", e);
      }
    };

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
  }, [isConnected, workspaceId, voiceUsers, createPeerConnection, cleanupPeer]);

  useEffect(() => {
    let active = true;

    function checkSpeaking() {
      if (!active) return;

      const currentlySpeaking = new Set<string>();
      const bufferLength = 256;
      const dataArray = new Uint8Array(bufferLength);

      analysersRef.current.forEach(({ analyser }, participantId) => {
        analyser.getByteFrequencyData(dataArray);
        let total = 0;
        dataArray.forEach((val) => {
          total += val;
        });
        const average = total / bufferLength;

        if (average > 12) {
          currentlySpeaking.add(participantId);
        }
      });

      setSpeakingUsers((prev) => {
        const isSame =
          prev.size === currentlySpeaking.size &&
          [...currentlySpeaking].every((item) => prev.has(item));
        return isSame ? prev : currentlySpeaking;
      });

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

  const toggleMute = useCallback(() => {
    if (!localStreamRef.current) return;
    const nextMute = !isMuted;

    localStreamRef.current.getAudioTracks().forEach((track) => {
      track.enabled = !nextMute;
    });

    setIsMuted(nextMute);
    socket.emit("voice:mute-state", { workspaceId, isMuted: nextMute });
  }, [workspaceId, isMuted]);

  const toggleDeafen = useCallback(() => {
    const nextDeafen = !isDeafened;
    setIsDeafened(nextDeafen);

    if (nextDeafen) {
      if (localStreamRef.current) {
        localStreamRef.current.getAudioTracks().forEach((track) => {
          track.enabled = false;
        });
      }
      setIsMuted(true);
      socket.emit("voice:mute-state", { workspaceId, isMuted: true });

      audioElementsRef.current.forEach((audio) => {
        audio.volume = 0;
      });
    } else {
      audioElementsRef.current.forEach((audio) => {
        audio.volume = 1;
      });

      if (localStreamRef.current) {
        localStreamRef.current.getAudioTracks().forEach((track) => {
          track.enabled = true;
        });
      }
      setIsMuted(false);
      socket.emit("voice:mute-state", { workspaceId, isMuted: false });
    }
  }, [workspaceId, isDeafened]);

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
