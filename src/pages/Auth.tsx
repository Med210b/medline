import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '@/src/contexts/AuthContext';
import { supabase } from '@/src/lib/supabase';
import { Button } from '@/src/components/ui/button';
import { Input } from '@/src/components/ui/input';
import { Label } from '@/src/components/ui/label';
import { Camera } from 'lucide-react';
import PhoneInput from 'react-phone-number-input';
import 'react-phone-number-input/style.css';

export default function Auth() {
  const { user } = useAuth();
  const navigate = useNavigate();
  
  // Phone Auth State
  const [phone, setPhone] = useState('');
  
  // Profile State
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [avatarFile, setAvatarFile] = useState<File | null>(null);
  const [avatarPreview, setAvatarPreview] = useState<string>('');
  const [emailOtp, setEmailOtp] = useState('');
  
  // UI State
  const [step, setStep] = useState<'phone' | 'profile' | 'email_pin'>('phone');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    // Auto-redirect if user is already fully logged in and has a profile
    if (user && step === 'phone') {
      checkProfile();
    }
  }, [user]);

  const checkProfile = async () => {
    if (!user) return;
    try {
      const { data } = await supabase.from('users').select('*').eq('id', user.id).maybeSingle();
      if (data?.name && user.email) {
        navigate('/chat');
      } else {
        setStep('profile');
        if (data) {
          setName(data.name || '');
          setAvatarPreview(data.avatar_url || '');
        }
        if (user.email) setEmail(user.email);
      }
    } catch (err) {
      console.error('Error checking profile:', err);
      setStep('profile');
    }
  };

  const handlePhoneSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!phone) return;
    setLoading(true);
    setError(null);
    
    try {
      // 1. Check if phone exists in the database
      const { data, error: fetchError } = await supabase
        .from('users')
        .select('email')
        .eq('phone', phone)
        .maybeSingle();
        
      if (fetchError && fetchError.code !== 'PGRST116') {
        console.error('Error fetching user:', fetchError);
      }
        
      if (data && data.email) {
        // 2. Existing user: Log them in directly using phone as password
        const { error: signInError } = await supabase.auth.signInWithPassword({
          email: data.email,
          password: phone
        });
        
        if (signInError) {
          throw new Error("Login failed. Please check your credentials or contact support.");
        } else {
          navigate('/chat');
        }
      } else {
        // 3. New user: Proceed to profile setup
        setStep('profile');
      }
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const handleAvatarSelect = (event: React.ChangeEvent<HTMLInputElement>) => {
    setError(null);
    if (!event.target.files || event.target.files.length === 0) return;
    
    const file = event.target.files[0];
    setAvatarFile(file);
    setAvatarPreview(URL.createObjectURL(file));
  };

  const performAvatarUpload = async (userId: string): Promise<string | null> => {
    if (!avatarFile) return null;
    try {
      const fileExt = avatarFile.name.split('.').pop();
      const fileName = `${userId}-${Math.random().toString(36).substring(2, 15)}.${fileExt}`;

      const { error: uploadError } = await supabase.storage
        .from('avatars')
        .upload(fileName, avatarFile);

      if (uploadError) {
        console.error("Avatar upload error:", uploadError);
        if (uploadError.message.includes('bucket not found') || uploadError.message.includes('Bucket not found')) {
          alert("Warning: The 'avatars' storage bucket was not found. Your profile picture was not saved. Please create a public bucket named 'avatars' in Supabase.");
        }
        return null; // Don't fail the whole process if avatar upload fails
      }

      const { data } = supabase.storage.from('avatars').getPublicUrl(fileName);
      return data.publicUrl;
    } catch (err) {
      console.error("Avatar upload exception:", err);
      return null;
    }
  };

  const handleProfileSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email || !name) return;
    
    try {
      setLoading(true);
      setError(null);
      
      // Sign up the user. This triggers the Supabase confirmation email.
      const { data, error } = await supabase.auth.signUp({ 
        email, 
        password: phone 
      });
      
      if (error) {
        if (error.message.includes('already registered')) {
          throw new Error("This email is already registered. If you already have an account, please use the correct phone number to log in.");
        }
        throw error;
      }
      
      if (data.session) {
        // Auto-confirmed (e.g. email confirmation disabled in Supabase)
        const uploadedAvatarUrl = await performAvatarUpload(data.user!.id);
        
        const updates = {
          id: data.user!.id,
          name,
          avatar_url: uploadedAvatarUrl || '',
          phone: phone,
          email: email,
          is_online: true,
          last_seen: new Date().toISOString(),
        };
        
        const { error: dbError } = await supabase.from('users').upsert(updates);
        if (dbError) {
          console.error("DB Error:", dbError);
          if (dbError.message.includes('row-level security')) {
            throw new Error("Database permission denied. Please run the RLS SQL snippet in your Supabase dashboard.");
          }
          throw dbError;
        }
        navigate('/chat');
      } else {
        // Needs email confirmation via 6-digit OTP
        setStep('email_pin');
      }
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const handleResendOtp = async () => {
    try {
      setLoading(true);
      setError(null);
      const { error } = await supabase.auth.resend({
        type: 'signup',
        email: email,
      });
      if (error) throw error;
      alert("A new 6-digit PIN has been sent to your email.");
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const handleVerifyEmailOtp = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError(null);
    try {
      // Verify the 6-digit OTP sent to email
      const { data, error: verifyError } = await supabase.auth.verifyOtp({
        email,
        token: emailOtp,
        type: 'signup',
      });
      if (verifyError) throw verifyError;
      
      if (data.user) {
        // Upload avatar now that user is authenticated
        const uploadedAvatarUrl = await performAvatarUpload(data.user.id);
        
        // Update public.users table
        const updates = {
          id: data.user.id,
          name,
          avatar_url: uploadedAvatarUrl || '',
          phone: phone,
          email: email,
          is_online: true,
          last_seen: new Date().toISOString(),
        };
        
        const { error: dbError } = await supabase.from('users').upsert(updates);
        if (dbError) {
          if (dbError.message.includes('row-level security')) {
            throw new Error("Database permission denied. Please run the RLS SQL snippet in your Supabase dashboard.");
          }
          throw dbError;
        }
        
        navigate('/chat');
      }
    } catch (err: any) {
      setError(err.message || 'Invalid Email PIN');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-50 p-4">
      <div className="w-full max-w-md rounded-2xl bg-white p-8 shadow-xl">
        <div className="mb-8 text-center">
          <h1 className="text-3xl font-bold tracking-tight text-slate-900">
            {step === 'profile' || step === 'email_pin' ? 'Complete Profile' : 'MedLine'}
          </h1>
          <p className="mt-2 text-sm text-slate-500">
            {step === 'phone' && 'Enter your phone number to continue'}
            {step === 'profile' && 'Set up your MedLine profile details'}
            {step === 'email_pin' && (
              <>
                Enter the 6-digit PIN sent to your email
                <br />
                <span className="text-xs text-slate-400">
                  (Dev Note: Ensure your Supabase "Confirm signup" email template uses {'{{ .Token }}'} instead of {'{{ .ConfirmationURL }}'})
                </span>
              </>
            )}
          </p>
        </div>

        {error && (
          <div className="mb-4 rounded-md bg-red-50 p-3 text-sm text-red-600">
            {error}
          </div>
        )}

        {step === 'phone' && (
          <form onSubmit={handlePhoneSubmit} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="phone">Phone Number</Label>
              <PhoneInput
                id="phone"
                international
                defaultCountry="US"
                placeholder="Enter phone number"
                value={phone}
                onChange={(value) => setPhone(value || '')}
                inputComponent={Input}
                className="flex w-full"
              />
            </div>
            <Button type="submit" className="w-full" disabled={loading}>
              {loading ? 'Checking...' : 'Continue'}
            </Button>
          </form>
        )}

        {step === 'profile' && (
          <form onSubmit={handleProfileSubmit} className="space-y-6">
            <div className="flex flex-col items-center space-y-4">
              <div className="relative h-24 w-24 overflow-hidden rounded-full bg-slate-100">
                {avatarPreview ? (
                  <img src={avatarPreview} alt="Avatar" className="h-full w-full object-cover" />
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
                    onChange={handleAvatarSelect}
                    className="hidden"
                  />
                </label>
              </div>
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

            <Button type="submit" className="w-full" disabled={loading}>
              {loading ? 'Processing...' : 'Send Email OTP'}
            </Button>
            <Button
              type="button"
              variant="ghost"
              className="w-full text-slate-500"
              onClick={() => setStep('phone')}
              disabled={loading}
            >
              Back
            </Button>
          </form>
        )}

        {step === 'email_pin' && (
          <form onSubmit={handleVerifyEmailOtp} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="emailOtp">6-Digit Email PIN</Label>
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
              variant="outline"
              className="w-full"
              onClick={handleResendOtp}
              disabled={loading}
            >
              Resend PIN
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
