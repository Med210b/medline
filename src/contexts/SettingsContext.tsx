import React, { createContext, useContext, useState, useEffect } from 'react';

type Theme = 'light' | 'dark' | 'system';
type PrivacyLevel = 'everyone' | 'nobody';
type StatusOverride = 'online' | 'offline' | null;

interface SettingsContextType {
  theme: Theme;
  setTheme: (theme: Theme) => void;
  soundsEnabled: boolean;
  setSoundsEnabled: (enabled: boolean) => void;
  presencePrivacy: PrivacyLevel;
  setPresencePrivacy: (level: PrivacyLevel) => void;
  profilePhotoPrivacy: PrivacyLevel;
  setProfilePhotoPrivacy: (level: PrivacyLevel) => void;
  statusOverride: StatusOverride;
  setStatusOverride: (override: StatusOverride) => void;
}

const SettingsContext = createContext<SettingsContextType | undefined>(undefined);

const THEME_KEY = 'medline_theme';
const SOUNDS_KEY = 'medline_sounds';
const PRESENCE_PRIVACY_KEY = 'medline_presence_privacy';
const PROFILE_PHOTO_PRIVACY_KEY = 'medline_profile_photo_privacy';
const STATUS_OVERRIDE_KEY = 'medline_status_override';

export function SettingsProvider({ children }: { children: React.ReactNode }) {
  const [theme, setTheme] = useState<Theme>(
    (localStorage.getItem(THEME_KEY) as Theme) || 'system'
  );
  const [soundsEnabled, setSoundsEnabled] = useState<boolean>(
    localStorage.getItem(SOUNDS_KEY) !== 'false'
  );
  const [presencePrivacy, setPresencePrivacy] = useState<PrivacyLevel>(
    (localStorage.getItem(PRESENCE_PRIVACY_KEY) as PrivacyLevel) || 'everyone'
  );
  const [profilePhotoPrivacy, setProfilePhotoPrivacy] = useState<PrivacyLevel>(
    (localStorage.getItem(PROFILE_PHOTO_PRIVACY_KEY) as PrivacyLevel) || 'everyone'
  );
  const [statusOverride, setStatusOverride] = useState<StatusOverride>(
    (localStorage.getItem(STATUS_OVERRIDE_KEY) as StatusOverride) || null
  );

  // Apply Theme effect
  useEffect(() => {
    const root = document.documentElement;
    if (theme === 'dark' || (theme === 'system' && window.matchMedia('(prefers-color-scheme: dark)').matches)) {
      root.classList.add('dark');
    } else {
      root.classList.remove('dark');
    }
    localStorage.setItem(THEME_KEY, theme);
  }, [theme]);

  // Persist toggles effect
  useEffect(() => {
    localStorage.setItem(SOUNDS_KEY, soundsEnabled.toString());
    localStorage.setItem(PRESENCE_PRIVACY_KEY, presencePrivacy);
    localStorage.setItem(PROFILE_PHOTO_PRIVACY_KEY, profilePhotoPrivacy);
    // WhatsApp clone feature: Storing status override userintent
    if (statusOverride === null) {
        localStorage.removeItem(STATUS_OVERRIDE_KEY);
    } else {
        localStorage.setItem(STATUS_OVERRIDE_KEY, statusOverride);
    }
  }, [soundsEnabled, presencePrivacy, profilePhotoPrivacy, statusOverride]);

  return (
    <SettingsContext.Provider value={{
      theme, setTheme,
      soundsEnabled, setSoundsEnabled,
      presencePrivacy, setPresencePrivacy,
      profilePhotoPrivacy, setProfilePhotoPrivacy,
      statusOverride, setStatusOverride,
    }}>
      {children}
    </SettingsContext.Provider>
  );
}

export function useSettings() {
  const context = useContext(SettingsContext);
  if (context === undefined) {
    throw new Error('useSettings must be used within a SettingsProvider');
  }
  return context;
}