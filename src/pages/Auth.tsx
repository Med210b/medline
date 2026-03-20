import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '@/src/lib/supabase';
import { Button } from '@/src/components/ui/button';
import { Input } from '@/src/components/ui/input';
import { Label } from '@/src/components/ui/label';
import { Mail, User, ArrowLeft, Lock } from 'lucide-react';
import PhoneInput from 'react-phone-number-input';
import 'react-phone-number-input/style.css'; 

type AuthStep = 'phone' | 'profile' | 'credentials' | 'otp';
type AuthMode = 'signup' | 'login';

export default function Auth() {
  const navigate = useNavigate();
  
  // 1. Core State
  const [mode, setMode] = useState<AuthMode>('login'); // Default to login to make it faster for returning users
  const [step, setStep] = useState<AuthStep>('credentials');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // 2. Form States
  const [phone, setPhone] = useState<string | undefined>(''); 
  const [name, setName] = useState('');
  const [avatarFile, setAvatarFile] = useState<File | null>(null);
  const [avatarPreview, setAvatarPreview] = useState<string>('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [emailOtp, setEmailOtp] = useState('');

  // 3. UI Helpers
  const goBack = (to: AuthStep) => {
    setError(null);
    setStep(to);
  }

  const switchToLogin = () => {
    setMode('login');
    setStep('credentials');
    setError(null);
    setPassword('');
  }

  const switchToSignup = () => {
    setMode('signup');
    setStep('phone');
    setError(null);
    setPassword('');
  }

  const handleAvatarSelect = (event: React.ChangeEvent<HTMLInputElement>) => {
    setError(null);
    if (!event.target.files || event.target.files.length === 0) return;
    const file = event.target.files[0];
    setAvatarFile(file);
    setAvatarPreview(URL.createObjectURL(file));
  };

  // 4. Submission Handlers
  const submitPhone = (e: React.FormEvent) => {
    e.preventDefault();
    if (!phone) {
      setError("Please enter a valid phone number.");
      return;
    }
    setError(null);
    setStep('profile');
  };

  const submitProfile = (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) {
      setError("Please enter your name.");
      return;
    }
    setError(null);
    setStep('credentials');
  };

  // SIGN UP: Creates account and triggers the OTP email
  const submitSignupCredentials = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email || password.length < 6) {
      setError("Please enter a valid email and a password (at least 6 characters).");
      return;
    }
    
    setLoading(true);
    setError(null);
    
    try {
      // Create the user with email and password
      const { error: signUpError } = await supabase.auth.signUp({ 
        email, 
        password 
      });
      if (signUpError) throw signUpError;
      
      // Move to OTP to verify their email
      setStep('otp');
    } catch (err: any) {
      setError(err.message || "Failed to create account. Email may already be in use.");
    } finally {
      setLoading(false);
    }
  };

  // LOG IN: Directly logs in existing users using Email + Password (NO OTP)
  const submitLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email || !password) {
      setError("Please enter your email and password.");
      return;
    }

    setLoading(true);
    setError(null);

    try {
      // Sign in directly!
      const { data, error: signInError } = await supabase.auth.signInWithPassword({
        email,
        password,
      });

      if (signInError || !data.user) throw signInError || new Error("Login failed.");

      // Update their online status
      await supabase.from('users').update({
        is_online: true,
        last_seen: new Date().toISOString()
      }).eq('id', data.user.id);
      
      navigate('/chat');
    } catch (err: any) {
      setError("Invalid email or password.");
    } finally {
      setLoading(false);
    }
  };

  // FINAL VERIFICATION (Only for Sign Up)
  const verifySignupOtp = async (e: React.FormEvent) => {
    e.preventDefault();
    
    if (emailOtp.length !== 8) {
      setError("The verification code must be exactly 8 numbers.");
      return;
    }

    setLoading(true);
    setError(null);
    try {
      // Verify the signup OTP
      const { data: { user: authUser }, error: verifyError } = await supabase.auth.verifyOtp({
        email,
        token: emailOtp,
        type: 'signup', // Important: Type is 'signup' because we used signUp()
      });
      
      if (verifyError || !authUser) throw verifyError || new Error("Auth failed.");

      // Upload avatar
      let uploadedAvatarUrl = '';
      if (avatarFile) {
        const fileExt = avatarFile.name.split('.').pop();
        const fileName = `${authUser.id}-${Date.now()}.${fileExt}`;
        const { error: uploadError } = await supabase.storage.from('avatars').upload(fileName, avatarFile);

        if (!uploadError) {
          const { data } = supabase.storage.from('avatars').getPublicUrl(fileName);
          uploadedAvatarUrl = data.publicUrl;
        }
      }

      // Save new profile
      const updates = {
        id: authUser.id,
        name,
        avatar_url: uploadedAvatarUrl,
        phone, 
        email,
        is_online: true,
        last_seen: new Date().toISOString(),
      };
      
      const { error: dbError } = await supabase.from('users').upsert(updates);
      if (dbError) throw dbError;
      
      navigate('/chat');
    } catch (err: any) {
      setError(err.message || 'Invalid code. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-white sm:bg-slate-100 p-0 sm:p-4 font-sans">
      <div className="w-full h-full sm:h-auto max-w-sm sm:rounded-2xl bg-white sm:p-8 p-6 sm:shadow-xl flex flex-col justify-center sm:justify-start">
        
        {/* Header Section */}
        <div className="mb-8 text-center pt-8 sm:pt-0">
          <h1 className="text-2xl font-semibold text-[#111b21] mb-2 tracking-tight">
            {mode === 'login' ? 'Log in to MedLine' : step === 'profile' ? 'Profile info' : step === 'credentials' ? 'Create Password' : 'Verify your number'}
          </h1>
          <p className="text-[15px] leading-relaxed text-[#54656f]">
            {mode === 'login' && step === 'credentials' && "Enter your email and password to log in."}
            {mode === 'signup' && step === 'phone' && "MedLine will send a verification code to your email later."}
            {mode === 'signup' && step === 'profile' && "Please provide your name and an optional profile photo."}
            {mode === 'signup' && step === 'credentials' && "Add an email and password for account security."}
            {mode === 'signup' && step === 'otp' && `Waiting to automatically detect the 8-digit code sent to ${email}.`}
          </p>
        </div>

        {error && (
          <div className="mb-6 rounded-lg bg-red-50 p-4 text-sm text-red-600 text-center border border-red-100">
            {error}
          </div>
        )}

        <div className="flex-1 flex flex-col">
          {/* --- STEP 1: PHONE (Signup Only) --- */}
          {step === 'phone' && mode === 'signup' && (
            <form onSubmit={submitPhone} className="flex flex-col h-full">
              <div className="space-y-1 mb-auto">
                <div className="flex w-full border-b-2 border-[#00a884] focus-within:border-[#00a884] transition-colors py-2">
                   <PhoneInput
                    international
                    defaultCountry="AE"
                    placeholder="phone number"
                    value={phone}
                    onChange={setPhone}
                    className="w-full text-lg outline-none bg-transparent"
                    inputComponent={Input}
                    style={{ border: 'none', boxShadow: 'none', paddingLeft: '8px' }}
                  />
                </div>
              </div>
              
              <div className="mt-12 flex flex-col items-center gap-6">
                <Button type="submit" className="w-[120px] rounded-full bg-[#00a884] hover:bg-[#058b6e] text-white font-medium py-6 text-base shadow-sm">
                  Next
                </Button>
                <button type="button" onClick={switchToLogin} className="text-[15px] text-[#00a884] hover:underline font-medium">
                  Already have an account? Log in
                </button>
              </div>
            </form>
          )}

          {/* --- STEP 2: PROFILE (Signup Only) --- */}
          {step === 'profile' && mode === 'signup' && (
            <form onSubmit={submitProfile} className="flex flex-col h-full">
              <div className="flex flex-col items-center space-y-6 mb-auto">
                <div className="relative h-32 w-32 overflow-hidden rounded-full bg-[#f0f2f5] flex items-center justify-center group cursor-pointer transition-all hover:bg-[#e9edef]">
                  {avatarPreview ? (
                    <img src={avatarPreview} alt="Avatar" className="h-full w-full object-cover" />
                  ) : (
                    <User size={48} className="text-[#aebac1]" />
                  )}
                  <div className="absolute inset-0 bg-black/40 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity">
                     <span className="text-sm font-medium text-white uppercase tracking-wider">Add Photo</span>
                  </div>
                  <input
                    type="file"
                    accept="image/*"
                    onChange={handleAvatarSelect}
                    className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
                  />
                </div>

                <div className="w-full">
                  <Input
                    id="name"
                    type="text"
                    placeholder="Type your name here"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    required
                    className="w-full border-0 border-b-2 border-[#00a884] rounded-none px-0 py-2 text-lg focus-visible:ring-0 shadow-none bg-transparent"
                  />
                </div>
              </div>

              <div className="mt-12 flex items-center justify-between w-full">
                  <Button type="button" variant="ghost" size="icon" onClick={() => goBack('phone')} className="text-[#54656f] hover:bg-[#f0f2f5] rounded-full">
                      <ArrowLeft className="h-6 w-6" />
                  </Button>
                  <Button type="submit" className="w-[120px] rounded-full bg-[#00a884] hover:bg-[#058b6e] text-white font-medium py-6 text-base shadow-sm">
                      Next
                  </Button>
              </div>
            </form>
          )}

          {/* --- STEP 3: CREDENTIALS (Email & Password - Both Modes) --- */}
          {step === 'credentials' && (
            <form onSubmit={mode === 'signup' ? submitSignupCredentials : submitLogin} className="flex flex-col h-full">
              <div className="space-y-6 mb-auto">
                <div className="relative flex items-center border-b-2 border-[#00a884] py-2">
                  <Mail className="h-5 w-5 text-[#8696a0] mr-3" />
                  <Input
                    id="email"
                    type="email"
                    placeholder="Email address"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    className="border-0 p-0 text-lg shadow-none focus-visible:ring-0 rounded-none bg-transparent w-full"
                    required
                  />
                </div>
                
                <div className="relative flex items-center border-b-2 border-[#00a884] py-2">
                  <Lock className="h-5 w-5 text-[#8696a0] mr-3" />
                  <Input
                    id="password"
                    type="password"
                    placeholder="Password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    className="border-0 p-0 text-lg shadow-none focus-visible:ring-0 rounded-none bg-transparent w-full"
                    required
                  />
                </div>
              </div>
              
              <div className="mt-12 flex flex-col items-center gap-6">
                 <div className="flex items-center justify-between w-full">
                    {mode === 'signup' ? (
                      <Button type="button" variant="ghost" size="icon" disabled={loading} onClick={() => goBack('profile')} className="text-[#54656f] hover:bg-[#f0f2f5] rounded-full">
                          <ArrowLeft className="h-6 w-6" />
                      </Button>
                    ) : (
                      <div className="w-10"></div>
                    )}
                    <Button type="submit" className="px-8 rounded-full bg-[#00a884] hover:bg-[#058b6e] text-white font-medium py-6 text-base shadow-sm" disabled={loading}>
                        {loading ? 'Wait...' : mode === 'login' ? 'Log In' : 'Sign Up'}
                    </Button>
                </div>
                {mode === 'login' && (
                  <button type="button" onClick={switchToSignup} className="text-[15px] text-[#00a884] hover:underline font-medium">
                    Need an account? Sign up
                  </button>
                )}
              </div>
            </form>
          )}

          {/* --- STEP 4: FINAL Verification (Sign Up OTP ONLY) --- */}
          {step === 'otp' && mode === 'signup' && (
            <form onSubmit={verifySignupOtp} className="flex flex-col h-full">
              <div className="flex flex-col items-center mb-auto space-y-6">
                <Input
                  id="emailOtp"
                  type="text"
                  inputMode="numeric"
                  pattern="[0-9]*"
                  maxLength={8}
                  placeholder="— — — — — — — —"
                  value={emailOtp}
                  onChange={(e) => setEmailOtp(e.target.value)}
                  required
                  className="w-full text-center text-3xl font-medium tracking-[0.2em] border-0 border-b-2 border-[#00a884] rounded-none px-0 py-4 shadow-none focus-visible:ring-0 bg-transparent text-[#111b21]"
                />
                <p className="text-[14px] text-[#54656f] text-center">
                    Enter 8-digit code
                </p>
              </div>
              
              <div className="mt-12 flex flex-col items-center gap-6">
                <div className="flex items-center justify-between w-full">
                    <Button type="button" variant="ghost" size="icon" disabled={loading} onClick={() => goBack('credentials')} className="text-[#54656f] hover:bg-[#f0f2f5] rounded-full">
                        <ArrowLeft className="h-6 w-6" />
                    </Button>
                    <Button type="submit" className="px-8 rounded-full bg-[#00a884] hover:bg-[#058b6e] text-white font-medium py-6 text-base shadow-sm" disabled={loading}>
                        {loading ? 'Verifying...' : 'Done'}
                    </Button>
                </div>
              </div>
            </form>
          )}
        </div>
      </div>
    </div>
  );
}