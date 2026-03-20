import React, { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '@/src/contexts/AuthContext';
import { useCall } from '@/src/contexts/CallContext';
import { supabase } from '@/src/lib/supabase';
import { Button } from '@/src/components/ui/button';
import { Input } from '@/src/components/ui/input';
import { Phone, Video, Send, Image as ImageIcon, Paperclip, LogOut, User as UserIcon, Check, CheckCheck, Mic, MicOff, VideoOff } from 'lucide-react';
import { format } from 'date-fns';

export default function Chat() {
  const { user, signOut } = useAuth();
  const navigate = useNavigate();
  const { initiateCall, incomingCall, currentCall, answerCall, rejectCall, endCall, localStream, remoteStream, isVideo } = useCall();
  
  const [conversations, setConversations] = useState<any[]>([]);
  const [activeConversation, setActiveConversation] = useState<any | null>(null);
  const [messages, setMessages] = useState<any[]>([]);
  const [newMessage, setNewMessage] = useState('');
  const [users, setUsers] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  
  const [callDuration, setCallDuration] = useState(0);
  const [isMuted, setIsMuted] = useState(false);
  const [isVideoOff, setIsVideoOff] = useState(false);
  const [showEndCallConfirm, setShowEndCallConfirm] = useState(false);
  
  const [isTyping, setIsTyping] = useState(false);
  const [remoteTyping, setRemoteTyping] = useState(false);
  const typingTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const remoteTypingTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const channelRef = useRef<any>(null);
  
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const localVideoRef = useRef<HTMLVideoElement>(null);
  const remoteVideoRef = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    if (!user) return;

    const checkProfile = async () => {
      const { data } = await supabase.from('users').select('name').eq('id', user.id).single();
      if (!data?.name || !user.email) {
        navigate('/profile');
      }
    };
    checkProfile();

    const setOnlineStatus = async (status: boolean) => {
      await supabase.from('users').update({ is_online: status }).eq('id', user.id);
    };

    setOnlineStatus(true);

    const handleVisibilityChange = () => {
      setOnlineStatus(document.visibilityState === 'visible');
    };

    const handleBeforeUnload = () => {
      setOnlineStatus(false);
    };

    document.addEventListener('visibilitychange', handleVisibilityChange);
    window.addEventListener('beforeunload', handleBeforeUnload);

    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      window.removeEventListener('beforeunload', handleBeforeUnload);
      setOnlineStatus(false);
    };
  }, [user]);

  useEffect(() => {
    if (localVideoRef.current && localStream) {
      localVideoRef.current.srcObject = localStream;
    }
  }, [localStream]);

  useEffect(() => {
    if (remoteVideoRef.current && remoteStream) {
      remoteVideoRef.current.srcObject = remoteStream;
    }
  }, [remoteStream]);

  useEffect(() => {
    fetchUsers();
    fetchConversations();
    
    setRemoteTyping(false);
    if (remoteTypingTimeoutRef.current) clearTimeout(remoteTypingTimeoutRef.current);

    // Subscribe to new messages
    const messageSubscription = supabase
      .channel('public:messages')
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'messages' }, payload => {
        if (payload.new.conversation_id === activeConversation?.id) {
          setMessages(prev => [...prev, payload.new]);
          scrollToBottom();
          
          if (payload.new.sender_id !== user?.id) {
            if (document.visibilityState === 'visible') {
              supabase.from('messages').update({ status: 'read' }).eq('id', payload.new.id).then();
            } else {
              supabase.from('messages').update({ status: 'delivered' }).eq('id', payload.new.id).then();
            }
          }
        } else if (payload.new.sender_id !== user?.id) {
          supabase.from('messages').update({ status: 'delivered' }).eq('id', payload.new.id).then();
        }
      })
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'messages' }, payload => {
        if (payload.new.conversation_id === activeConversation?.id) {
          setMessages(prev => prev.map(m => m.id === payload.new.id ? payload.new : m));
        }
      })
      .subscribe();

    // Setup broadcast channel for typing indicators
    let typingChannel: any = null;
    if (user?.id && activeConversation?.user?.id) {
      const channelName = `typing:${[user.id, activeConversation.user.id].sort().join('-')}`;
      typingChannel = supabase.channel(channelName)
        .on('broadcast', { event: 'typing_start' }, (payload) => {
          if (payload.payload.user_id !== user.id) {
            setRemoteTyping(true);
            if (remoteTypingTimeoutRef.current) clearTimeout(remoteTypingTimeoutRef.current);
            remoteTypingTimeoutRef.current = setTimeout(() => setRemoteTyping(false), 3000);
          }
        })
        .on('broadcast', { event: 'typing_stop' }, (payload) => {
          if (payload.payload.user_id !== user.id) {
            setRemoteTyping(false);
            if (remoteTypingTimeoutRef.current) clearTimeout(remoteTypingTimeoutRef.current);
          }
        })
        .subscribe();
      
      channelRef.current = typingChannel;
    }

    // Subscribe to user updates (for online status)
    const userSubscription = supabase
      .channel('public:users')
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'users' }, payload => {
        setUsers(prev => prev.map(u => u.id === payload.new.id ? { ...u, ...payload.new } : u));
        
        setActiveConversation(prev => {
          if (prev?.user?.id === payload.new.id) {
            return { ...prev, user: { ...prev.user, ...payload.new } };
          }
          return prev;
        });
      })
      .subscribe();

    return () => {
      supabase.removeChannel(messageSubscription);
      supabase.removeChannel(userSubscription);
      if (typingChannel) supabase.removeChannel(typingChannel);
    };
  }, [activeConversation, user?.id]);

  // Mark messages as read when visible on screen
  const observer = useRef<IntersectionObserver | null>(null);

  useEffect(() => {
    observer.current = new IntersectionObserver(
      (entries) => {
        if (document.visibilityState !== 'visible') return;
        
        const visibleUnreadIds: string[] = [];
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            const messageId = entry.target.getAttribute('data-message-id');
            const senderId = entry.target.getAttribute('data-sender-id');
            const status = entry.target.getAttribute('data-status');
            
            if (messageId && senderId !== user?.id && status !== 'read') {
              visibleUnreadIds.push(messageId);
              observer.current?.unobserve(entry.target);
            }
          }
        });

        if (visibleUnreadIds.length > 0) {
          supabase.from('messages').update({ status: 'read' }).in('id', visibleUnreadIds).then();
          setMessages(prev => prev.map(m => visibleUnreadIds.includes(m.id) ? { ...m, status: 'read' } : m));
        }
      },
      { threshold: 0.1 }
    );

    return () => {
      if (observer.current) {
        observer.current.disconnect();
      }
    };
  }, [user?.id]);

  // Handle visibility change to re-check elements
  useEffect(() => {
    const handleVisibility = () => {
      if (document.visibilityState === 'visible' && activeConversation && user) {
        const unreadMessages = messages.filter(m => m.sender_id !== user.id && m.status !== 'read');
        if (unreadMessages.length > 0) {
          const unreadIds = unreadMessages.map(m => m.id);
          supabase.from('messages').update({ status: 'read' }).in('id', unreadIds).then();
          setMessages(prev => prev.map(m => unreadIds.includes(m.id) ? { ...m, status: 'read' } : m));
        }
      }
    };

    handleVisibility();

    document.addEventListener('visibilitychange', handleVisibility);
    return () => document.removeEventListener('visibilitychange', handleVisibility);
  }, [messages, activeConversation, user]);

  const fetchUsers = async () => {
    const { data } = await supabase.from('users').select('*').neq('id', user?.id);
    if (data) setUsers(data);
  };

  const fetchConversations = async () => {
    // In a real app, you'd fetch conversations where the user is a participant
    // For simplicity, we'll just list users and create a conversation on the fly
    setLoading(false);
  };

  const fetchMessages = async (conversationId: string) => {
    const { data } = await supabase
      .from('messages')
      .select('*')
      .eq('conversation_id', conversationId)
      .order('timestamp', { ascending: true });
    
    if (data) setMessages(data);
    scrollToBottom();
  };

  const startConversation = async (otherUser: any) => {
    // Check if conversation exists
    const { data: existing } = await supabase
      .from('participants')
      .select('conversation_id')
      .eq('user_id', user?.id);
      
    // Simplified logic: just set active user
    setActiveConversation({ id: `conv-${otherUser.id}`, user: otherUser });
    fetchMessages(`conv-${otherUser.id}`);
  };

  const handleImageUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    if (!e.target.files || e.target.files.length === 0 || !activeConversation) return;
    const file = e.target.files[0];
    const fileExt = file.name.split('.').pop();
    const fileName = `${user?.id}-${Math.random()}.${fileExt}`;
    
    try {
      const { error: uploadError } = await supabase.storage
        .from('chat-media')
        .upload(fileName, file);

      if (uploadError) throw uploadError;

      const { data } = supabase.storage.from('chat-media').getPublicUrl(fileName);
      
      const msg = {
        conversation_id: activeConversation.id,
        sender_id: user?.id,
        content: data.publicUrl,
        type: 'image',
        status: 'sent',
        timestamp: new Date().toISOString()
      };

      await supabase.from('messages').insert([msg]);
    } catch (err) {
      console.error('Error uploading image', err);
    }
  };

  const handleTyping = (e: React.ChangeEvent<HTMLInputElement>) => {
    setNewMessage(e.target.value);

    if (!activeConversation || !channelRef.current) return;

    if (!isTyping) {
      setIsTyping(true);
      channelRef.current.send({
        type: 'broadcast',
        event: 'typing_start',
        payload: { user_id: user?.id }
      });
    }

    if (typingTimeoutRef.current) clearTimeout(typingTimeoutRef.current);
    
    typingTimeoutRef.current = setTimeout(() => {
      setIsTyping(false);
      channelRef.current?.send({
        type: 'broadcast',
        event: 'typing_stop',
        payload: { user_id: user?.id }
      });
    }, 2000);
  };

  const sendMessage = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newMessage.trim() || !activeConversation) return;

    const msg = {
      conversation_id: activeConversation.id,
      sender_id: user?.id,
      content: newMessage,
      type: 'text',
      status: 'sent',
      timestamp: new Date().toISOString()
    };

    setNewMessage('');
    
    if (isTyping && channelRef.current) {
      setIsTyping(false);
      if (typingTimeoutRef.current) clearTimeout(typingTimeoutRef.current);
      channelRef.current.send({
        type: 'broadcast',
        event: 'typing_stop',
        payload: { user_id: user?.id }
      });
    }

    await supabase.from('messages').insert([msg]);
  };

  useEffect(() => {
    let interval: NodeJS.Timeout;
    if (currentCall && remoteStream) {
      interval = setInterval(() => {
        setCallDuration(prev => prev + 1);
      }, 1000);
    } else if (!currentCall) {
      setCallDuration(0);
      setIsMuted(false);
      setIsVideoOff(false);
      setShowEndCallConfirm(false);
    }
    return () => {
      if (interval) clearInterval(interval);
    };
  }, [currentCall, remoteStream]);

  const formatDuration = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
  };

  const toggleMute = () => {
    if (localStream) {
      const newMutedState = !isMuted;
      localStream.getAudioTracks().forEach(track => {
        track.enabled = !newMutedState;
      });
      setIsMuted(newMutedState);
    }
  };

  const toggleVideo = () => {
    if (localStream) {
      const newVideoOffState = !isVideoOff;
      localStream.getVideoTracks().forEach(track => {
        track.enabled = !newVideoOffState;
      });
      setIsVideoOff(newVideoOffState);
    }
  };

  const scrollToBottom = () => {
    setTimeout(() => {
      messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }, 100);
  };

  const handleCall = (video: boolean) => {
    if (activeConversation?.user) {
      initiateCall(activeConversation.user.id, video);
    }
  };

  // Render Call UI overlay
  if (incomingCall || currentCall) {
    return (
      <div className="fixed inset-0 z-50 flex flex-col items-center justify-center bg-slate-900 text-white">
        {incomingCall && !currentCall && (
          <div className="flex flex-col items-center space-y-8">
            <div className="h-32 w-32 overflow-hidden rounded-full bg-slate-800">
              <UserIcon className="h-full w-full p-6 text-slate-500" />
            </div>
            <h2 className="text-2xl font-semibold">Incoming Call...</h2>
            <div className="flex space-x-6">
              <Button onClick={answerCall} className="h-16 w-16 rounded-full bg-green-500 hover:bg-green-600">
                <Phone className="h-8 w-8" />
              </Button>
              <Button onClick={rejectCall} className="h-16 w-16 rounded-full bg-red-500 hover:bg-red-600">
                <Phone className="h-8 w-8 rotate-[135deg]" />
              </Button>
            </div>
          </div>
        )}

        {currentCall && (
          <div className="relative h-full w-full">
            {isVideo && (
              <>
                <video
                  ref={remoteVideoRef}
                  autoPlay
                  playsInline
                  className="h-full w-full object-cover"
                />
                <video
                  ref={localVideoRef}
                  autoPlay
                  playsInline
                  muted
                  className={`absolute bottom-8 right-8 h-48 w-32 rounded-xl object-cover shadow-2xl border-2 border-white/20 transition-opacity ${isVideoOff ? 'opacity-0' : 'opacity-100'}`}
                />
                {isVideoOff && (
                  <div className="absolute bottom-8 right-8 h-48 w-32 rounded-xl bg-slate-800 flex items-center justify-center shadow-2xl border-2 border-white/20">
                    <UserIcon className="h-12 w-12 text-slate-500" />
                  </div>
                )}
                <div className="absolute top-8 left-1/2 -translate-x-1/2 bg-black/50 px-4 py-2 rounded-full backdrop-blur-md">
                  <p className="text-white font-mono">
                    {remoteStream ? formatDuration(callDuration) : 'Calling...'}
                  </p>
                </div>
              </>
            )}
            {!isVideo && (
              <div className="flex h-full flex-col items-center justify-center space-y-8">
                <div className="h-32 w-32 overflow-hidden rounded-full bg-slate-800">
                  <UserIcon className="h-full w-full p-6 text-slate-500" />
                </div>
                <h2 className="text-2xl font-semibold">{remoteStream ? 'In Call' : 'Calling...'}</h2>
                <p className="text-slate-400 font-mono text-xl">
                  {remoteStream ? formatDuration(callDuration) : 'Connecting...'}
                </p>
              </div>
            )}
            
            <div className="absolute bottom-12 left-1/2 flex -translate-x-1/2 space-x-6">
              <Button onClick={toggleMute} className={`h-16 w-16 rounded-full ${isMuted ? 'bg-slate-700 hover:bg-slate-600' : 'bg-slate-600 hover:bg-slate-500'}`}>
                {isMuted ? <MicOff className="h-8 w-8" /> : <Mic className="h-8 w-8" />}
              </Button>
              {isVideo && (
                <Button onClick={toggleVideo} className={`h-16 w-16 rounded-full ${isVideoOff ? 'bg-slate-700 hover:bg-slate-600' : 'bg-slate-600 hover:bg-slate-500'}`}>
                  {isVideoOff ? <VideoOff className="h-8 w-8" /> : <Video className="h-8 w-8" />}
                </Button>
              )}
              <Button onClick={() => setShowEndCallConfirm(true)} className="h-16 w-16 rounded-full bg-red-500 hover:bg-red-600">
                <Phone className="h-8 w-8 rotate-[135deg]" />
              </Button>
            </div>

            {showEndCallConfirm && (
              <div className="absolute inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
                <div className="bg-slate-800 p-6 rounded-2xl shadow-2xl max-w-sm w-full mx-4 border border-slate-700">
                  <h3 className="text-xl font-semibold mb-2 text-white">End Call?</h3>
                  <p className="text-slate-300 mb-6">Are you sure you want to end this call?</p>
                  <div className="flex space-x-4 justify-end">
                    <Button 
                      variant="outline" 
                      onClick={() => setShowEndCallConfirm(false)}
                      className="bg-transparent border-slate-600 text-slate-300 hover:bg-slate-700 hover:text-white"
                    >
                      Cancel
                    </Button>
                    <Button 
                      onClick={() => {
                        setShowEndCallConfirm(false);
                        endCall();
                      }}
                      className="bg-red-500 hover:bg-red-600 text-white"
                    >
                      End Call
                    </Button>
                  </div>
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="flex h-screen bg-slate-50">
      {/* Sidebar */}
      <div className="w-80 border-r border-slate-200 bg-white flex flex-col">
        <div className="p-4 border-b border-slate-200 flex items-center justify-between">
          <h1 className="text-xl font-bold text-slate-900">MedLine</h1>
          <Button variant="ghost" size="icon" onClick={signOut} className="h-8 w-8">
            <LogOut className="h-4 w-4" />
          </Button>
        </div>
        
        <div className="flex-1 overflow-y-auto">
          {users.map(u => (
            <div 
              key={u.id} 
              onClick={() => startConversation(u)}
              className={`flex cursor-pointer items-center p-4 hover:bg-slate-50 ${activeConversation?.user?.id === u.id ? 'bg-slate-100' : ''}`}
            >
              <div className="relative h-12 w-12 shrink-0">
                <div className="h-full w-full overflow-hidden rounded-full bg-slate-200">
                  {u.avatar_url ? (
                    <img src={u.avatar_url} alt={u.name} className="h-full w-full object-cover" />
                  ) : (
                    <UserIcon className="h-full w-full p-2 text-slate-400" />
                  )}
                </div>
                {u.is_online && (
                  <div className="absolute bottom-0 right-0 h-3.5 w-3.5 rounded-full border-2 border-white bg-green-500"></div>
                )}
              </div>
              <div className="ml-4 flex-1">
                <h3 className="font-semibold text-slate-900">{u.name || u.phone}</h3>
                <p className="text-sm text-slate-500 truncate">Tap to chat</p>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Main Chat Area */}
      <div className="flex-1 flex flex-col bg-slate-50">
        {activeConversation ? (
          <>
            {/* Chat Header */}
            <div className="flex items-center justify-between border-b border-slate-200 bg-white p-4">
              <div className="flex items-center">
                <div className="relative h-10 w-10 shrink-0">
                  <div className="h-full w-full overflow-hidden rounded-full bg-slate-200">
                    {activeConversation.user.avatar_url ? (
                      <img src={activeConversation.user.avatar_url} alt={activeConversation.user.name} className="h-full w-full object-cover" />
                    ) : (
                      <UserIcon className="h-full w-full p-2 text-slate-400" />
                    )}
                  </div>
                  {activeConversation.user.is_online && (
                    <div className="absolute bottom-0 right-0 h-3 w-3 rounded-full border-2 border-white bg-green-500"></div>
                  )}
                </div>
                <div className="ml-3">
                  <h2 className="font-semibold text-slate-900">{activeConversation.user.name || activeConversation.user.phone}</h2>
                  {remoteTyping ? (
                    <p className="text-xs text-indigo-500 italic">User is typing...</p>
                  ) : (
                    <p className={`text-xs ${activeConversation.user.is_online ? 'text-green-500' : 'text-slate-400'}`}>
                      {activeConversation.user.is_online ? 'Online' : 'Offline'}
                    </p>
                  )}
                </div>
              </div>
              <div className="flex space-x-2">
                <Button variant="ghost" size="icon" onClick={() => handleCall(false)}>
                  <Phone className="h-5 w-5 text-slate-600" />
                </Button>
                <Button variant="ghost" size="icon" onClick={() => handleCall(true)}>
                  <Video className="h-5 w-5 text-slate-600" />
                </Button>
              </div>
            </div>

            {/* Messages */}
            <div className="flex-1 overflow-y-auto p-4 space-y-4">
              {messages.map((msg, idx) => {
                const isMe = msg.sender_id === user?.id;
                return (
                  <div 
                    key={msg.id || idx} 
                    className={`flex ${isMe ? 'justify-end' : 'justify-start'}`}
                    ref={(el) => {
                      if (el && !isMe && msg.status !== 'read' && observer.current) {
                        observer.current.observe(el);
                      }
                    }}
                    data-message-id={msg.id}
                    data-sender-id={msg.sender_id}
                    data-status={msg.status}
                  >
                    <div className={`max-w-[70%] rounded-2xl px-4 py-2 ${isMe ? 'bg-indigo-600 text-white rounded-br-none' : 'bg-white text-slate-900 rounded-bl-none shadow-sm'}`}>
                      {msg.type === 'image' ? (
                        <img src={msg.content} alt="Attachment" className="max-w-full rounded-lg" />
                      ) : (
                        <p>{msg.content}</p>
                      )}
                      <div className={`mt-1 flex items-center text-[10px] ${isMe ? 'justify-end text-indigo-200' : 'justify-start text-slate-400'}`}>
                        <span>{format(new Date(msg.timestamp), 'HH:mm')}</span>
                        {isMe && (
                          <span className="ml-1" title={msg.status}>
                            {msg.status === 'read' ? (
                              <CheckCheck className="h-3.5 w-3.5 text-white" aria-label="read" />
                            ) : msg.status === 'delivered' ? (
                              <CheckCheck className="h-3.5 w-3.5 text-indigo-300" aria-label="delivered" />
                            ) : (
                              <Check className="h-3.5 w-3.5 text-indigo-300" aria-label="sent" />
                            )}
                          </span>
                        )}
                      </div>
                    </div>
                  </div>
                );
              })}
              <div ref={messagesEndRef} />
            </div>

            {/* Input Area */}
            <div className="border-t border-slate-200 bg-white p-4">
              <form onSubmit={sendMessage} className="flex items-center space-x-2">
                <Button type="button" variant="ghost" size="icon" className="shrink-0 text-slate-500">
                  <Paperclip className="h-5 w-5" />
                </Button>
                <div className="relative">
                  <Button type="button" variant="ghost" size="icon" className="shrink-0 text-slate-500">
                    <ImageIcon className="h-5 w-5" />
                  </Button>
                  <input
                    type="file"
                    accept="image/*"
                    onChange={handleImageUpload}
                    className="absolute inset-0 cursor-pointer opacity-0"
                  />
                </div>
                <Input
                  value={newMessage}
                  onChange={handleTyping}
                  placeholder="Type a message..."
                  className="flex-1 rounded-full bg-slate-100 border-transparent focus-visible:ring-indigo-500"
                />
                <Button type="submit" className="shrink-0 rounded-full h-10 w-10 p-0 bg-indigo-600 hover:bg-indigo-700">
                  <Send className="h-5 w-5" />
                </Button>
              </form>
            </div>
          </>
        ) : (
          <div className="flex h-full items-center justify-center text-slate-400">
            <div className="text-center">
              <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-slate-200">
                <Send className="h-8 w-8 text-slate-400" />
              </div>
              <p>Select a conversation to start messaging</p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
