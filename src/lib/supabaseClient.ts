import { createClient } from "@supabase/supabase-js";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY; // 없을 수도 있음(서버 전용)

// 브라우저용(항상 anon)
export const supabase = createClient(supabaseUrl, anonKey);

// 서버용
// ✅ service_role 있으면 그걸 쓰고, 없으면 anon으로라도 서버 클라이언트 생성
export const supabaseServer = createClient(
  supabaseUrl,
  serviceKey ?? anonKey,
  { auth: { persistSession: false } }
);