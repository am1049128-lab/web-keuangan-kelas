import { createClient } from '@supabase/supabase-js';
// Anon key aman di frontend selama RLS aktif. Jangan pernah pakai service role key di sini.
export const supabase = createClient(
  import.meta.env.VITE_SUPABASE_URL=https://dbebwaenenjgclwlpzco.supabase.co,
  import.meta.env.VITE_SUPABASE_ANON_KEY=sb_publishable_X87HiJjqEech1FlrhWrTTg_wCNydlWo
);
