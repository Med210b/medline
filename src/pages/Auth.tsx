import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '@/src/lib/supabase';
import { Button } from '@/src/components/ui/button';
import { Input } from '@/src/components/ui/input';
import { Label } from '@/src/components/ui/label';
import { Camera, Mail, PhoneIcon, User, ArrowLeft } from 'lucide-react';
import PhoneInput from 'react-phone-number-input';
import 'react-phone-number-input/style.css'; // Don't forget the css!

// Define the steps to handle state flow
type AuthStep = 'phone' | 'profile' | 'email_input' | 'otp';

export default function Auth() {
  const navigate = useNavigate();
  
  // 1. Core State
  const [step, setStep] = useState<AuthStep>('phone');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // 2. Form States
  // Using React Phone Input library
  const [phone, setPhone] = useState<string | undefined>(''); 
  const [name, setName] = useState('');
  const [avatarFile, setAvatarFile] = useState<File | null>(null);
  const [avatarPreview, setAvatarPreview] = useState<string>('');
  const [email, setEmail] = useState('');
  const [emailOtp, setEmailOtp] = useState('');

  // 3. UI Helpers
  const goBack = (to: AuthStep) => {
    setError(null);
    setStep(to);
  }

  // Handle image preview
  const handleAvatarSelect = (event: React.ChangeEvent<HTMLInputElement>) => {
    setError(null);
    if (!event.target.files || event.target.files.length === 0) return;
    
    const file = event.target.files[0];
    setAvatarFile(file);
    // Create a temporary local URL for preview
    setAvatarPreview(URL.createObjectURL(file));
  };

  // 4. Submission Handlers for each step

  // STEP 1: Submit Phone Number
  const submitPhone = (e: React.FormEvent) => {
    e.preventDefault();
    if (!phone) {
      setError("Please enter a valid phone number.");
      return;
    }
    // No Supabase auth here yet, just moving logic flow.
    // In a real production app, you might want to call an edge function
    // to check if this phone is already in use by a confirmed account.
    setError(null);
    setStep('profile');
  };

  // STEP 2: Submit Profile Data
  const submitProfile = (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) {
      setError("Please enter your name.");
      return;
    }
    setError(null);
    setStep('email_input');
  };

  // STEP 3: Submit Email (This initiates the actual auth)
  const submitEmailAndSendOtp = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email) {
      setError("Please enter a valid email.");
      return;
    }
    
    setLoading(true);
    setError(null);
    
    try {
      // Initiate Supabase sign in with OTP.
      // Since we haven't officially created the user yet, 
      // Supabase treats this as the first step of creating an account.
      const { error: otpError } = await supabase.auth.signInWithOtp({
        email,
      });
      
      if (otpError) throw otpError;

      // Proceed to the last step (OTP entry)
      setStep('otp');
    } catch (err: any) {
      setError(err.message || "Failed to send verification email. Please check your address.");
    } finally {
      setLoading(false);
    }
  };

  // STEP 4: Final Verification (OTP entry + Data saving)
  const verifyAndCompleteAuth = async (e: React.FormEvent) => {
    e.preventDefault();
    if (emailOtp.length !== 6) {
      setError("The verification code must be exactly 6 numbers.");
      return;
    }

    setLoading(true);
    setError(null);
    try {
      // 1. Verify the OTP sent to email. On success, the session is established.
      const { data: { user: authUser }, error: verifyError } = await supabase.auth.verifyOtp({
        email,
        token: emailOtp,
        type: 'email',
      });
      
      if (verifyError || !authUser) throw verifyError || new Error("Auth failed.");

      // 2. Session is good! Now upload the avatar to Supabase Storage.
      let uploadedAvatarUrl = '';
      if (avatarFile) {
        // Simple file naming based on timestamp + random number
        const fileExt = avatarFile.name.split('.').pop();
        const fileName = `${authUser.id}-${Date.now()}.${fileExt}`;

        const { error: uploadError } = await supabase.storage
          .from('avatars')
          .upload(fileName, avatarFile);

        if (uploadError) {
          console.error("Avatar upload error:", uploadError);
          // Don't crash the auth if image upload fails, just proceed without avatar.
        } else {
          // Get the public URL for the newly uploaded file
          const { data } = supabase.storage.from('avatars').getPublicUrl(fileName);
          uploadedAvatarUrl = data.publicUrl;
        }
      }

      // 3. Final Step: Save the profile data to our public 'users' table.
      // Note: We use the `phone` variable which was collected in step 1.
      const updates = {
        id: authUser.id,
        name,
        avatar_url: uploadedAvatarUrl,
        phone, // Using the phone state from step 1
        email,
        is_online: true,
        last_seen: new Date().toISOString(),
      };
      
      // Upsert will insert if new, update if existing (e.g. if auth was partially completed previously)
      const { error: dbError } = await supabase.from('users').upsert(updates);
      if (dbError) throw dbError;
      
      // Authentication complete! Navigate to chat.
      navigate('/chat');
    } catch (err: any) {
      setError(err.message || 'Invalid code. Please try again or resend a new PIN.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-50 p-4">
      <div className="w-full max-w-md rounded-2xl bg-white p-8 shadow-xl">
        <div className="mb-8 text-center">
          <h1 className="text-3xl font-bold tracking-tight text-slate-900">
            {step === 'profile' ? 'Profile Setup' : 'MedLine'}
          </h1>
          <p className="mt-2 text-sm text-slate-500">
            {step === 'phone' && "Enter your number to sign up"}
            {step === 'profile' && "Set your profile photo and name"}
            {step === 'email_input' && "Enter your email for security"}
            {step === 'otp' && `Check your email (${email}) for the 6-digit code`}
          </p>
        </div>

        {error && (
          <div className="mb-4 rounded-md bg-red-50 p-3 text-sm text-red-600">
            {error}
          </div>
        )}

        {/* --- STEP 1: PHONE --- */}
        {step === 'phone' && (
          <form onSubmit={submitPhone} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="phone">Phone Number</Label>
              {/* react-phone-number-input component */}
              <div className="flex w-full">
                 <PhoneInput
                  international
                  defaultCountry="AE" // Dubai, as requested by the region context
                  placeholder="Enter phone number"
                  value={phone}
                  onChange={setPhone}
                  // We map the library's input styles to match your Tailwind setup
                  className="w-full"
                  inputComponent={Input}
                />
              </div>
            </div>
            <Button type="submit" className="w-full bg-indigo-600 hover:bg-indigo-700">
              Continue
            </Button>
            <div className="text-center mt-4">
              <button type="button" onClick={() => {}} className="text-sm text-indigo-600 hover:text-indigo-500">
                Already have an account? Log in
              </button>
            </div>
          </form>
        )}

        {/* --- STEP 2: PROFILE (Avatar + Name) --- */}
        {step === 'profile' && (
          <form onSubmit={submitProfile} className="space-y-6">
            <div className="flex flex-col items-center space-y-4">
              <div className="relative h-24 w-24 overflow-hidden rounded-full bg-slate-100 border border-slate-200 shadow-inner">
                {avatarPreview ? (
                  <img src={avatarPreview} alt="Avatar" className="h-full w-full object-cover" />
                ) : (
                  <div className="flex h-full w-full items-center justify-center text-slate-400">
                    <User size={32} />
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
               <Label className="text-xs text-slate-500 cursor-pointer">
                Profile picture (Optional)
              </Label>
            </div>

            <div className="space-y-2">
              <Label htmlFor="name">Display Name</Label>
              <Input
                id="name"
                type="text"
                placeholder="How others see you"
                value={name}
                onChange={(e) => setName(e.target.value)}
                required
              />
            </div>

            <div className="flex space-x-2 pt-2">
                <Button type="button" variant="outline" size="icon" onClick={() => goBack('phone')}>
                    <ArrowLeft className="h-4 w-4" />
                </Button>
                <Button type="submit" className="flex-1 bg-indigo-600 hover:bg-indigo-700">
                    Continue
                </Button>
            </div>
          </form>
        )}

        {/* --- STEP 3: EMAIL INPUT --- */}
        {step === 'email_input' && (
          <form onSubmit={submitEmailAndSendOtp} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="email">Email Address</Label>
              <div className="relative">
                <Mail className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
                <Input
                  id="email"
                  type="email"
                  placeholder="name@example.com"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="pl-9"
                  required
                />
              </div>
               <p className="text-xs text-slate-500 pt-1">We will send a verification PIN to this address.</p>
            </div>
             <div className="flex space-x-2 pt-2">
                <Button type="button" variant="outline" size="icon" disabled={loading} onClick={() => goBack('profile')}>
                    <ArrowLeft className="h-4 w-4" />
                </Button>
                <Button type="submit" className="flex-1 bg-indigo-600 hover:bg-indigo-700" disabled={loading}>
                    {loading ? 'Sending Code...' : 'Send Verification Email'}
                </Button>
            </div>
          </form>
        )}

        {/* --- STEP 4: FINAL Verification (Email OTP) --- */}
        {step === 'otp' && (
          <form onSubmit={verifyAndCompleteAuth} className="space-y-4">
            <div className="space-y-2 text-center">
              <Label htmlFor="emailOtp" className="block pb-2">6-Digit Email PIN</Label>
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
                // Styled to emphasize numeric nature with wide spacing
                className="text-center text-3xl font-mono tracking-[1em] focus:tracking-[1em] border-2 border-indigo-200 focus:border-indigo-600 h-16 rounded-xl"
              />
            </div>
            
            <div className="flex space-x-2 pt-2">
                <Button type="button" variant="outline" size="icon" disabled={loading} onClick={() => goBack('email_input')}>
                    <ArrowLeft className="h-4 w-4" />
                </Button>
                <Button type="submit" className="flex-1 bg-indigo-600 hover:bg-indigo-700" disabled={loading}>
                    {loading ? 'Verifying...' : 'Complete Sign Up'}
                </Button>
            </div>
            
            <p className="text-xs text-slate-500 text-center mt-3 pt-2">
                Didn't receive the email? Check your spam or 
                <button type="button" onClick={submitEmailAndSendOtp} disabled={loading} className="text-indigo-600 hover:underline ml-1">
                    resend a new code.
                </button>
            </p>
          </form>
        )}
      </div>
    </div>
  );
}