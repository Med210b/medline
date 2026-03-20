import { createClient } from '@supabase/supabase-js';

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL || 'https://vydtnkweietlfvjhbdhv.supabase.co';
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InZ5ZHRua3dlaWV0bGZ2amhiZGh2Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzM5MjY4ODIsImV4cCI6MjA4OTUwMjg4Mn0.hJII6DG0BmFgc8i7cE5BLwFheHGSYRb7WrOSbLIz9Zc';

// Create a dummy client if keys are missing to prevent module load crash.
// The App component will render a setup screen instead of using this client.
export const supabase = supabaseUrl && supabaseAnonKey 
  ? createClient(supabaseUrl, supabaseAnonKey)
  : ({} as any);
