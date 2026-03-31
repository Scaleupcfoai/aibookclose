import { createClient } from '@supabase/supabase-js';

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL || 'https://acgfqezkvmttvoyuwdnb.supabase.co';
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImFjZ2ZxZXprdm10dHZveXV3ZG5iIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzQyNTI3MTksImV4cCI6MjA4OTgyODcxOX0.4uOzkbTpViJBUwLIkZv6WmisDXDVUCjW0C_HzXLFn9s';

export const supabase = createClient(supabaseUrl, supabaseAnonKey);
