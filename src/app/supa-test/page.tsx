"use client";

import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabaseClient";

export default function SupaTestPage() {
  const [msg, setMsg] = useState("checking...");

  useEffect(() => {
    const check = async () => {
      const { data, error } = await supabase.auth.getSession();

      if (error) {
        setMsg("ERROR: " + error.message);
      } else {
        setMsg("OK: Supabase connected");
      }
    };

    check();
  }, []);

  return (
    <div style={{ padding: 40 }}>
      <h1>Supabase Connection Test</h1>
      <p>{msg}</p>
    </div>
  );
}