"use client";

import { useState } from "react";

export default function LoginPage() {
  const [password, setPassword] = useState("");
  const [msg, setMsg] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setMsg(null);

    const params = new URLSearchParams(window.location.search);
    const next = params.get("next") || "/products";

    try {
      const res = await fetch("/api/gate/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password }),
      });

      if (!res.ok) {
        setMsg("비밀번호가 틀렸습니다.");
        return;
      }

      window.location.replace(next);
    } catch {
      setMsg("로그인 오류. 다시 시도해 주세요.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <main style={{ padding: 24, maxWidth: 420 }}>
      <h1 style={{ fontSize: 22, fontWeight: 700, marginBottom: 12 }}>비밀번호 입력</h1>

      <form onSubmit={onSubmit}>
        <input
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          placeholder="비밀번호"
          style={{ width: "100%", padding: 10, border: "1px solid #ddd", borderRadius: 8 }}
        />

        <button
          type="submit"
          disabled={!password || loading}
          style={{ marginTop: 12, padding: "10px 14px", borderRadius: 8 }}
        >
          {loading ? "확인 중..." : "입장"}
        </button>
      </form>

      {msg && <p style={{ marginTop: 12, color: "crimson" }}>{msg}</p>}
    </main>
  );
}