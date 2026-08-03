import { useState } from "react";
import { supabase } from "./supabaseClient";

export default function Auth() {
  const [mode, setMode] = useState("login"); // login | signup
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [info, setInfo] = useState("");
  const [loading, setLoading] = useState(false);

  const submit = async (e) => {
    e.preventDefault();
    setError("");
    setInfo("");
    setLoading(true);
    try {
      if (mode === "login") {
        const { error } = await supabase.auth.signInWithPassword({ email, password });
        if (error) throw error;
      } else {
        const { error } = await supabase.auth.signUp({ email, password });
        if (error) throw error;
        setInfo("Conta criada! Verifique seu email para confirmar antes de entrar.");
      }
    } catch (err) {
      setError(err.message || "Algo deu errado.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="auth-screen">
      <Root />
      <form className="auth-card" onSubmit={submit}>
        <p className="eyebrow">Minhas finanças</p>
        <h1>{mode === "login" ? "Entrar" : "Criar conta"}</h1>
        <label>
          Email
          <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
        </label>
        <label>
          Senha
          <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} required minLength={6} />
        </label>
        {error && <p className="auth-error">{error}</p>}
        {info && <p className="auth-info">{info}</p>}
        <button type="submit" className="submit-btn" disabled={loading}>
          {loading ? "Aguarde…" : mode === "login" ? "Entrar" : "Criar conta"}
        </button>
        <button
          type="button"
          className="auth-switch"
          onClick={() => { setMode(mode === "login" ? "signup" : "login"); setError(""); setInfo(""); }}
        >
          {mode === "login" ? "Ainda não tenho conta" : "Já tenho conta"}
        </button>
      </form>
    </div>
  );
}

function Root() {
  return (
    <style>{`
      .auth-screen { min-height: 100vh; display: flex; align-items: center; justify-content: center; background: #0F1613; padding: 20px; font-family: 'IBM Plex Sans', Inter, sans-serif; }
      .auth-card { background: #172019; border: 1px solid #2A342D; border-radius: 14px; padding: 28px; width: 100%; max-width: 340px; display: grid; gap: 14px; color: #EDEBE4; }
      .auth-card .eyebrow { font-size: 11px; letter-spacing: 0.12em; text-transform: uppercase; color: #8B9389; margin: 0; }
      .auth-card h1 { font-family: 'Fraunces', Georgia, serif; font-size: 24px; margin: 0 0 6px; }
      .auth-card label { display: grid; gap: 6px; font-size: 12px; color: #8B9389; }
      .auth-card input { background: #1D2721; border: 1px solid #2A342D; border-radius: 8px; padding: 10px; color: #EDEBE4; font-size: 14px; font-family: inherit; }
      .submit-btn { background: #C9A24B; color: #0F1613; border: none; border-radius: 999px; padding: 11px; font-weight: 600; cursor: pointer; margin-top: 4px; }
      .submit-btn:disabled { opacity: 0.6; }
      .auth-switch { background: none; border: none; color: #8B9389; font-size: 12px; cursor: pointer; text-decoration: underline; }
      .auth-error { color: #C1613D; font-size: 13px; margin: 0; }
      .auth-info { color: #5FA377; font-size: 13px; margin: 0; }
    `}</style>
  );
}
