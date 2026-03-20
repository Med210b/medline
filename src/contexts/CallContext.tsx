import React, { createContext, useContext, useEffect, useState, useRef } from 'react';
import Peer, { MediaConnection } from 'peerjs';
import { useAuth } from '@/src/contexts/AuthContext';
import { supabase } from '@/src/lib/supabase';

interface CallContextType {
  peer: Peer | null;
  incomingCall: any | null;
  currentCall: MediaConnection | null;
  remoteStream: MediaStream | null;
  localStream: MediaStream | null;
  isVideo: boolean;
  isCaller: boolean;
  initiateCall: (receiverId: string, isVideo: boolean) => void;
  answerCall: () => void;
  rejectCall: () => void;
  endCall: () => void;
}

const CallContext = createContext<CallContextType | undefined>(undefined);

export function CallProvider({ children }: { children: React.ReactNode }) {
  const { user } = useAuth();
  const [peer, setPeer] = useState<Peer | null>(null);
  const [incomingCall, setIncomingCall] = useState<any | null>(null);
  const [currentCall, setCurrentCall] = useState<MediaConnection | null>(null);
  const [remoteStream, setRemoteStream] = useState<MediaStream | null>(null);
  const [localStream, setLocalStream] = useState<MediaStream | null>(null);
  const [isVideo, setIsVideo] = useState(false);
  const [isCaller, setIsCaller] = useState(false);

  useEffect(() => {
    if (!user) return;

    const newPeer = new Peer(user.id);
    setPeer(newPeer);

    newPeer.on('call', (call) => {
      setIncomingCall(call);
      setIsVideo(call.metadata?.isVideo || false);
      
      // Play ringtone
      const audio = new Audio('/ringtone.mp3');
      audio.loop = true;
      audio.play().catch(e => console.error("Audio play failed", e));
      (window as any).ringtoneAudio = audio;
    });

    return () => {
      newPeer.destroy();
    };
  }, [user]);

  const initiateCall = async (receiverId: string, video: boolean) => {
    if (!peer) return;
    setIsVideo(video);
    setIsCaller(true);

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video,
        audio: true,
      });
      setLocalStream(stream);

      const call = peer.call(receiverId, stream, { metadata: { isVideo: video } });
      setCurrentCall(call);

      call.on('stream', (remoteStream) => {
        setRemoteStream(remoteStream);
      });

      call.on('close', () => {
        endCall();
      });

    } catch (err) {
      console.error('Failed to get local stream', err);
    }
  };

  const answerCall = async () => {
    if (!incomingCall) return;

    if ((window as any).ringtoneAudio) {
      (window as any).ringtoneAudio.pause();
      (window as any).ringtoneAudio = null;
    }

    setIsCaller(false);

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: isVideo,
        audio: true,
      });
      setLocalStream(stream);

      incomingCall.answer(stream);
      setCurrentCall(incomingCall);
      setIncomingCall(null);

      incomingCall.on('stream', (remoteStream: MediaStream) => {
        setRemoteStream(remoteStream);
      });

      incomingCall.on('close', () => {
        endCall();
      });

    } catch (err) {
      console.error('Failed to get local stream', err);
    }
  };

  const rejectCall = () => {
    if (incomingCall) {
      incomingCall.close();
      setIncomingCall(null);
    }
    if ((window as any).ringtoneAudio) {
      (window as any).ringtoneAudio.pause();
      (window as any).ringtoneAudio = null;
    }
  };

  const endCall = () => {
    if (currentCall) {
      currentCall.close();
      setCurrentCall(null);
    }
    if (localStream) {
      localStream.getTracks().forEach(track => track.stop());
      setLocalStream(null);
    }
    setRemoteStream(null);
    setIncomingCall(null);
    if ((window as any).ringtoneAudio) {
      (window as any).ringtoneAudio.pause();
      (window as any).ringtoneAudio = null;
    }
  };

  return (
    <CallContext.Provider value={{ peer, incomingCall, currentCall, remoteStream, localStream, isVideo, isCaller, initiateCall, answerCall, rejectCall, endCall }}>
      {children}
    </CallContext.Provider>
  );
}

export function useCall() {
  const context = useContext(CallContext);
  if (context === undefined) {
    throw new Error('useCall must be used within a CallProvider');
  }
  return context;
}
