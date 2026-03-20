import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '@/src/lib/supabase';
import { useAuth } from '@/src/contexts/AuthContext';
import { Button } from '@/src/components/ui/button';
import { Input } from '@/src/components/ui/input';
import { Label } from '@/src/components/ui/label';
import { Camera } from 'lucide-react';

export default function ProfileSetup() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [avatarUrl, setAvatarUrl] = useState('');
  const [loading, setLoading] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [step, setStep] = useState<'profile' | 'email_otp'>('profile');
  const [emailOtp, setEmailOtp] = useState('');

  useEffect(() => {
    if (user) {
      getProfile();
    }
  }, [user]);

  async function getProfile() {
    try {
      setLoading(true);
      const { data, error, status } = await supabase
        .from('users')
        .select(`name, avatar_url`)
        .eq('id', user?.id)
        .single();

      if (error && status !== 406) {
        throw error;
      }

      if (data) {
        setName(data.name || '');
        setAvatarUrl(data.avatar_url || '');
        if (user?.email) {
          setEmail(user.email);
        }
        if (data.name && user?.email) {
          navigate('/chat');
        }
      }
    } catch (error) {
      console.error('Error loading user data!');
    } finally {
      setLoading(false);
    }
  }

  async function updateProfile(e: React.FormEvent) {
    e.preventDefault();
    try {
      setLoading(true);
      const updates = {
        id: user?.id,
        name,
        avatar_url: avatarUrl,
        phone: user?.phone,
        email: email,
        is_online: true,
        last_seen: new Date().toISOString(),
      };

      const { error } = await supabase.from('users').upsert(updates);

      if (error) throw error;
      
      if (email && email !== user?.email) {
        const { error: updateError } = await supabase.auth.updateUser({ email });
        if (updateError) throw updateError;
        setStep('email_otp');
      } else {
        navigate('/chat');
      }
    } catch (error: any) {
      alert(error.message);
    } finally {
      setLoading(false);
    }
  }

  async function uploadAvatar(event: React.ChangeEvent<HTMLInputElement>) {
    try {
      setUploading(true);
      if (!event.target.files || event.target.files.length === 0) {
        throw new Error('You must select an image to upload.');
      }

      const file = event.target.files[0];
      const fileExt = file.name.split('.').pop();
      const fileName = `${user?.id}-${Math.random()}.${fileExt}`;
      const filePath = `${fileName}`;

      const { error: uploadError } = await supabase.storage
        .from('avatars')
        .upload(filePath, file);

      if (uploadError) {
        throw uploadError;
      }

      const { data } = supabase.storage.from('avatars').getPublicUrl(filePath);
      setAvatarUrl(data.publicUrl);
    } catch (error: any) {
      alert(error.message);
    } finally {
      setUploading(false);
    }
  }

  async function verifyEmailOtp(e: React.FormEvent) {
    e.preventDefault();
    try {
      setLoading(true);
      const { error } = await supabase.auth.verifyOtp({
        email,
        token: emailOtp,
        type: 'email_change',
      });
      if (error) throw error;
      navigate('/chat');
    } catch (error: any) {
      alert(error.message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-50 p-4">
      <div className="w-full max-w-md rounded-2xl bg-white p-8 shadow-xl">
        <div className="mb-8 text-center">
          <h1 className="text-3xl font-bold tracking-tight text-slate-900">
            {step === 'profile' ? 'Complete Profile' : 'Verify Email'}
          </h1>
          <p className="mt-2 text-sm text-slate-500">
            {step === 'profile' ? 'Set up your MedLine profile' : 'Enter the 6-digit PIN sent to your email'}
          </p>
        </div>

        {step === 'profile' ? (
          <form onSubmit={updateProfile} className="space-y-6">
            <div className="flex flex-col items-center space-y-4">
              <div className="relative h-24 w-24 overflow-hidden rounded-full bg-slate-100">
                {avatarUrl ? (
                  <img src={avatarUrl} alt="Avatar" className="h-full w-full object-cover" />
                ) : (
                  <div className="flex h-full w-full items-center justify-center text-slate-400">
                    <Camera size={32} />
                  </div>
                )}
                <label className="absolute inset-0 flex cursor-pointer items-center justify-center bg-black/50 opacity-0 transition-opacity hover:opacity-100">
                  <span className="text-xs text-white">Upload</span>
                  <input
                    type="file"
                    accept="image/*"
                    onChange={uploadAvatar}
                    disabled={uploading}
                    className="hidden"
                  />
                </label>
              </div>
              {uploading && <p className="text-xs text-slate-500">Uploading...</p>}
            </div>

            <div className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="name">Display Name</Label>
                <Input
                  id="name"
                  type="text"
                  placeholder="Your name"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  required
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="email">Email Address</Label>
                <Input
                  id="email"
                  type="email"
                  placeholder="you@example.com"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  required
                />
              </div>
            </div>

            <Button type="submit" className="w-full" disabled={loading || uploading}>
              {loading ? 'Saving...' : 'Continue'}
            </Button>
          </form>
        ) : (
          <form onSubmit={verifyEmailOtp} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="emailOtp">6-Digit PIN</Label>
              <Input
                id="emailOtp"
                type="text"
                inputMode="numeric"
                pattern="[0-9]*"
                maxLength={6}
                placeholder="123456"
                value={emailOtp}
                onChange={(e) => setEmailOtp(e.target.value)}
                required
                className="text-center text-2xl tracking-widest"
              />
            </div>
            <Button type="submit" className="w-full" disabled={loading}>
              {loading ? 'Verifying...' : 'Verify Email'}
            </Button>
            <Button
              type="button"
              variant="ghost"
              className="w-full text-slate-500"
              onClick={() => setStep('profile')}
              disabled={loading}
            >
              Back
            </Button>
          </form>
        )}
      </div>
    </div>
  );
}
