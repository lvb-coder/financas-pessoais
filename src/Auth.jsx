import { useState } from "react";
import { supabase } from "./supabaseClient";

export default function Auth() {
  const [mode, setMode] = useState("login"); // login | signup | forgot
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
      } else if (mode === "signup") {
        const { error } = await supabase.auth.signUp({ email, password });
        if (error) throw error;
        setInfo("Conta criada! Verifique seu email para confirmar antes de entrar.");
      } else if (mode === "forgot") {
        const { error } = await supabase.auth.resetPasswordForEmail(email, {
          redirectTo: window.location.origin,
        });
        if (error) throw error;
        setInfo("Enviamos um link de redefinição pro seu email. Ele abre direto neste endereço.");
      }
    } catch (err) {
      setError(err.message || "Algo deu errado.");
    } finally {
      setLoading(false);
    }
  };

  const trocarModo = (novoModo) => {
    setMode(novoModo);
    setError("");
    setInfo("");
  };

  const titulo = mode === "login" ? "Entrar" : mode === "signup" ? "Criar conta" : "Redefinir senha";
  const textoBotao = mode === "login" ? "Entrar" : mode === "signup" ? "Criar conta" : "Enviar link de redefinição";

  return (
    <div className="auth-screen">
      <Root />
      <form className="auth-card" onSubmit={submit}>
        <p className="eyebrow">XCore</p>
        <h1>{titulo}</h1>
        {mode === "forgot" && (
          <p className="auth-hint">Digite seu email e mandamos um link pra você criar uma senha nova.</p>
        )}

        <label>
          Email
          <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required autoFocus />
        </label>

        {mode !== "forgot" && (
          <label>
            Senha
            <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} required minLength={6} />
          </label>
        )}

        {error && <p className="auth-error">{error}</p>}
        {info && <p className="auth-info">{info}</p>}

        <button type="submit" className="submit-btn" disabled={loading}>
          {loading ? "Aguarde…" : textoBotao}
        </button>

        <div className="auth-links">
          {mode === "login" && (
            <>
              <button type="button" className="auth-switch" onClick={() => trocarModo("forgot")}>
                Esqueci minha senha
              </button>
              <button type="button" className="auth-switch" onClick={() => trocarModo("signup")}>
                Ainda não tenho conta
              </button>
            </>
          )}
          {mode === "signup" && (
            <button type="button" className="auth-switch" onClick={() => trocarModo("login")}>
              Já tenho conta
            </button>
          )}
          {mode === "forgot" && (
            <button type="button" className="auth-switch" onClick={() => trocarModo("login")}>
              Voltar pro login
            </button>
          )}
        </div>
      </form>
    </div>
  );
}

function Root() {
  return (
    <style>{`
      .auth-screen { min-height: 100vh; display: flex; align-items: center; justify-content: center; background: #FFF7F8; padding: 20px; font-family: 'IBM Plex Sans', Inter, sans-serif; box-sizing: border-box; }
      .auth-card { background: #FFFFFF; border: 1px solid #E6E6EA; border-radius: 16px; padding: 32px 28px; width: 100%; max-width: 360px; display: grid; gap: 14px; color: #1F2937; box-shadow: 0 1px 3px rgba(31,41,55,0.08), 0 1px 2px rgba(31,41,55,0.05); box-sizing: border-box; }
      .auth-card .eyebrow { font-size: 11px; letter-spacing: 0.12em; text-transform: uppercase; color: #C23B6B; font-weight: 700; margin: 0; }
      .auth-card h1 { font-size: 24px; margin: 0 0 4px; font-weight: 600; }
      .auth-hint { font-size: 13px; color: #6B7280; margin: -6px 0 4px; }
      .auth-card label { display: grid; gap: 6px; font-size: 12px; color: #6B7280; font-weight: 500; }
      .auth-card input { background: #FFF7F8; border: 1px solid #E6E6EA; border-radius: 8px; padding: 11px 12px; color: #1F2937; font-size: 14px; font-family: inherit; box-sizing: border-box; }
      .auth-card input:focus { outline: none; border-color: #C23B6B; }
      .submit-btn { background: #C23B6B; color: #FFFFFF; border: none; border-radius: 999px; padding: 12px; font-weight: 600; font-size: 14px; cursor: pointer; margin-top: 6px; }
      .submit-btn:disabled { opacity: 0.6; cursor: default; }
      .auth-links { display: flex; flex-direction: column; align-items: center; gap: 6px; margin-top: 4px; }
      .auth-switch { background: none; border: none; color: #6B7280; font-size: 12px; cursor: pointer; padding: 2px; }
      .auth-switch:hover { color: #C23B6B; text-decoration: underline; }
      .auth-error { color: #E5484D; font-size: 13px; margin: 0; }
      .auth-info { color: #22C55E; font-size: 13px; margin: 0; }
    `}</style>
  );
}
