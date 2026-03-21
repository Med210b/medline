import React, { createContext, useContext, useState, useEffect, useRef } from 'react';
import { supabase } from '@/src/lib/supabase';
import { useAuth } from '@/src/contexts/AuthContext';

// We use Google's Public STUN servers to bypass Wi-Fi and 4G/5G Firewalls
const ICE_SERVERS = {
  iceServers: [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun1.l.google.com:19302' },
    { urls: 'stun:stun2.l.google.com:19302' },
    { urls: 'stun:stun3.l.google.com:19302' },
  ]
};

const CallContext = createContext<any>(null);

export function CallProvider({ children }: { children: React.ReactNode }) {
  const { user } = useAuth();
  
  const [localStream, setLocalStream] = useState<MediaStream | null>(null);
  const [remoteStream, setRemoteStream] = useState<MediaStream | null>(null);
  const [incomingCall, setIncomingCall] = useState<any>(null);
  const [currentCall, setCurrentCall] = useState<any>(null);
  const [isVideo, setIsVideo] = useState(false);
  const [isCaller, setIsCaller] = useState(false);
  const [filterIndex, setFilterIndex] = useState(0);

  const pcRef = useRef<RTCPeerConnection | null>(null);
  const channelRef = useRef<any>(null);
  const unprocessedStreamRef = useRef<MediaStream | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const internalVideoRef = useRef<HTMLVideoElement | null>(null);

  const FILTER_OPTIONS = [
    'none',
    'blur(2px) saturate(110%)', // Portrait Soft
    'grayscale(100%)',
    'sepia(100%)',
    'invert(100%)',
    'hue-rotate(90deg) saturate(130%)', // Green Screen-ish
    'contrast(80%) saturate(80%)', // Low Contrast
    'grayscale(100%) contrast(160%)', // Noir (High Contrast B&W)
  ];

  // SIGNALING SETUP
  useEffect(() => {
    if (!user) return;

    const channel = supabase.channel('global_calls', {
      config: { broadcast: { ack: false } }
    });

    channel.on('broadcast', { event: 'call-signal' }, async ({ payload }) => {
      // Ignore signals not meant for us
      if (payload.targetId !== user.id) return;

      if (payload.type === 'offer') {
        setIncomingCall({ callerId: payload.senderId, offer: payload.data.offer, isVideo: payload.data.video });
      }

      if (payload.type === 'answer' && pcRef.current) {
        await pcRef.current.setRemoteDescription(new RTCSessionDescription(payload.data));
      }

      if (payload.type === 'ice-candidate' && pcRef.current) {
        try {
          await pcRef.current.addIceCandidate(new RTCIceCandidate(payload.data));
        } catch (e) {
          console.error("Error adding received ice candidate", e);
        }
      }

      if (payload.type === 'end-call' || payload.type === 'reject-call') {
        cleanupCall();
      }
    }).subscribe();

    channelRef.current = channel;

    return () => {
      supabase.removeChannel(channel);
    };
  }, [user]);

  // VIDEO FRAME PROCESSING LOOP
  useEffect(() => {
    const internalVideo = internalVideoRef.current;
    const canvas = canvasRef.current;
    if (!internalVideo || !canvas || !unprocessedStreamRef.current || !currentCall) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const stream = unprocessedStreamRef.current;
    const videoTrack = stream.getVideoTracks()[0];
    if (!videoTrack) return;

    // Use internal video for processing
    internalVideo.srcObject = stream;
    internalVideo.muted = true;
    internalVideo.play().catch(e => console.error("Error playing internal video:", e));

    const settings = videoTrack.getSettings();
    canvas.width = settings.width || 640;
    canvas.height = settings.height || 480;

    const processFrame = () => {
        if (!pcRef.current || !currentCall) {
            internalVideo.pause();
            internalVideo.srcObject = null;
            return; // Stop if the call ended
        }
        
        ctx.filter = FILTER_OPTIONS[filterIndex];
        ctx.drawImage(internalVideo, 0, 0, canvas.width, canvas.height);
        requestAnimationFrame(processFrame);
    };
    
    internalVideo.onloadedmetadata = () => {
        requestAnimationFrame(processFrame);
    };

    return () => {
        internalVideo.pause();
        internalVideo.srcObject = null;
    }
  }, [currentCall, filterIndex, isVideo]);

  const sendSignal = (targetId: string, type: string, data: any) => {
    if (channelRef.current && user) {
      channelRef.current.send({
        type: 'broadcast',
        event: 'call-signal',
        payload: { targetId, senderId: user.id, type, data }
      }).catch((err: any) => console.error("Signaling error:", err));
    }
  };

  const cleanupCall = () => {
    if (pcRef.current) {
      pcRef.current.close();
      pcRef.current = null;
    }
    // Stop all media tracks to turn off camera/mic recording light
    if (unprocessedStreamRef.current) {
      unprocessedStreamRef.current.getTracks().forEach(track => track.stop());
    }
    if (localStream) {
      localStream.getTracks().forEach(track => track.stop());
    }
    unprocessedStreamRef.current = null;
    setLocalStream(null);
    setRemoteStream(null);
    setCurrentCall(null);
    setIncomingCall(null);
    setIsCaller(false);
    setIsVideo(false);
    setFilterIndex(0);
  };

  const initiateCall = async (targetId: string, video: boolean) => {
    setIsVideo(video);
    setIsCaller(true);
    setCurrentCall({ targetId, peerConnection: null });

    try {
      // 1. Get raw, unprocessed media stream
      const rawStream = await navigator.mediaDevices.getUserMedia({ video, audio: true });
      unprocessedStreamRef.current = rawStream;

      // 2. Initialize connection
      const pc = new RTCPeerConnection(ICE_SERVERS);
      pcRef.current = pc;
      setCurrentCall({ targetId, peerConnection: pc });

      let streamToSend;
      
      if (video && canvasRef.current) {
        // Create canvas capture stream with applied filters
        const canvasStream = (canvasRef.current as any).captureStream(30);
        // Combine video from canvas and audio from raw stream
        const audioTrack = rawStream.getAudioTracks()[0];
        if (audioTrack) {
          canvasStream.addTrack(audioTrack);
        }
        streamToSend = canvasStream;
      } else {
        streamToSend = rawStream;
      }

      setLocalStream(streamToSend);
      
      // 3. Add stream tracks to connection
      streamToSend.getTracks().forEach(track => pc.addTrack(track, streamToSend));

      // 4. Handle incoming remote stream
      pc.ontrack = (event) => {
        if (event.streams && event.streams[0]) {
          setRemoteStream(event.streams[0]);
        }
      };

      // 5. Handle and send networking Ice candidates
      pc.onicecandidate = (event) => {
        if (event.candidate) {
          sendSignal(targetId, 'ice-candidate', event.candidate);
        }
      };

      // 6. Create call offer and send to other person
      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);
      sendSignal(targetId, 'offer', { offer, video });

    } catch (err) {
      console.error("Failed to access Camera/Microphone:", err);
      alert("Call failed: Please ensure you have granted Camera and Microphone permissions in your browser.");
      cleanupCall();
    }
  };

  const answerCall = async () => {
    if (!incomingCall) return;
    setIsVideo(incomingCall.isVideo);
    setIsCaller(false);

    try {
      const rawStream = await navigator.mediaDevices.getUserMedia({ video: incomingCall.isVideo, audio: true });
      unprocessedStreamRef.current = rawStream;

      const pc = new RTCPeerConnection(ICE_SERVERS);
      pcRef.current = pc;
      setCurrentCall({ targetId: incomingCall.callerId, peerConnection: pc });

      let streamToSend;
      
      if (incomingCall.isVideo && canvasRef.current) {
        // Create canvas capture stream with applied filters
        const canvasStream = (canvasRef.current as any).captureStream(30);
        const audioTrack = rawStream.getAudioTracks()[0];
        if (audioTrack) {
          canvasStream.addTrack(audioTrack);
        }
        streamToSend = canvasStream;
      } else {
        streamToSend = rawStream;
      }

      setLocalStream(streamToSend);
      
      streamToSend.getTracks().forEach(track => pc.addTrack(track, streamToSend));

      pc.ontrack = (event) => {
        if (event.streams && event.streams[0]) {
          setRemoteStream(event.streams[0]);
        }
      };

      pc.onicecandidate = (event) => {
        if (event.candidate) {
          sendSignal(incomingCall.callerId, 'ice-candidate', event.candidate);
        }
      };

      // Set the caller's offer
      await pc.setRemoteDescription(new RTCSessionDescription(incomingCall.offer));
      
      // Create and send our call answer back
      const answer = await pc.createAnswer();
      await pc.setLocalDescription(answer);
      sendSignal(incomingCall.callerId, 'answer', answer);
      
      setIncomingCall(null);
    } catch (err) {
      console.error("Failed to answer call:", err);
      alert("Could not answer: Please grant Camera/Microphone permissions.");
      rejectCall();
    }
  };

  const rejectCall = async () => {
    if (incomingCall && user) {
      sendSignal(incomingCall.callerId, 'reject-call', null);
      
      // Log missed call to database history
      const conversationId = `conv_${[user.id, incomingCall.callerId].sort().join('_')}`;
      await supabase.from('messages').insert([{
         conversation_id: conversationId,
         sender_id: incomingCall.callerId,
         content: JSON.stringify({ type: incomingCall.isVideo ? 'video' : 'voice', duration: 0 }),
         type: 'call',
         status: 'missed',
         timestamp: new Date().toISOString()
      }]);
    }
    cleanupCall();
  };

  const endCall = async () => {
    const targetId = currentCall?.targetId || incomingCall?.callerId;
    if (targetId && user) {
      sendSignal(targetId, 'end-call', null);
      
      // Log ended call to database history
      const conversationId = `conv_${[user.id, targetId].sort().join('_')}`;
      await supabase.from('messages').insert([{
         conversation_id: conversationId,
         sender_id: user.id,
         content: JSON.stringify({ type: isVideo ? 'video' : 'voice', duration: 0 }),
         type: 'call',
         status: 'ended',
         timestamp: new Date().toISOString()
      }]);
    }
    cleanupCall();
  };

  const cycleFilter = () => {
    setFilterIndex((prev) => (prev + 1) % FILTER_OPTIONS.length);
  };

  return (
    <CallContext.Provider value={{
      initiateCall,
      incomingCall,
      currentCall,
      answerCall,
      rejectCall,
      endCall,
      localStream,
      remoteStream,
      isVideo,
      isCaller,
      cycleFilter,
      filterIndex,
      FILTER_OPTIONS
    }}>
      {children}
      {/* Invisible elements for frame-by-frame processing */}
      <canvas ref={canvasRef} style={{ display: 'none' }} />
      <video ref={internalVideoRef} style={{ display: 'none' }} muted playsInline />
    </CallContext.Provider>
  );
}

export function useCall() {
  return useContext(CallContext);
}