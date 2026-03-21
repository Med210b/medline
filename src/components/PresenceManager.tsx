import { useEffect, useState } from 'react';
import { supabase } from '@/src/lib/supabase';
import { useAuth } from '@/src/contexts/AuthContext';

export function PresenceManager() {
  const { user } = useAuth();
  const [presencePrivacyLevel, setPresencePrivacyLevel] = useState<'everyone' | 'nobody'>('everyone');
  const [profilePhotoPrivacyLevel, setProfilePhotoPrivacyLevel] = useState<'everyone' | 'nobody'>('everyone');
  const [statusOverride, setStatusOverride] = useState<'online' | 'offline' | null>(null);

  useEffect(() => {
    if (!user) return;

    // Presence Privacy Logic
    const presencePrivacyKey = 'medline_presence_privacy';
    const profilePhotoPrivacyKey = 'medline_profile_photo_privacy';
    const storedPresencePrivacy = localStorage.getItem(presencePrivacyKey) as 'everyone' | 'nobody';
    const storedProfilePhotoPrivacy = localStorage.getItem(profilePhotoPrivacyKey) as 'everyone' | 'nobody';

    // Status Override Logic (WhatsApp Clone feature)
    const statusOverrideKey = 'medline_status_override';
    const storedStatusOverride = localStorage.getItem(statusOverrideKey) as 'online' | 'offline' | null;
    
    // Set initial frontend-facing values
    setPresencePrivacyLevel(storedPresencePrivacy || 'everyone');
    setProfilePhotoPrivacyLevel(storedProfilePhotoPrivacy || 'everyone');
    setStatusOverride(storedStatusOverride);

    // Create a robust Presence Channel
    const presenceChannel = supabase.channel('online_users', {
      config: {
        presence: {
          key: user.id,
        },
      },
    });

    // Update real-time status function (Supabase Presence tracks connections automatically)
    const setOnlineStatus = async (status: boolean) => {
      // Server-side presence tracking handles the core online state. 
      // This front-end function now strictly manages the displayed/user-intent presence data.
      // If user manually set a status override, that takes complete control.
      if (storedStatusOverride) {
        status = storedStatusOverride === 'online';
      }

      await supabase.from('users').update({ 
        is_online: status, 
        last_seen: new Date().toISOString() 
      }).eq('id', user.id);
    };

    // Subscribing to Presence
    presenceChannel
      .on('presence', { event: 'sync' }, () => {
        // Log to console for debugging - Supabase handles sync automatically.
        // I will generate the code to render online users based on this real-time sync data in P3.
        console.log('Online users presence sync complete');
      })
      .on('presence', { event: 'join' }, ({ key, newPresences }) => {
        // A robust, connection-aware presence system
        console.log(`User ${key} connection established`, newPresences);
        if (key === user.id) {
          // If our user manually sets an override (Offline), we don't send a public online pulse
          if (storedStatusOverride === 'offline') {
            console.log('Presence pulser blocked by Status Override (Offline)');
            return;
          }
          // True reliable presence, doesn't rely on falible visibility api on startup
          setOnlineStatus(true);
        }
      })
      .on('presence', { event: 'leave' }, ({ key, leftPresences }) => {
        console.log(`User ${key} connection broken`, leftPresences);
        if (key === user.id) {
          // We can't rely on beforeunload to update DB, connection handling is key.
          // Supabase detects broken connections. We just update intent.
          setOnlineStatus(false);
        }
      })
      .subscribe();

    // Re-pulser logic for visibility api, because visibility change can trigger online pulses.
    const handleVisibilityChange = () => {
      // Robust pulser check
      if (presenceChannel.state !== 'joined') return;
      if (storedStatusOverride === 'offline') return;
      
      setOnlineStatus(document.visibilityState === 'visible');
    };

    // Beforeunload still exists but isn't critical anymore, server presence is robust.
    const handleBeforeUnload = () => setOnlineStatus(false);

    document.addEventListener('visibilitychange', handleVisibilityChange);
    window.addEventListener('beforeunload', handleBeforeUnload);

    return () => {
      presenceChannel.unsubscribe();
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      window.removeEventListener('beforeunload', handleBeforeUnload);
    };
  }, [user, presencePrivacyLevel, profilePhotoPrivacyLevel, statusOverride]);

  return null; // A global presence manager component doesn't need to render UI itself.
}