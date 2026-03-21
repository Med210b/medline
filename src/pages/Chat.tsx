import React, { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '@/src/contexts/AuthContext';
import { useCall } from '@/src/contexts/CallContext';
import { supabase } from '@/src/lib/supabase';
import { Button } from '@/src/components/ui/button';
import { Input } from '@/src/components/ui/input';
import { Phone, Video, Send, Image as ImageIcon, Paperclip, LogOut, User as UserIcon, Check, CheckCheck, Mic, MicOff, VideoOff, Settings, Search, Reply, X, MessageSquarePlus } from 'lucide-react';
import { format, isToday, isYesterday } from 'date-fns';
import { playNotificationSound, showNotification } from '@/src/hooks/useNotifications';
import PhoneInput from 'react-phone-number-input';
import 'react-phone-number-input/style.css';

// Helper to format dates WhatsApp style
const formatChatTime = (dateString: string) => {
  const date = new Date(dateString);
  if (isToday(date)) return format(date, 'HH:mm');
  if (isYesterday(date)) return 'Yesterday';
  return format(date, 'dd/MM/yyyy');
};

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
  
  // Contacts & Chat Meta
  const [users, setUsers] = useState<any[]>([]);
  const [chatMeta, setChatMeta] = useState<Record<string, { lastMessage: any, unreadCount: number }>>({});
  const [searchQuery, setSearchQuery] = useState('');
  
  // Reply State
  const [replyingTo, setReplyingTo] = useState<any | null>(null);

  // Modals
  const [showCreateGroup, setShowCreateGroup] = useState(false);
  const [newGroupName, setNewGroupName] = useState('');
  const [selectedUsers, setSelectedUsers] = useState<string[]>([]);
  const [showNewChat, setShowNewChat] = useState(false);
  const [searchPhone, setSearchPhone] = useState<string | undefined>('');
  const [searchError, setSearchError] = useState('');

  const usersRef = useRef<any[]>([]);
  const chatMetaRef = useRef<any>({});
  
  useEffect(() => { usersRef.current = users; }, [users]);
  useEffect(() => { chatMetaRef.current = chatMeta; }, [chatMeta]);

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
    const setOnlineStatus = async (status: boolean) => await supabase.from('users').update({ is_online: status }).eq('id', user.id);
    setOnlineStatus(true);
    const handleVisibilityChange = () => setOnlineStatus(document.visibilityState === 'visible');
    const handleBeforeUnload = () => setOnlineStatus(false);
    document.addEventListener('visibilitychange', handleVisibilityChange);
    window.addEventListener('beforeunload', handleBeforeUnload);
    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      window.removeEventListener('beforeunload', handleBeforeUnload);
      setOnlineStatus(false);
    };
  }, [user]);

  useEffect(() => {
    if (localVideoRef.current && localStream) localVideoRef.current.srcObject = localStream;
    if (remoteVideoRef.current && remoteStream) remoteVideoRef.current.srcObject = remoteStream;
  }, [localStream, remoteStream]);

  useEffect(() => {
    fetchAllChatMetadata();
    fetchConversations();
    fetchCallHistory();

    const messageSubscription = supabase.channel('public:messages')
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'messages' }, payload => {
        const newMsg = payload.new;
        
        // Update unread counts and last message in sidebar
        setChatMeta(prev => {
          const isMyMsg = newMsg.sender_id === user?.id;
          const isActiveChat = activeConversation?.id === newMsg.conversation_id;
          const currentCount = prev[newMsg.conversation_id]?.unreadCount || 0;
          
          return {
            ...prev,
            [newMsg.conversation_id]: {
              lastMessage: newMsg,
              unreadCount: (!isMyMsg && !isActiveChat) ? currentCount + 1 : currentCount
            }
          };
        });

        // Add to active chat if open
        if (newMsg.conversation_id === activeConversation?.id) {
          setMessages(prev => [...prev, newMsg]);
          scrollToBottom();
          if (newMsg.sender_id !== user?.id) {
            supabase.from('messages').update({ status: document.visibilityState === 'visible' ? 'read' : 'delivered' }).eq('id', newMsg.id).then();
          }
        } else if (newMsg.sender_id !== user?.id) {
          playNotificationSound();
          if (document.visibilityState !== 'visible') showNotification("New Message", "You have a new message");
          supabase.from('messages').update({ status: 'delivered' }).eq('id', newMsg.id).then();
        }

        // Auto-add new users
        if (newMsg.conversation_id.startsWith('conv-') && newMsg.conversation_id.includes(user?.id)) {
           const otherId = newMsg.conversation_id.replace('conv-', '').split('-').find(id => id !== user?.id);
           if (otherId && !usersRef.current.find(u => u.id === otherId)) {
             supabase.from('users').select('*').eq('id', otherId).single().then(({data}) => {
               if (data) setUsers(prev => [...prev, data]);
             });
           }
        }
      })
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'messages' }, payload => {
        if (payload.new.conversation_id === activeConversation?.id) {
          setMessages(prev => prev.map(m => m.id === payload.new.id ? payload.new : m));
        }
        setChatMeta(prev => {
           if (prev[payload.new.conversation_id]?.lastMessage?.id === payload.new.id) {
               return { ...prev, [payload.new.conversation_id]: { ...prev[payload.new.conversation_id], lastMessage: payload.new } };
           }
           return prev;
        });
      })
      .subscribe();

    const userSubscription = supabase.channel('public:users')
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'users' }, payload => {
        setUsers(prev => prev.map(u => u.id === payload.new.id ? { ...u, ...payload.new } : u));
        setActiveConversation(prev => prev?.user?.id === payload.new.id ? { ...prev, user: { ...prev.user, ...payload.new } } : prev);
      }).subscribe();

    return () => {
      supabase.removeChannel(messageSubscription);
      supabase.removeChannel(userSubscription);
    };
  }, [activeConversation, user?.id]);

  // Mark visible messages as read
  const observer = useRef<IntersectionObserver | null>(null);
  useEffect(() => {
    observer.current = new IntersectionObserver((entries) => {
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
        }
      }, { threshold: 0.1 });
    return () => observer.current?.disconnect();
  }, [user?.id]);

  // Fetch all metadata for sidebar
  const fetchAllChatMetadata = async () => {
    if (!user) return;
    const { data: allUserMsgs } = await supabase
      .from('messages')
      .select('*')
      .ilike('conversation_id', `%${user.id}%`)
      .order('timestamp', { ascending: true });

    if (allUserMsgs) {
      const meta: Record<string, { lastMessage: any, unreadCount: number }> = {};
      const uniqueUserIds = new Set<string>();

      allUserMsgs.forEach(m => {
        if (!meta[m.conversation_id]) meta[m.conversation_id] = { lastMessage: m, unreadCount: 0 };
        meta[m.conversation_id].lastMessage = m;
        if (m.sender_id !== user.id && m.status !== 'read') {
          meta[m.conversation_id].unreadCount += 1;
        }

        if (m.conversation_id.startsWith('conv-')) {
          const otherId = m.conversation_id.replace('conv-', '').split('-').find(id => id !== user.id);
          if (otherId) uniqueUserIds.add(otherId);
        }
      });
      setChatMeta(meta);

      if (uniqueUserIds.size > 0) {
        const { data: chatUsers } = await supabase.from('users').select('*').in('id', Array.from(uniqueUserIds));
        if (chatUsers) setUsers(chatUsers);
      }
    }
  };

  const fetchConversations = async () => {
    if (!user) return;
    const { data } = await supabase.from('messages').select('*').eq('type', 'group_created').ilike('content', `%${user.id}%`);
    if (data) {
      setConversations(data.map(msg => {
        try { return { id: msg.conversation_id, name: JSON.parse(msg.content).name, participants: JSON.parse(msg.content).participants, isGroup: true }; } catch (e) { return null; }
      }).filter(Boolean));
    }
    setLoading(false);
  };

  const fetchCallHistory = async () => {
    if (!user) return;
    const { data } = await supabase.from('messages').select('*').eq('type', 'call').ilike('conversation_id', `%${user.id}%`).order('timestamp', { ascending: false });
    if (data) setCallHistory(data);
  };

  const startConversation = async (otherUser: any) => {
    const conversationId = `conv-${[user?.id, otherUser.id].sort().join('-')}`;
    setActiveConversation({ id: conversationId, user: otherUser });
    setReplyingTo(null);
    
    // Clear unread badge
    setChatMeta(prev => ({ ...prev, [conversationId]: { ...prev[conversationId], unreadCount: 0 } }));
    
    // Fetch actual messages
    const { data } = await supabase.from('messages').select('*').eq('conversation_id', conversationId).order('timestamp', { ascending: true });
    if (data) {
      setMessages(data);
      // Mark all as read
      const unreadIds = data.filter(m => m.sender_id !== user?.id && m.status !== 'read').map(m => m.id);
      if (unreadIds.length > 0) supabase.from('messages').update({ status: 'read' }).in('id', unreadIds).then();
    }
    scrollToBottom();
  };

  const startGroupConversation = async (group: any) => {
    setActiveConversation({ id: group.id, isGroup: true, name: group.name, participants: group.participants });
    setReplyingTo(null);
    setChatMeta(prev => ({ ...prev, [group.id]: { ...prev[group.id], unreadCount: 0 } }));
    const { data } = await supabase.from('messages').select('*').eq('conversation_id', group.id).order('timestamp', { ascending: true });
    if (data) setMessages(data);
    scrollToBottom();
  };

  const handleStartNewChat = async (e: React.FormEvent) => {
    e.preventDefault();
    setSearchError('');
    if (!searchPhone || !user) return;
    const { data, error } = await supabase.from('users').select('*').eq('phone', searchPhone).neq('id', user.id).single();
    if (error || !data) { setSearchError('No user found with this phone number.'); return; }
    setUsers(prev => prev.find(u => u.id === data.id) ? prev : [...prev, data]);
    setShowNewChat(false);
    setSearchPhone('');
    startConversation(data);
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

    let msgContent = newMessage;
    let msgType = 'text';

    // Handle Replies formatting
    if (replyingTo) {
      msgType = 'reply';
      let originalText = replyingTo.content;
      if (replyingTo.type === 'image') originalText = '📷 Photo';
      if (replyingTo.type === 'call') originalText = '📞 Call';
      
      const senderInfo = users.find(u => u.id === replyingTo.sender_id);
      
      msgContent = JSON.stringify({
        text: newMessage,
        originalId: replyingTo.id,
        originalText: originalText,
        originalSender: replyingTo.sender_id === user?.id ? 'You' : (senderInfo?.name || 'Someone')
      });
    }

    const msg = {
      conversation_id: activeConversation.id,
      sender_id: user?.id,
      content: msgContent,
      type: msgType,
      status: 'sent',
      timestamp: new Date().toISOString()
    };

    setNewMessage('');
    setReplyingTo(null);
    await supabase.from('messages').insert([msg]);
  };

  const handleImageUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    if (!e.target.files || e.target.files.length === 0 || !activeConversation) return;
    const file = e.target.files[0];
    const fileExt = file.name.split('.').pop();
    const fileName = `${user?.id}-${Math.random()}.${fileExt}`;
    
    try {
      await supabase.storage.from('chat-media').upload(fileName, file);
      const { data } = supabase.storage.from('chat-media').getPublicUrl(fileName);
      await supabase.from('messages').insert([{
        conversation_id: activeConversation.id,
        sender_id: user?.id,
        content: data.publicUrl,
        type: 'image',
        status: 'sent',
        timestamp: new Date().toISOString()
      }]);
    } catch (err) { console.error('Error uploading image', err); }
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

  const scrollToBottom = () => setTimeout(() => messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' }), 100);

  const renderLastMessagePreview = (msg: any) => {
    if (!msg) return '';
    if (msg.type === 'image') return '📷 Photo';
    if (msg.type === 'call') return '📞 Call';
    if (msg.type === 'reply') {
      try { return JSON.parse(msg.content).text; } catch(e) { return 'Message'; }
    }
    return msg.content;
  };

  const formatDuration = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
  };

  const toggleMute = () => {
    if (localStream) {
      const newMutedState = !isMuted;
      localStream.getAudioTracks().forEach(track => { track.enabled = !newMutedState; });
      setIsMuted(newMutedState);
    }
  };

  const toggleVideo = async () => {
    if (!localStream || !currentCall) return;
    if (!isVideoOff) {
      localStream.getVideoTracks().forEach(track => { track.stop(); localStream.removeTrack(track); });
      setIsVideoOff(true);
    } else {
      try {
        const newStream = await navigator.mediaDevices.getUserMedia({ video: true });
        const newVideoTrack = newStream.getVideoTracks()[0];
        localStream.addTrack(newVideoTrack);
        const sender = currentCall.peerConnection?.getSenders().find((s: any) => s.track?.kind === 'video' || s.track === null);
        if (sender) sender.replaceTrack(newVideoTrack);
        else if (currentCall.peerConnection) currentCall.peerConnection.addTrack(newVideoTrack, localStream);
        if (localVideoRef.current) localVideoRef.current.srcObject = localStream;
        setIsVideoOff(false);
      } catch (err) { console.error('Failed to restart camera', err); }
    }
  };

  // Define filteredUsers here so it's accessible by the render
  const filteredUsers = users.filter(u => u.name?.toLowerCase().includes(searchQuery.toLowerCase()) || u.phone?.toLowerCase().includes(searchQuery.toLowerCase()));

  // Render
  return (
    <div className="flex h-screen bg-[#e1e1de]">
      {/* SIDEBAR */}
      <div className="w-full sm:w-[400px] border-r border-[#d1d7db] bg-white flex flex-col shrink-0">
        <div className="h-16 px-4 bg-[#f0f2f5] flex items-center justify-between shrink-0">
          <div className="flex items-center space-x-3">
             <div className="h-10 w-10 rounded-full bg-slate-300 overflow-hidden">
                {user && <UserIcon className="h-full w-full p-2 text-white" />}
             </div>
             <h1 className="text-xl font-bold text-[#111b21]">MedLine</h1>
          </div>
          <div className="flex items-center space-x-2 text-[#54656f]">
            <Button variant="ghost" size="icon" onClick={() => setShowNewChat(true)}><MessageSquarePlus className="h-5 w-5" /></Button>
            <Button variant="ghost" size="icon" onClick={() => navigate('/settings')}><Settings className="h-5 w-5" /></Button>
            <Button variant="ghost" size="icon" onClick={signOut}><LogOut className="h-5 w-5" /></Button>
          </div>
        </div>
        
        <div className="p-2 bg-white">
          <div className="relative flex items-center bg-[#f0f2f5] rounded-lg px-3 py-1">
            <Search className="h-4 w-4 text-[#54656f]" />
            <Input 
              placeholder="Search or start new chat" 
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="bg-transparent border-none shadow-none focus-visible:ring-0 text-sm h-8"
            />
          </div>
        </div>
        
        <div className="flex-1 overflow-y-auto bg-white">
          {conversations.map(g => {
            const meta = chatMeta[g.id];
            const hasUnread = meta?.unreadCount > 0;
            return (
              <div key={g.id} className={`flex cursor-pointer items-center px-3 py-3 hover:bg-[#f5f6f6] ${activeConversation?.id === g.id ? 'bg-[#f0f2f5]' : ''}`} onClick={() => startGroupConversation(g)}>
                <div className="h-12 w-12 shrink-0 rounded-full bg-[#d9fdd3] flex items-center justify-center mr-3">
                  <span className="text-[#00a884] font-semibold text-lg">{g.name.charAt(0).toUpperCase()}</span>
                </div>
                <div className="flex-1 border-b border-[#f2f2f2] pb-3 pt-1 pr-2">
                  <div className="flex justify-between items-center mb-1">
                    <h3 className={`text-[17px] text-[#111b21] ${hasUnread ? 'font-bold' : 'font-normal'}`}>{g.name}</h3>
                    {meta?.lastMessage && <span className={`text-xs ${hasUnread ? 'text-[#25d366] font-medium' : 'text-[#667781]'}`}>{formatChatTime(meta.lastMessage.timestamp)}</span>}
                  </div>
                  <div className="flex justify-between items-center">
                    <p className="text-[14px] text-[#667781] truncate pr-4">{renderLastMessagePreview(meta?.lastMessage)}</p>
                    {hasUnread && <div className="bg-[#25d366] text-white text-[11px] font-bold h-5 min-w-[20px] px-1.5 rounded-full flex items-center justify-center">{meta.unreadCount}</div>}
                  </div>
                </div>
              </div>
            );
          })}

          {filteredUsers.map(u => {
            const convId = `conv-${[user?.id, u.id].sort().join('-')}`;
            const meta = chatMeta[convId];
            const hasUnread = meta?.unreadCount > 0;
            
            return (
            <div key={u.id} className={`flex cursor-pointer items-center px-3 py-3 hover:bg-[#f5f6f6] ${activeConversation?.user?.id === u.id ? 'bg-[#f0f2f5]' : ''}`} onClick={() => startConversation(u)}>
                <div className="h-12 w-12 shrink-0 rounded-full bg-slate-200 overflow-hidden mr-3">
                  {u.avatar_url ? <img src={u.avatar_url} alt={u.name} className="h-full w-full object-cover" /> : <UserIcon className="h-full w-full p-2 text-[#aebac1]" />}
                </div>
                <div className="flex-1 border-b border-[#f2f2f2] pb-3 pt-1 pr-2">
                  <div className="flex justify-between items-center mb-1">
                    <h3 className={`text-[17px] text-[#111b21] ${hasUnread ? 'font-bold' : 'font-normal'}`}>{u.name || u.phone}</h3>
                    {meta?.lastMessage && <span className={`text-xs ${hasUnread ? 'text-[#25d366] font-medium' : 'text-[#667781]'}`}>{formatChatTime(meta.lastMessage.timestamp)}</span>}
                  </div>
                  <div className="flex justify-between items-center">
                    <p className="text-[14px] text-[#667781] truncate pr-4 flex items-center">
                        {meta?.lastMessage?.sender_id === user?.id && (
                          <span className="mr-1 inline-block align-middle">
                            {meta.lastMessage.status === 'read' ? <CheckCheck className="h-3.5 w-3.5 text-[#53bdeb]" /> : meta.lastMessage.status === 'delivered' ? <CheckCheck className="h-3.5 w-3.5 text-[#8696a0]" /> : <Check className="h-3.5 w-3.5 text-[#8696a0]" />}
                          </span>
                        )}
                        <span className="truncate">{renderLastMessagePreview(meta?.lastMessage)}</span>
                    </p>
                    {hasUnread && <div className="bg-[#25d366] text-white text-[11px] font-bold h-5 min-w-[20px] px-1.5 rounded-full flex items-center justify-center">{meta.unreadCount}</div>}
                  </div>
                </div>
            </div>
            );
          })}
        </div>
      </div>

      {/* MAIN CHAT AREA */}
      <div className="flex-1 flex flex-col bg-[#efeae2] relative overflow-hidden" style={{ backgroundImage: 'url("https://user-images.githubusercontent.com/15075759/28719144-86dc0f70-73b1-11e7-911d-60d70fcded21.png")', backgroundRepeat: 'repeat', backgroundSize: '400px' }}>
        {activeConversation ? (
          <>
            {/* Header */}
            <div className="h-16 px-4 bg-[#f0f2f5] flex items-center justify-between z-10 border-b border-[#d1d7db]">
              <div className="flex items-center cursor-pointer">
                <div className="h-10 w-10 rounded-full bg-slate-200 overflow-hidden mr-3">
                    {activeConversation.isGroup ? <span className="text-[#00a884] font-semibold flex items-center justify-center h-full text-lg">{activeConversation.name.charAt(0).toUpperCase()}</span> : activeConversation.user?.avatar_url ? <img src={activeConversation.user.avatar_url} className="h-full w-full object-cover" /> : <UserIcon className="h-full w-full p-2 text-[#aebac1]" />}
                </div>
                <div>
                  <h2 className="text-base font-medium text-[#111b21] leading-tight">
                    {activeConversation.isGroup ? activeConversation.name : (activeConversation.user?.name || activeConversation.user?.phone)}
                  </h2>
                  <p className="text-[13px] text-[#667781]">
                    {remoteTyping ? <span className="text-[#00a884]">typing...</span> : activeConversation.isGroup ? `${activeConversation.participants.length} members` : (activeConversation.user?.is_online ? 'online' : 'offline')}
                  </p>
                </div>
              </div>
              <div className="flex space-x-2 text-[#54656f]">
                {!activeConversation.isGroup && (
                  <>
                    <Button variant="ghost" size="icon" onClick={() => initiateCall(activeConversation.user.id, true)}><Video className="h-5 w-5" /></Button>
                    <Button variant="ghost" size="icon" onClick={() => initiateCall(activeConversation.user.id, false)}><Phone className="h-5 w-5" /></Button>
                  </>
                )}
                <Button variant="ghost" size="icon"><Search className="h-5 w-5" /></Button>
              </div>
            </div>

            {/* Messages */}
            <div className="flex-1 overflow-y-auto p-4 sm:p-8 space-y-2 z-10">
              {messages.map((msg, idx) => {
                const isMe = msg.sender_id === user?.id;
                
                return (
                  <div key={msg.id || idx} className={`flex group ${isMe ? 'justify-end' : 'justify-start'}`} ref={(el) => { if (el && !isMe && msg.status !== 'read' && observer.current) { observer.current.observe(el); } }} data-message-id={msg.id} data-sender-id={msg.sender_id} data-status={msg.status}>
                    <div className="flex items-start max-w-[85%] sm:max-w-[65%] relative">
                      
                      {/* Hover Reply Button */}
                      <button onClick={() => setReplyingTo(msg)} className={`opacity-0 group-hover:opacity-100 transition-opacity absolute top-0 p-2 text-[#8696a0] hover:text-[#54656f] ${isMe ? '-left-10' : '-right-10'}`}>
                        <Reply className="h-4 w-4" />
                      </button>

                      <div className={`rounded-lg px-2 py-1.5 shadow-sm text-[14.2px] text-[#111b21] ${isMe ? 'bg-[#d9fdd3] rounded-tr-none' : 'bg-white rounded-tl-none'}`}>
                        
                        {/* Render Reply Context inside bubble */}
                        {msg.type === 'reply' && (
                          <div className="bg-black/5 rounded cursor-pointer p-2 mb-1 border-l-4 border-[#00a884] flex flex-col">
                             <span className="text-[12px] font-semibold text-[#00a884]">{JSON.parse(msg.content).originalSender}</span>
                             <span className="text-[13px] text-[#667781] truncate">{JSON.parse(msg.content).originalText}</span>
                          </div>
                        )}

                        {/* Message Content */}
                        <div className="flex flex-col relative">
                           {msg.type === 'image' ? <img src={msg.content} className="max-w-[250px] rounded mb-1" /> : msg.type === 'reply' ? <span className="pb-3 pr-12">{JSON.parse(msg.content).text}</span> : <span className="pb-3 pr-12">{msg.content}</span>}
                           
                           {/* Timestamps and Ticks */}
                           <div className="absolute bottom-[-2px] right-0 flex items-center text-[11px] text-[#667781]">
                             <span>{format(new Date(msg.timestamp), 'HH:mm')}</span>
                             {isMe && (
                               <span className="ml-1">
                                 {msg.status === 'read' ? <CheckCheck className="h-4 w-4 text-[#53bdeb]" /> : msg.status === 'delivered' ? <CheckCheck className="h-4 w-4" /> : <Check className="h-4 w-4" />}
                               </span>
                             )}
                           </div>
                        </div>
                      </div>
                    </div>
                  </div>
                );
              })}
              <div ref={messagesEndRef} className="h-4" />
            </div>

            {/* Input Area */}
            <div className="bg-[#f0f2f5] px-4 py-3 z-10 flex flex-col border-t border-[#d1d7db]">
              {/* Replying Preview Box */}
              {replyingTo && (
                <div className="bg-[#f0f2f5] mb-2 px-2 flex">
                   <div className="flex-1 bg-white rounded-lg p-3 border-l-4 border-[#00a884] relative">
                     <button type="button" onClick={() => setReplyingTo(null)} className="absolute top-2 right-2 text-[#8696a0]"><X className="h-4 w-4" /></button>
                     <p className="text-[13px] font-semibold text-[#00a884]">{replyingTo.sender_id === user?.id ? 'You' : 'User'}</p>
                     <p className="text-[13px] text-[#667781] truncate pr-8">{replyingTo.type === 'image' ? '📷 Photo' : replyingTo.type === 'reply' ? JSON.parse(replyingTo.content).text : replyingTo.content}</p>
                   </div>
                </div>
              )}
              
              <form onSubmit={sendMessage} className="flex items-center space-x-3">
                <Button type="button" variant="ghost" size="icon" className="text-[#54656f]"><Paperclip className="h-6 w-6" /></Button>
                <div className="relative">
                  <Button type="button" variant="ghost" size="icon" className="text-[#54656f]"><ImageIcon className="h-6 w-6" /></Button>
                  <input type="file" accept="image/*" onChange={handleImageUpload} className="absolute inset-0 cursor-pointer opacity-0" />
                </div>
                <Input value={newMessage} onChange={handleTyping} placeholder="Type a message" className="flex-1 rounded-lg bg-white border-none py-6 px-4 shadow-sm focus-visible:ring-0 text-[15px]" />
                <Button type="submit" variant="ghost" size="icon" className="text-[#54656f] hover:text-[#00a884]">
                  {newMessage.trim() ? <Send className="h-6 w-6" /> : <Mic className="h-6 w-6" />}
                </Button>
              </form>
            </div>
          </>
        ) : (
          <div className="flex h-full items-center justify-center border-b-[6px] border-[#25d366] z-10 bg-[#f0f2f5]">
             <div className="text-center max-w-md">
                <h1 className="text-3xl font-light text-[#41525d] mb-4 mt-8">MedLine for Web</h1>
                <p className="text-[#667781] text-[14px] leading-relaxed">Send and receive messages without keeping your phone online.<br/>Use MedLine on up to 4 linked devices and 1 phone at the same time.</p>
             </div>
          </div>
        )}
      </div>

      {/* RENDER CALL UI OVERLAY */}
      {(incomingCall || currentCall) && (
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
      )}

      {/* START NEW CHAT MODAL */}
      {showNewChat && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="w-full max-w-md rounded-2xl bg-white p-6 shadow-xl">
            <h2 className="text-xl font-bold text-slate-900 mb-4">Start New Chat</h2>
            <form onSubmit={handleStartNewChat} className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">User's Phone Number</label>
                <div className="flex w-full border border-slate-300 rounded-md bg-transparent px-3 py-2 focus-within:ring-2 focus-within:ring-[#00a884] transition-colors">
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
                <Button variant="ghost" type="button" onClick={() => { setShowNewChat(false); setSearchError(''); setSearchPhone(''); }}>Cancel</Button>
                <Button type="submit" disabled={!searchPhone} className="bg-[#00a884] hover:bg-[#058b6e] text-white">Find & Chat</Button>
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
                <Input value={newGroupName} onChange={(e) => setNewGroupName(e.target.value)} placeholder="Enter group name..." className="w-full focus-visible:ring-[#00a884]" />
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
                        <div className={`h-5 w-5 rounded-full border flex items-center justify-center ${selectedUsers.includes(u.id) ? 'bg-[#00a884] border-[#00a884]' : 'border-slate-300'}`}>
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
              <Button onClick={createGroup} disabled={!newGroupName.trim() || selectedUsers.length === 0} className="bg-[#00a884] hover:bg-[#058b6e] text-white">Create Group</Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}