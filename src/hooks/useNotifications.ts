import { useEffect } from 'react';

export function getSettings() {
  const saved = localStorage.getItem('app_settings');
  if (saved) {
    try {
      return JSON.parse(saved);
    } catch (e) {
      console.error('Failed to parse settings', e);
    }
  }
  return {
    enableSounds: true,
    messagePreviews: true,
    darkMode: false,
    notifications: true,
  };
}

export function playNotificationSound() {
  const settings = getSettings();
  if (settings.enableSounds) {
    try {
      // In a real app, you would have a sound file in public/sounds/notification.mp3
      // const audio = new Audio('/sounds/notification.mp3');
      // audio.play().catch(e => console.error('Error playing sound', e));
      console.log('Playing notification sound...');
    } catch (e) {
      console.error('Failed to play sound', e);
    }
  }
}

export function showNotification(title: string, body: string) {
  const settings = getSettings();
  if (!settings.notifications) return;

  const notificationBody = settings.messagePreviews ? body : 'New message received';

  if (typeof window !== 'undefined' && 'Notification' in window) {
    if (Notification.permission === 'granted') {
      new Notification(title, { body: notificationBody });
    }
  }
}

export function useNotifications() {
  useEffect(() => {
    const requestPermission = async () => {
      const settings = getSettings();
      if (!settings.notifications) return;

      // Check if running in Capacitor
      const isCapacitor = typeof window !== 'undefined' && (window as any).Capacitor !== undefined;
      
      if (!isCapacitor) {
        // Web environment
        if (typeof window !== 'undefined' && 'Notification' in window) {
          try {
            const permission = await Notification.requestPermission();
            if (permission === 'granted') {
              console.log('Notification permission granted.');
            }
          } catch (error) {
            console.error('Error requesting notification permission', error);
          }
        }
      }
    };

    requestPermission();
  }, []);
}
