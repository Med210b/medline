import React, { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '@/src/contexts/AuthContext';
import { useCall } from '@/src/contexts/CallContext';
import { supabase } from '@/src/lib/supabase';
import { Button } from '@/src/components/ui/button';
import { Input } from '@/src/components/ui/input';
import { Phone, Video, Send, Image as ImageIcon, Paperclip, LogOut, User as UserIcon, Check, CheckCheck, Mic, MicOff, VideoOff, Settings, Search } from 'lucide-react';
import { format } from 'date-fns';
import { playNotificationSound, showNotification } from '@/src/hooks/useNotifications';
import PhoneInput from 'react-phone-number-input';
import 'react-phone-number-input/style.css';

export default function Chat() {
  const { user, signOut } = useAuth();
  const navigate = useNavigate();
  const { initiateCall, incomingCall, currentCall, answerCall, rejectCall, endCall, localStream, remoteStream, isVideo, isCaller } = useCall();
  
  const [activeTab, setActiveTab] = useState<'chats' | 'calls'>('chats');
  const [callHistory, setCallHistory] = useState<any[]>([]);
  const [conversations, setConversations] = useState<any[]>([]);
  const [activeConversation, setActiveConversation] = useState<any | null>(null);
  const [messages, setMessages] = useState<any[]>([]);
  const [newMessage, setNewMessage] = useState('');
  
  // Contacts & Users State
  const [users, setUsers] = useState<any[]>([]);
  const [searchQuery, setSearchQuery] = useState('');
  
  // Modals State
  const [showCreateGroup, setShowCreateGroup] = useState(false);
  const [newGroupName, setNewGroupName] = useState('');
  const [selectedUsers, setSelectedUsers] = useState<string[]>([]);
  
  const [showNewChat, setShowNewChat] = useState(false);
  const [searchPhone, setSearchPhone] = useState<string | undefined>('');
  const [searchError, setSearchError] = useState('');

  const usersRef = useRef<any[]>([]);
  
  useEffect(() => {
    usersRef.current = users;
  }, [users]);

  const [loading, setLoading] = useState(true);
  
  const [callDuration, setCallDuration] = useState(0);
  const [isMuted, setIsMuted] = useState(false);
  const [isVideoOff, setIsVideoOff] = useState(false);
  const [showEndCallConfirm, setShowEndCallConfirm] = useState(false);
  
  const callDurationRef = useRef(0);
  const previousCallRef = useRef<any>(null);

  useEffect(() => {
    if (currentCall) {
      previousCallRef.current = currentCall;
    } else if (previousCallRef.current) {
      if (isCaller && user) {
        const duration = callDurationRef.current;
        const isVideoCall = isVideo;
        const peerId = previousCallRef.current.peer;
        
        const conversationId = `conv-${[user.id, peerId].sort().join('-')}`;
        
        const msg = {
          conversation_id: conversationId,
          sender_id: user.id,
          content: JSON.stringify({ type: isVideoCall ? 'video' : 'voice', duration }),
          type: 'call',
          status: duration > 0 ? 'ended' : 'missed',
          timestamp: new Date().toISOString()
        };
        
        supabase.from('messages').insert([msg]).then();
      }
      previousCallRef.current = null;
      callDurationRef.current = 0;
    }
  }, [currentCall, isCaller, user, isVideo]);
  
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
    fetchCallHistory();
    
    setRemoteTyping(false);
    if (remoteTypingTimeoutRef.current) clearTimeout(remoteTypingTimeoutRef.current);

    // Subscribe to new messages
    const messageSubscription = supabase
      .channel('public:messages')
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'messages' }, payload => {
        
        // Dynamically add a new user to the sidebar if they message you for the first time
        if (payload.new.conversation_id && payload.new.conversation_id.includes(user?.id)) {
          if (payload.new.conversation_id.startsWith('conv-')) {
            const ids = payload.new.conversation_id.replace('conv-', '').split('-');
            const otherId = ids.find(id => id !== user?.id);
            if (otherId && !usersRef.current.find(u => u.id === otherId)) {
              supabase.from('users').select('*').eq('id', otherId).single().then(({data}) => {
                if (data) setUsers(prev => [...prev, data]);
              });
            }
          }
        }

        if (payload.new.type === 'group_created' && payload.new.content.includes(user?.id || '')) {
          fetchConversations();
        }

        if (payload.new.sender_id !== user?.id && payload.new.type !== 'group_created') {
          playNotificationSound();
          
          const sender = usersRef.current.find(u => u.id === payload.new.sender_id);
          const senderName = sender?.name || sender?.phone || 'Someone';
          
          if (document.visibilityState !== 'visible') {
            showNotification(`New message from ${senderName}`, payload.new.content || 'Sent an attachment');
          }
        }

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

        if (payload.new.type === 'call') {
          fetchCallHistory();
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
    if (user?.id && activeConversation) {
      const channelName = activeConversation.isGroup 
        ? `typing:${activeConversation.id}`
        : `typing:${[user.id, activeConversation.user.id].sort().join('-')}`;
      
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

  // THE FIX: Only fetch users we have an active conversation with
  const fetchUsers = async () => {
    if (!user) return;
    
    // 1. Get all messages involving this user
    const { data: userMessages } = await supabase
      .from('messages')
      .select('conversation_id')
      .ilike('conversation_id', `conv-%${user.id}%`);

    if (userMessages && userMessages.length > 0) {
      // 2. Extract unique user IDs from those conversation strings
      const uniqueUserIds = new Set<string>();
      userMessages.forEach(m => {
        if (m.conversation_id.startsWith('conv-')) {
          const ids = m.conversation_id.replace('conv-', '').split('-');
          const otherId = ids.find(id => id !== user.id);
          if (otherId) uniqueUserIds.add(otherId);
        }
      });

      if (uniqueUserIds.size > 0) {
        // 3. Fetch ONLY those specific users
        const { data: chatUsers } = await supabase
          .from('users')
          .select('*')
          .in('id', Array.from(uniqueUserIds));
        
        if (chatUsers) {
          setUsers(chatUsers);
          return;
        }
      }
    }
    setUsers([]); // No active chats found
  };

  const fetchConversations = async () => {
    if (!user) return;
    const { data } = await supabase
      .from('messages')
      .select('*')
      .eq('type', 'group_created')
      .ilike('content', `%${user.id}%`);
    
    if (data) {
      const parsedGroups = data.map(msg => {
        try {
          const content = JSON.parse(msg.content);
          return {
            id: msg.conversation_id,
            name: content.name,
            participants: content.participants,
            isGroup: true
          };
        } catch (e) {
          return null;
        }
      }).filter(Boolean);
      setConversations(parsedGroups);
    }
    setLoading(false);
  };

  const fetchCallHistory = async () => {
    if (!user) return;
    const { data } = await supabase
      .from('messages')
      .select('*')
      .eq('type', 'call')
      .ilike('conversation_id', `%${user.id}%`)
      .order('timestamp', { ascending: false });
    
    if (data) setCallHistory(data);
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
    const conversationId = `conv-${[user?.id, otherUser.id].sort().join('-')}`;
    setActiveConversation({ id: conversationId, user: otherUser });
    fetchMessages(conversationId);
  };

  const startGroupConversation = async (group: any) => {
    setActiveConversation({ id: group.id, isGroup: true, name: group.name, participants: group.participants });
    fetchMessages(group.id);
  };

  // Start a brand new chat by phone number
  const handleStartNewChat = async (e: React.FormEvent) => {
    e.preventDefault();
    setSearchError('');
    if (!searchPhone || !user) return;

    // Look for the user in the global database by phone number
    const { data, error } = await supabase
      .from('users')
      .select('*')
      .eq('phone', searchPhone)
      .neq('id', user.id)
      .single();

    if (error || !data) {
      setSearchError('No MedLine user found with this phone number.');
      return;
    }

    // Add them to our local active users list if not there already
    setUsers(prev => {
      if (!prev.find(u => u.id === data.id)) return [...prev, data];
      return prev;
    });

    setShowNewChat(false);
    setSearchPhone('');
    startConversation(data);
  };

  const createGroup = async () => {
    if (!newGroupName.trim() || selectedUsers.length === 0 || !user) return;
    
    const groupId = `group-${crypto.randomUUID()}`;
    const participants = [user.id, ...selectedUsers];
    
    const msg = {
      conversation_id: groupId,
      sender_id: user.id,
      content: JSON.stringify({ name: newGroupName.trim(), participants }),
      type: 'group_created',
      status: 'sent',
      timestamp: new Date().toISOString()
    };
    
    await supabase.from('messages').insert([msg]);
    
    setShowCreateGroup(false);
    setNewGroupName('');
    setSelectedUsers([]);
    
    const newGroup = { id: groupId, name: newGroupName.trim(), participants, isGroup: true };
    setConversations(prev => [...prev, newGroup]);
    startGroupConversation(newGroup);
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
    if (channelRef.current.state !== 'joined') return;

    if (!isTyping) {
      setIsTyping(true);
      channelRef.current.send({
        type: 'broadcast',
        event: 'typing_start',
        payload: { user_id: user?.id }
      }).catch(() => {});
    }

    if (typingTimeoutRef.current) clearTimeout(typingTimeoutRef.current);
    
    typingTimeoutRef.current = setTimeout(() => {
      setIsTyping(false);
      if (channelRef.current?.state === 'joined') {
        channelRef.current.send({
          type: 'broadcast',
          event: 'typing_stop',
          payload: { user_id: user?.id }
        }).catch(() => {});
      }
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
      if (channelRef.current.state === 'joined') {
        channelRef.current.send({
          type: 'broadcast',
          event: 'typing_stop',
          payload: { user_id: user?.id }
        }).catch(() => {});
      }
    }

    await supabase.from('messages').insert([msg]);
  };

  useEffect(() => {
    let interval: NodeJS.Timeout;
    if (currentCall && remoteStream) {
      interval = setInterval(() => {
        setCallDuration(prev => {
          const newDuration = prev + 1;
          callDurationRef.current = newDuration;
          return newDuration;
        });
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

  const toggleVideo = async () => {
    if (!localStream || !currentCall) return;

    if (!isVideoOff) {
      localStream.getVideoTracks().forEach(track => {
        track.stop();
        localStream.removeTrack(track);
      });
      setIsVideoOff(true);
    } else {
      try {
        const newStream = await navigator.mediaDevices.getUserMedia({ video: true });
        const newVideoTrack = newStream.getVideoTracks()[0];
        
        localStream.addTrack(newVideoTrack);
        
        const sender = currentCall.peerConnection?.getSenders().find((s: any) => s.track?.kind === 'video' || s.track === null);
        if (sender) {
          sender.replaceTrack(newVideoTrack);
        } else if (currentCall.peerConnection) {
          currentCall.peerConnection.addTrack(newVideoTrack, localStream);
        }
        
        if (localVideoRef.current) {
          localVideoRef.current.srcObject = localStream;
        }
        
        setIsVideoOff(false);
      } catch (err) {
        console.error('Failed to restart camera', err);
      }
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
        {/* ... (Keep existing call UI exactly the same) ... */}
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
                <video ref={remoteVideoRef} autoPlay playsInline className="h-full w-full object-cover" />
                <video ref={localVideoRef} autoPlay playsInline muted className={`absolute bottom-8 right-8 h-48 w-32 rounded-xl object-cover shadow-2xl border-2 border-white/20 transition-opacity ${isVideoOff ? 'opacity-0' : 'opacity-100'}`} />
                {isVideoOff && (
                  <div className="absolute bottom-8 right-8 h-48 w-32 rounded-xl bg-slate-800 flex items-center justify-center shadow-2xl border-2 border-white/20">
                    <UserIcon className="h-12 w-12 text-slate-500" />
                  </div>
                )}
                <div className="absolute top-8 left-1/2 -translate-x-1/2 bg-black/50 px-4 py-2 rounded-full backdrop-blur-md">
                  <p className="text-white font-mono">{remoteStream ? formatDuration(callDuration) : 'Calling...'}</p>
                </div>
              </>
            )}
            {!isVideo && (
              <div className="flex h-full flex-col items-center justify-center space-y-8">
                <div className="h-32 w-32 overflow-hidden rounded-full bg-slate-800">
                  <UserIcon className="h-full w-full p-6 text-slate-500" />
                </div>
                <h2 className="text-2xl font-semibold">{remoteStream ? 'In Call' : 'Calling...'}</h2>
                <p className="text-slate-400 font-mono text-xl">{remoteStream ? formatDuration(callDuration) : 'Connecting...'}</p>
              </div>
            )}
            
            <div className="absolute bottom-12 left-1/2 flex -translate-x-1/2 space-x-6 z-10">
              <Button onClick={toggleMute} className={`h-16 w-16 rounded-full transition-colors ${isMuted ? 'bg-red-500 hover:bg-red-600' : 'bg-slate-600 hover:bg-slate-500'}`}>
                {isMuted ? <MicOff className="h-8 w-8 text-white" /> : <Mic className="h-8 w-8 text-white" />}
              </Button>
              {isVideo && (
                <Button onClick={toggleVideo} className={`h-16 w-16 rounded-full transition-colors ${isVideoOff ? 'bg-red-500 hover:bg-red-600' : 'bg-slate-600 hover:bg-slate-500'}`}>
                  {isVideoOff ? <VideoOff className="h-8 w-8 text-white" /> : <Video className="h-8 w-8 text-white" />}
                </Button>
              )}
              <Button onClick={() => setShowEndCallConfirm(true)} className="h-16 w-16 rounded-full bg-red-500 hover:bg-red-600">
                <Phone className="h-8 w-8 rotate-[135deg] text-white" />
              </Button>
            </div>

            {showEndCallConfirm && (
              <div className="absolute inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
                <div className="bg-slate-800 p-6 rounded-2xl shadow-2xl max-w-sm w-full mx-4 border border-slate-700">
                  <h3 className="text-xl font-semibold mb-2 text-white">End Call?</h3>
                  <p className="text-slate-300 mb-6">Are you sure you want to end this call?</p>
                  <div className="flex space-x-4 justify-end">
                    <Button variant="outline" onClick={() => setShowEndCallConfirm(false)} className="bg-transparent border-slate-600 text-slate-300 hover:bg-slate-700 hover:text-white">Cancel</Button>
                    <Button onClick={() => { setShowEndCallConfirm(false); endCall(); }} className="bg-red-500 hover:bg-red-600 text-white">End Call</Button>
                  </div>
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    );
  }

  const filteredUsers = users.filter(u => {
    const query = searchQuery.toLowerCase();
    const nameMatch = u.name?.toLowerCase().includes(query);
    const phoneMatch = u.phone?.toLowerCase().includes(query);
    return nameMatch || phoneMatch;
  });

  return (
    <div className="flex h-screen bg-slate-50">
      {/* Sidebar */}
      <div className="w-80 border-r border-slate-200 bg-white flex flex-col">
        <div className="p-4 border-b border-slate-200 flex items-center justify-between">
          <h1 className="text-xl font-bold text-slate-900">MedLine</h1>
          <div className="flex items-center space-x-1">
            <Button variant="ghost" size="icon" onClick={() => navigate('/settings')} className="h-8 w-8">
              <Settings className="h-4 w-4" />
            </Button>
            <Button variant="ghost" size="icon" onClick={signOut} className="h-8 w-8">
              <LogOut className="h-4 w-4" />
            </Button>
          </div>
        </div>
        
        <div className="p-3 border-b border-slate-200">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
            <Input 
              placeholder="Search chats..." 
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="pl-9 bg-slate-50 border-slate-200 focus-visible:ring-indigo-500"
            />
          </div>
        </div>

        <div className="flex border-b border-slate-200">
          <button
            className={`flex-1 py-3 text-sm font-medium ${activeTab === 'chats' ? 'text-indigo-600 border-b-2 border-indigo-600' : 'text-slate-500 hover:text-slate-700'}`}
            onClick={() => setActiveTab('chats')}
          >
            Chats
          </button>
          <button
            className={`flex-1 py-3 text-sm font-medium ${activeTab === 'calls' ? 'text-indigo-600 border-b-2 border-indigo-600' : 'text-slate-500 hover:text-slate-700'}`}
            onClick={() => setActiveTab('calls')}
          >
            Calls
          </button>
        </div>
        
        <div className="flex-1 overflow-y-auto">
          {activeTab === 'chats' ? (
            <>
              {/* NEW CHAT & GROUP BUTTONS */}
              <div className="p-2 border-b border-slate-100 flex space-x-2">
                <Button variant="outline" className="flex-1 text-sm font-medium text-indigo-600 border-indigo-200 hover:bg-indigo-50" onClick={() => setShowNewChat(true)}>
                  + New Chat
                </Button>
                <Button variant="outline" className="flex-1 text-sm font-medium text-indigo-600 border-indigo-200 hover:bg-indigo-50" onClick={() => setShowCreateGroup(true)}>
                  + New Group
                </Button>
              </div>
              
              {conversations.filter(g => g.name.toLowerCase().includes(searchQuery.toLowerCase())).map(g => (
                <div 
                  key={g.id} 
                  className={`flex cursor-pointer items-center p-4 hover:bg-slate-50 ${activeConversation?.id === g.id ? 'bg-slate-100' : ''}`}
                  onClick={() => startGroupConversation(g)}
                >
                  <div className="relative h-12 w-12 shrink-0">
                    <div className="h-full w-full overflow-hidden rounded-full bg-indigo-100 flex items-center justify-center">
                      <span className="text-indigo-600 font-semibold text-lg">{g.name.charAt(0).toUpperCase()}</span>
                    </div>
                  </div>
                  <div className="ml-4 flex-1">
                    <h3 className="font-semibold text-slate-900">{g.name}</h3>
                    <p className="text-sm text-slate-500 truncate">Group • {g.participants.length} members</p>
                  </div>
                </div>
              ))}

              {filteredUsers.map(u => (
              <div 
                key={u.id} 
                className={`flex cursor-pointer items-center p-4 hover:bg-slate-50 ${activeConversation?.user?.id === u.id ? 'bg-slate-100' : ''}`}
              >
                <div 
                  className="flex flex-1 items-center"
                  onClick={() => startConversation(u)}
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
                    <p className="text-sm text-slate-500 truncate">{u.is_online ? 'Online' : 'Offline'}</p>
                  </div>
                </div>
                <div className="flex items-center space-x-2 ml-2">
                  <Button 
                    variant="ghost" 
                    size="icon" 
                    onClick={(e) => { e.stopPropagation(); initiateCall(u.id, false); }}
                    className="h-8 w-8 text-slate-500 hover:text-green-600 hover:bg-green-50"
                  >
                    <Phone className="h-4 w-4" />
                  </Button>
                  <Button 
                    variant="ghost" 
                    size="icon" 
                    onClick={(e) => { e.stopPropagation(); initiateCall(u.id, true); }}
                    className="h-8 w-8 text-slate-500 hover:text-blue-600 hover:bg-blue-50"
                  >
                    <Video className="h-4 w-4" />
                  </Button>
                </div>
              </div>
              ))}
              
              {filteredUsers.length === 0 && conversations.filter(g => g.name.toLowerCase().includes(searchQuery.toLowerCase())).length === 0 && (
                <div className="p-4 text-center text-sm text-slate-500">
                  No active chats found. Start a new one!
                </div>
              )}
            </>
          ) : (
            callHistory.length === 0 ? (
              <div className="p-4 text-center text-sm text-slate-500">
                No call history
              </div>
            ) : (
              callHistory.map(call => {
                const otherUserId = call.conversation_id.replace('conv-', '').split('-').find((id: string) => id !== user?.id);
                const otherUser = users.find(u => u.id === otherUserId);
                let callData = { type: 'voice', duration: 0 };
                try { callData = JSON.parse(call.content); } catch (e) {}
                
                const isIncoming = call.sender_id !== user?.id;
                const isMissed = call.status === 'missed';
                
                return (
                  <div 
                    key={call.id} 
                    className="flex items-center p-4 border-b border-slate-100 hover:bg-slate-50 cursor-pointer"
                    onClick={() => { if (otherUser) startConversation(otherUser); }}
                  >
                    <div className="relative h-12 w-12 shrink-0">
                      <div className="h-full w-full overflow-hidden rounded-full bg-slate-200">
                        {otherUser?.avatar_url ? (
                          <img src={otherUser.avatar_url} alt={otherUser?.name} className="h-full w-full object-cover" />
                        ) : (
                          <UserIcon className="h-full w-full p-2 text-slate-400" />
                        )}
                      </div>
                    </div>
                    <div className="ml-4 flex-1">
                      <h3 className={`font-semibold ${isMissed ? 'text-red-500' : 'text-slate-900'}`}>{otherUser?.name || otherUser?.phone || 'Unknown'}</h3>
                      <div className="flex items-center text-sm text-slate-500 mt-0.5">
                        {isIncoming ? (
                          <Phone className={`h-3 w-3 mr-1 ${isMissed ? 'text-red-500' : 'text-green-500'} rotate-[135deg]`} />
                        ) : (
                          <Phone className={`h-3 w-3 mr-1 ${isMissed ? 'text-red-500' : 'text-blue-500'}`} />
                        )}
                        <span>{callData.type === 'video' ? 'Video' : 'Voice'} Call</span>
                        <span className="mx-1">•</span>
                        <span>{format(new Date(call.timestamp), 'MMM d, h:mm a')}</span>
                      </div>
                    </div>
                    <div className="flex items-center space-x-2 ml-2">
                       <Button 
                          variant="ghost" 
                          size="icon" 
                          onClick={(e) => { e.stopPropagation(); if (otherUser) initiateCall(otherUser.id, callData.type === 'video'); }}
                          className="h-8 w-8 text-slate-500 hover:text-indigo-600 hover:bg-indigo-50"
                        >
                          {callData.type === 'video' ? <Video className="h-4 w-4" /> : <Phone className="h-4 w-4" />}
                        </Button>
                    </div>
                  </div>
                );
              })
            )
          )}
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
                  <div className={`h-full w-full overflow-hidden rounded-full flex items-center justify-center ${activeConversation.isGroup ? 'bg-indigo-100' : 'bg-slate-200'}`}>
                    {activeConversation.isGroup ? (
                      <span className="text-indigo-600 font-semibold text-lg">{activeConversation.name.charAt(0).toUpperCase()}</span>
                    ) : activeConversation.user?.avatar_url ? (
                      <img src={activeConversation.user.avatar_url} alt={activeConversation.user.name} className="h-full w-full object-cover" />
                    ) : (
                      <UserIcon className="h-full w-full p-2 text-slate-400" />
                    )}
                  </div>
                  {!activeConversation.isGroup && activeConversation.user?.is_online && (
                    <div className="absolute bottom-0 right-0 h-3 w-3 rounded-full border-2 border-white bg-green-500"></div>
                  )}
                </div>
                <div className="ml-3">
                  <h2 className="font-semibold text-slate-900">
                    {activeConversation.isGroup ? activeConversation.name : (activeConversation.user?.name || activeConversation.user?.phone)}
                  </h2>
                  {remoteTyping ? (
                    <p className="text-xs text-indigo-500 italic">User is typing...</p>
                  ) : (
                    <p className={`text-xs ${activeConversation.isGroup ? 'text-slate-500' : (activeConversation.user?.is_online ? 'text-green-500' : 'text-slate-400')}`}>
                      {activeConversation.isGroup ? `${activeConversation.participants.length} members` : (activeConversation.user?.is_online ? 'Online' : 'Offline')}
                    </p>
                  )}
                </div>
              </div>
              <div className="flex space-x-2">
                {!activeConversation.isGroup && (
                  <>
                    <Button variant="ghost" size="icon" onClick={() => handleCall(false)}>
                      <Phone className="h-5 w-5 text-slate-600" />
                    </Button>
                    <Button variant="ghost" size="icon" onClick={() => handleCall(true)}>
                      <Video className="h-5 w-5 text-slate-600" />
                    </Button>
                  </>
                )}
              </div>
            </div>

            {/* Messages */}
            <div className="flex-1 overflow-y-auto p-4 space-y-4">
              {messages.map((msg, idx) => {
                const isMe = msg.sender_id === user?.id;
                
                if (msg.type === 'group_created') {
                  let groupName = 'Group';
                  try { groupName = JSON.parse(msg.content).name; } catch (e) {}
                  return (
                    <div key={msg.id || idx} className="flex justify-center my-4">
                      <div className="bg-slate-100 text-slate-500 text-xs px-3 py-1 rounded-full">
                        {isMe ? 'You' : 'Someone'} created group "{groupName}"
                      </div>
                    </div>
                  );
                }

                const sender = users.find(u => u.id === msg.sender_id);

                return (
                  <div 
                    key={msg.id || idx} 
                    className={`flex ${isMe ? 'justify-end' : 'justify-start'}`}
                    ref={(el) => { if (el && !isMe && msg.status !== 'read' && observer.current) { observer.current.observe(el); } }}
                    data-message-id={msg.id} data-sender-id={msg.sender_id} data-status={msg.status}
                  >
                    <div className="flex flex-col max-w-[70%]">
                      {!isMe && activeConversation.isGroup && (
                        <span className="text-xs text-slate-500 ml-2 mb-1">{sender?.name || 'User'}</span>
                      )}
                      <div className={`rounded-2xl px-4 py-2 ${isMe ? 'bg-indigo-600 text-white rounded-br-none' : 'bg-white text-slate-900 rounded-bl-none shadow-sm'}`}>
                        {msg.type === 'image' ? (
                        <img src={msg.content} alt="Attachment" className="max-w-full rounded-lg" />
                      ) : msg.type === 'call' ? (
                        <div className="flex items-center space-x-3">
                          <div className={`p-2 rounded-full ${isMe ? 'bg-indigo-500' : 'bg-slate-100'}`}>
                            {(() => {
                              try { const data = JSON.parse(msg.content); return data.type === 'video' ? <Video className="h-4 w-4" /> : <Phone className="h-4 w-4" />; } 
                              catch (e) { return <Phone className="h-4 w-4" />; }
                            })()}
                          </div>
                          <div>
                            <p className="font-medium text-sm">
                              {(() => {
                                try { const data = JSON.parse(msg.content); return `${data.type === 'video' ? 'Video' : 'Voice'} Call ${msg.status === 'missed' ? 'Missed' : 'Ended'}`; } 
                                catch (e) { return 'Call'; }
                              })()}
                            </p>
                            <p className={`text-xs ${isMe ? 'text-indigo-200' : 'text-slate-500'}`}>
                              {(() => {
                                try { const data = JSON.parse(msg.content); return data.duration > 0 ? formatDuration(data.duration) : 'Missed'; } 
                                catch (e) { return ''; }
                              })()}
                            </p>
                          </div>
                        </div>
                      ) : (
                        <p>{msg.content}</p>
                      )}
                      </div>
                      <div className={`mt-1 flex items-center text-[10px] ${isMe ? 'justify-end text-indigo-200' : 'justify-start text-slate-400'}`}>
                        <span>{format(new Date(msg.timestamp), 'HH:mm')}</span>
                        {isMe && (
                          <span className="ml-1" title={msg.status}>
                            {msg.status === 'read' ? <CheckCheck className="h-3.5 w-3.5 text-indigo-600" aria-label="read" /> 
                            : msg.status === 'delivered' ? <CheckCheck className="h-3.5 w-3.5 text-slate-400" aria-label="delivered" /> 
                            : <Check className="h-3.5 w-3.5 text-slate-400" aria-label="sent" />}
                          </span>
                        )}
                      </div>
                    </div>
                  </div>
                );
              })}
              {remoteTyping && (
                <div className="flex justify-start">
                  <div className="max-w-[70%] rounded-2xl px-4 py-2 bg-white text-slate-500 rounded-bl-none shadow-sm italic text-sm flex items-center space-x-1">
                    <span>{activeConversation.isGroup ? 'Someone' : (activeConversation.user?.name || 'User')} is typing</span>
                    <span className="flex space-x-1 ml-1">
                      <span className="animate-bounce" style={{ animationDelay: '0ms' }}>.</span>
                      <span className="animate-bounce" style={{ animationDelay: '150ms' }}>.</span>
                      <span className="animate-bounce" style={{ animationDelay: '300ms' }}>.</span>
                    </span>
                  </div>
                </div>
              )}
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
                  <input type="file" accept="image/*" onChange={handleImageUpload} className="absolute inset-0 cursor-pointer opacity-0" />
                </div>
                <Input value={newMessage} onChange={handleTyping} placeholder="Type a message..." className="flex-1 rounded-full bg-slate-100 border-transparent focus-visible:ring-indigo-500" />
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

      {/* START NEW CHAT MODAL */}
      {showNewChat && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="w-full max-w-md rounded-2xl bg-white p-6 shadow-xl">
            <h2 className="text-xl font-bold text-slate-900 mb-4">Start New Chat</h2>
            <form onSubmit={handleStartNewChat} className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">User's Phone Number</label>
                <div className="flex w-full border border-slate-300 rounded-md bg-transparent px-3 py-2 focus-within:ring-2 focus-within:ring-indigo-500 transition-colors">
                  <PhoneInput
                    international
                    defaultCountry="AE"
                    placeholder="Enter phone number"
                    value={searchPhone}
                    onChange={(val) => setSearchPhone(val || '')}
                    className="w-full text-sm outline-none bg-transparent"
                    inputComponent={Input}
                    style={{ border: 'none', boxShadow: 'none' }}
                  />
                </div>
                {searchError && <p className="text-red-500 text-xs mt-2">{searchError}</p>}
              </div>
              
              <div className="mt-6 flex justify-end space-x-3">
                <Button variant="ghost" type="button" onClick={() => { setShowNewChat(false); setSearchError(''); setSearchPhone(''); }}>
                  Cancel
                </Button>
                <Button type="submit" disabled={!searchPhone} className="bg-indigo-600 hover:bg-indigo-700">
                  Find & Chat
                </Button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* CREATE GROUP MODAL */}
      {showCreateGroup && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="w-full max-w-md rounded-2xl bg-white p-6 shadow-xl">
            <h2 className="text-xl font-bold text-slate-900 mb-4">Create New Group</h2>
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Group Name</label>
                <Input value={newGroupName} onChange={(e) => setNewGroupName(e.target.value)} placeholder="Enter group name..." className="w-full" />
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-2">Select Participants</label>
                <div className="max-h-60 overflow-y-auto border border-slate-200 rounded-lg divide-y divide-slate-100">
                  {users.length === 0 ? (
                    <p className="p-4 text-sm text-slate-500 text-center">No active chats to add.</p>
                  ) : (
                    users.map(u => (
                      <div key={u.id} className="flex items-center p-3 hover:bg-slate-50 cursor-pointer" onClick={() => setSelectedUsers(prev => prev.includes(u.id) ? prev.filter(id => id !== u.id) : [...prev, u.id])}>
                        <div className="relative h-10 w-10 shrink-0 mr-3">
                          <div className="h-full w-full overflow-hidden rounded-full bg-slate-200">
                            {u.avatar_url ? <img src={u.avatar_url} alt={u.name} className="h-full w-full object-cover" /> : <UserIcon className="h-full w-full p-2 text-slate-400" />}
                          </div>
                        </div>
                        <div className="flex-1"><h3 className="font-medium text-slate-900">{u.name}</h3></div>
                        <div className={`h-5 w-5 rounded-full border flex items-center justify-center ${selectedUsers.includes(u.id) ? 'bg-indigo-600 border-indigo-600' : 'border-slate-300'}`}>
                          {selectedUsers.includes(u.id) && <Check className="h-3 w-3 text-white" />}
                        </div>
                      </div>
                    ))
                  )}
                </div>
              </div>
            </div>
            <div className="mt-6 flex justify-end space-x-3">
              <Button variant="ghost" onClick={() => { setShowCreateGroup(false); setNewGroupName(''); setSelectedUsers([]); }}>Cancel</Button>
              <Button onClick={createGroup} disabled={!newGroupName.trim() || selectedUsers.length === 0} className="bg-indigo-600 hover:bg-indigo-700">Create Group</Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}