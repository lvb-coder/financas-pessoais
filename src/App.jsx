import { useState, useEffect, useMemo } from "react";
import { Plus, Wallet, Settings, X, AlertTriangle, ChevronLeft, ChevronRight, Inbox, Check, LogOut, Landmark } from "lucide-react";
import PluggyConnect from "pluggy-connect-sdk";
import { supabase } from "./supabaseClient";
import Auth from "./Auth";

const GROUPS = {
  essenciais: { label: "Essenciais", color: "#5FA377" },
  extras: { label: "Extras", color: "#C1613D" },
};

const DEFAULT_CATEGORIES = [
  { id: "condominio", name: "Condomínio", group: "essenciais", limit_value: 2000 },
  { id: "iptu", name: "IPTU", group: "essenciais", limit_value: 340 },
  { id: "gas", name: "Gás", group: "essenciais", limit_value: 75 },
  { id: "luz", name: "Luz", group: "essenciais", limit_value: 400 },
  { id: "internet", name: "Internet", group: "essenciais", limit_value: 360 },
  { id: "faculdade", name: "Faculdade", group: "essenciais", limit_value: 125 },
  { id: "erva", name: "Erva", group: "essenciais", limit_value: 0 },
  { id: "mercado", name: "Mercado/Farmácia", group: "essenciais", limit_value: 800 },
  { id: "kali", name: "Kali", group: "essenciais", limit_value: 0 },
  { id: "academia", name: "Academia", group: "essenciais", limit_value: 141 },
  { id: "manicure", name: "Manicure", group: "extras", limit_value: 250 },
  { id: "cabeleireira", name: "Cabeleireira", group: "extras", limit_value: 150 },
  { id: "personal", name: "Personal", group: "extras", limit_value: 0 },
  { id: "poledance", name: "Pole Dance", group: "extras", limit_value: 0 },
  { id: "espanhol", name: "Espanhol", group: "extras", limit_value: 0 },
  { id: "apps", name: "Apps", group: "extras", limit_value: 200 },
  { id: "roupascasa", name: "Roupas/Casa", group: "extras", limit_value: 250 },
  { id: "transporte", name: "Transporte", group: "extras", limit_value: 300 },
  { id: "lazer", name: "Lazer", group: "extras", limit_value: 300 },
  { id: "naoplanejado", name: "Não Planejado", group: "extras", limit_value: 0 },
  { id: "outros", name: "Outros", group: "extras", limit_value: 100 },
];

const FONTES = ["Débito", "Nubank", "Bradesco"];

const currency = (v) =>
  (Number(v) || 0).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

const monthKey = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
const monthLabel = (d) =>
  d.toLocaleDateString("pt-BR", { month: "long", year: "numeric" }).replace(/^\w/, (c) => c.toUpperCase());

function competencia(dateStr, fonte, fechamentos) {
  const [y, m, d] = dateStr.split("-").map(Number);
  if (fonte === "Débito") return `${y}-${String(m).padStart(2, "0")}`;
  const closing = fechamentos[fonte] || 1;
  if (d > closing) {
    const next = new Date(y, m, 1);
    return monthKey(next);
  }
  return `${y}-${String(m).padStart(2, "0")}`;
}

function findRule(rules, estabelecimento) {
  const alvo = estabelecimento.toLowerCase();
  return rules.find((r) => alvo.includes(r.keyword));
}

// -- Mapeadores entre linhas do Supabase (snake_case) e o formato usado na UI --
const mapCategory = (row) => ({ id: row.id, name: row.name, group: row.group, limit: row.limit_value });
const mapTransaction = (row) => ({
  id: row.id, data: row.data, estabelecimento: row.estabelecimento, valor: Number(row.valor),
  fonte: row.fonte, status: row.status, categoryId: row.category_id, suggestedCategoryId: row.suggested_category_id,
});
const mapRule = (row) => ({ keyword: row.keyword, categoryId: row.category_id, alwaysAsk: row.always_ask });

export default function App() {
  const [session, setSession] = useState(undefined); // undefined = carregando, null = deslogado

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => setSession(data.session));
    const { data: sub } = supabase.auth.onAuthStateChange((_event, s) => setSession(s));
    return () => sub.subscription.unsubscribe();
  }, []);

  if (session === undefined) return <div style={{ minHeight: "100vh", background: "#0F1613" }} />;
  if (!session) return <Auth />;
  return <Dashboard userId={session.user.id} />;
}

function Dashboard({ userId }) {
  const [loaded, setLoaded] = useState(false);
  const [categories, setCategories] = useState([]);
  const [transactions, setTransactions] = useState([]);
  const [rules, setRules] = useState([]);
  const [fechamentos, setFechamentos] = useState({ Nubank: 3, Bradesco: 8 });
  const [cursor, setCursor] = useState(new Date());
  const [showAdd, setShowAdd] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [error, setError] = useState("");
  const [connecting, setConnecting] = useState(false);

  const connectBank = async () => {
    setConnecting(true);
    setError("");
    try {
      const { data, error: fnError } = await supabase.functions.invoke("pluggy-connect-token");
      if (fnError) throw fnError;
      const pluggyConnect = new PluggyConnect({
        connectToken: data.connectToken,
        includeSandbox: false,
        onSuccess: async (itemData) => {
          const { error: insErr } = await supabase
            .from("bank_items")
            .insert({ id: itemData.item.id, institution: itemData.item.connector?.name || "Banco", user_id: userId });
          if (insErr) setError(insErr.message);
          setConnecting(false);
        },
        onError: (err) => {
          setError(err.message || "Erro ao conectar o banco.");
          setConnecting(false);
        },
        onClose: () => setConnecting(false),
      });
      pluggyConnect.init();
    } catch (e) {
      setError(e.message || "Não consegui iniciar a conexão com o banco.");
      setConnecting(false);
    }
  };

  // Carga inicial + garante categorias padrão na primeira vez
  useEffect(() => {
    (async () => {
      try {
        let { data: cats, error: catErr } = await supabase.from("categories").select("*").order("name");
        if (catErr) throw catErr;
        if (!cats || cats.length === 0) {
          const seed = DEFAULT_CATEGORIES.map((c) => ({ ...c, user_id: userId }));
          const { data: inserted, error: insErr } = await supabase.from("categories").insert(seed).select();
          if (insErr) throw insErr;
          cats = inserted;
        }
        setCategories(cats.map(mapCategory));

        const { data: txs, error: txErr } = await supabase.from("transactions").select("*").order("data", { ascending: false });
        if (txErr) throw txErr;
        setTransactions((txs || []).map(mapTransaction));

        const { data: rls, error: rlsErr } = await supabase.from("rules").select("*");
        if (rlsErr) throw rlsErr;
        setRules((rls || []).map(mapRule));

        const { data: settingsRow } = await supabase.from("settings").select("*").eq("key", "fechamentos").maybeSingle();
        if (settingsRow) setFechamentos(settingsRow.value);
      } catch (e) {
        setError(e.message || "Erro ao carregar seus dados.");
      } finally {
        setLoaded(true);
      }
    })();
  }, [userId]);

  // Tempo real: qualquer mudança nas transações (inclusive de outro dispositivo) atualiza a tela na hora
  useEffect(() => {
    const channel = supabase
      .channel("transactions-realtime")
      .on("postgres_changes", { event: "*", schema: "public", table: "transactions" }, (payload) => {
        setTransactions((prev) => {
          if (payload.eventType === "DELETE") return prev.filter((t) => t.id !== payload.old.id);
          const row = mapTransaction(payload.new);
          const exists = prev.some((t) => t.id === row.id);
          return exists ? prev.map((t) => (t.id === row.id ? row : t)) : [row, ...prev];
        });
      })
      .subscribe();
    return () => supabase.removeChannel(channel);
  }, []);

  const currentMonth = monthKey(cursor);
  const monthTx = useMemo(
    () => transactions.filter((t) => competencia(t.data, t.fonte, fechamentos) === currentMonth),
    [transactions, currentMonth, fechamentos]
  );
  const categorizadas = monthTx.filter((t) => t.status === "categorizado");
  const pendentes = useMemo(() => transactions.filter((t) => t.status === "pendente"), [transactions]);

  const spentByCategory = useMemo(() => {
    const map = {};
    categorizadas.forEach((t) => { map[t.categoryId] = (map[t.categoryId] || 0) + Number(t.valor); });
    return map;
  }, [categorizadas]);

  const totals = useMemo(() => {
    const out = { essenciais: { planned: 0, spent: 0 }, extras: { planned: 0, spent: 0 } };
    categories.forEach((c) => {
      out[c.group].planned += Number(c.limit);
      out[c.group].spent += spentByCategory[c.id] || 0;
    });
    return out;
  }, [categories, spentByCategory]);

  const addRawTransaction = async ({ data, estabelecimento, valor, fonte }) => {
    const rule = findRule(rules, estabelecimento);
    const row = {
      data, estabelecimento, valor: parseFloat(valor), fonte, user_id: userId,
      status: rule && !rule.alwaysAsk ? "categorizado" : "pendente",
      category_id: rule && !rule.alwaysAsk ? rule.categoryId : null,
      suggested_category_id: rule ? rule.categoryId : null,
    };
    const { data: inserted, error } = await supabase.from("transactions").insert(row).select().single();
    if (error) { setError(error.message); return; }
    setTransactions((prev) => [mapTransaction(inserted), ...prev]);
    setShowAdd(false);
  };

  const resolvePendente = async (id, categoryId, sempre) => {
    const tx = transactions.find((t) => t.id === id);
    if (!tx) return;
    const { error: updErr } = await supabase.from("transactions").update({ status: "categorizado", category_id: categoryId }).eq("id", id);
    if (updErr) { setError(updErr.message); return; }
    setTransactions((prev) => prev.map((t) => (t.id === id ? { ...t, status: "categorizado", categoryId } : t)));

    const keyword = tx.estabelecimento.toLowerCase();
    const { error: ruleErr } = await supabase
      .from("rules")
      .upsert({ keyword, category_id: categoryId, always_ask: !sempre, user_id: userId }, { onConflict: "keyword,user_id" });
    if (ruleErr) { setError(ruleErr.message); return; }
    setRules((prev) => [...prev.filter((r) => r.keyword !== keyword), { keyword, categoryId, alwaysAsk: !sempre }]);
  };

  const removeTransaction = async (id) => {
    const { error } = await supabase.from("transactions").delete().eq("id", id);
    if (error) { setError(error.message); return; }
    setTransactions((prev) => prev.filter((t) => t.id !== id));
  };

  const updateLimit = async (id, value) => {
    const limit = parseFloat(value) || 0;
    setCategories((prev) => prev.map((c) => (c.id === id ? { ...c, limit } : c)));
    const { error } = await supabase.from("categories").update({ limit_value: limit }).eq("id", id);
    if (error) setError(error.message);
  };

  const deleteRule = async (keyword) => {
    const { error } = await supabase.from("rules").delete().eq("keyword", keyword);
    if (error) { setError(error.message); return; }
    setRules((prev) => prev.filter((r) => r.keyword !== keyword));
  };

  const updateFechamentos = async (next) => {
    setFechamentos(next);
    const { error } = await supabase.from("settings").upsert({ key: "fechamentos", value: next, user_id: userId }, { onConflict: "key,user_id" });
    if (error) setError(error.message);
  };

  const logout = () => supabase.auth.signOut();

  if (!loaded) return <div style={{ minHeight: "100vh", background: "#0F1613" }}><Root /></div>;

  return (
    <div className="app">
      <Root />
      <header className="header">
        <div>
          <p className="eyebrow">Fase 1 · Consolidação de gastos</p>
          <h1>Minhas finanças</h1>
        </div>
        <div className="header-actions">
          <button className="icon-btn connect-btn" onClick={connectBank} disabled={connecting} aria-label="Conectar banco">
            <Landmark size={16} /> {connecting ? "Conectando…" : "Conectar banco"}
          </button>
          <button className="icon-btn" onClick={() => setShowSettings(true)} aria-label="Configurações"><Settings size={18} /></button>
          <button className="icon-btn" onClick={logout} aria-label="Sair"><LogOut size={18} /></button>
          <div className="month-nav">
            <button onClick={() => setCursor(new Date(cursor.getFullYear(), cursor.getMonth() - 1, 1))} aria-label="Mês anterior"><ChevronLeft size={18} /></button>
            <span>{monthLabel(cursor)}</span>
            <button onClick={() => setCursor(new Date(cursor.getFullYear(), cursor.getMonth() + 1, 1))} aria-label="Próximo mês"><ChevronRight size={18} /></button>
          </div>
        </div>
      </header>

      {error && <div className="banner banner-error"><AlertTriangle size={16} /> {error}</div>}

      {pendentes.length > 0 && (
        <div className="banner banner-pending">
          <Inbox size={16} />
          <span>{pendentes.length} gasto{pendentes.length > 1 ? "s" : ""} pendente{pendentes.length > 1 ? "s" : ""} de categorização, somando {currency(pendentes.reduce((s, t) => s + Number(t.valor), 0))}</span>
        </div>
      )}

      <div className="ledger-head" style={{ marginBottom: 18 }}>
        <span />
        <button className="add-btn" onClick={() => setShowAdd(true)}><Plus size={16} /> Nova transação</button>
      </div>

      {pendentes.length > 0 && (
        <section className="pendentes">
          <h2 className="section-title"><Inbox size={16} /> Pendentes de categorização</h2>
          <div className="pendentes-list">
            {pendentes.map((t) => (
              <PendenteRow key={t.id} tx={t} categories={categories} onResolve={resolvePendente} onRemove={removeTransaction} />
            ))}
          </div>
        </section>
      )}

      <section className="groups">
        {Object.entries(GROUPS).map(([key, meta]) => (
          <div key={key} className="group-card" style={{ "--group-color": meta.color }}>
            <div className="group-head">
              <span className="dot" />
              <h2>{meta.label}</h2>
              <span className="group-total">{currency(totals[key].spent)} <span className="of">/ {currency(totals[key].planned)}</span></span>
            </div>
            <div className="cat-list">
              {categories.filter((c) => c.group === key).map((c) => {
                const spent = spentByCategory[c.id] || 0;
                const pct = c.limit > 0 ? Math.min(100, (spent / c.limit) * 100) : 0;
                const over = c.limit > 0 && spent > c.limit;
                return (
                  <div key={c.id} className="cat-row">
                    <div className="cat-row-top">
                      <span className="cat-name">{c.name}</span>
                      <span className={"cat-values" + (over ? " over" : "")}>
                        {currency(spent)} <span className="of">/</span>
                        <input className="limit-input" type="number" value={c.limit} onChange={(e) => updateLimit(c.id, e.target.value)} />
                      </span>
                    </div>
                    <div className="cat-bar"><div className="cat-bar-fill" style={{ width: `${pct}%`, background: over ? "var(--warn)" : "var(--group-color)" }} /></div>
                  </div>
                );
              })}
            </div>
          </div>
        ))}
      </section>

      <section className="ledger">
        <h2 className="section-title"><Wallet size={16} /> Lançamentos categorizados do mês</h2>
        {categorizadas.length === 0 ? (
          <p className="empty">Nenhum lançamento categorizado este mês ainda.</p>
        ) : (
          <div className="ledger-list">
            {[...categorizadas].sort((a, b) => b.data.localeCompare(a.data)).map((t) => {
              const cat = categories.find((c) => c.id === t.categoryId);
              return (
                <div key={t.id} className="ledger-row">
                  <span className="ledger-date">{t.data.slice(8, 10)}/{t.data.slice(5, 7)}</span>
                  <span className="ledger-desc">{t.estabelecimento}</span>
                  <span className="ledger-cat">{cat?.name} · {t.fonte}</span>
                  <span className="ledger-amount">{currency(t.valor)}</span>
                  <button className="ledger-remove" onClick={() => removeTransaction(t.id)} aria-label="Remover"><X size={14} /></button>
                </div>
              );
            })}
          </div>
        )}
      </section>

      {showAdd && <AddRawModal fontes={FONTES} onClose={() => setShowAdd(false)} onSave={addRawTransaction} />}
      {showSettings && (
        <SettingsModal fechamentos={fechamentos} setFechamentos={updateFechamentos} rules={rules} categories={categories} onDeleteRule={deleteRule} onClose={() => setShowSettings(false)} />
      )}
    </div>
  );
}

function PendenteRow({ tx, categories, onResolve, onRemove }) {
  const [categoryId, setCategoryId] = useState(tx.suggestedCategoryId || categories[0]?.id);
  const [sempre, setSempre] = useState(!tx.suggestedCategoryId);

  return (
    <div className="pendente-row">
      <div className="pendente-info">
        <span className="pendente-estab">{tx.estabelecimento}</span>
        <span className="of">{tx.data.slice(8, 10)}/{tx.data.slice(5, 7)} · {tx.fonte} · {currency(tx.valor)}</span>
      </div>
      <div className="pendente-actions">
        <select value={categoryId} onChange={(e) => setCategoryId(e.target.value)}>
          {categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
        <label className="checkbox">
          <input type="checkbox" checked={sempre} onChange={(e) => setSempre(e.target.checked)} />
          sempre categorizar assim
        </label>
        <button className="confirm-btn" onClick={() => onResolve(tx.id, categoryId, sempre)}><Check size={14} /></button>
        <button className="ledger-remove" onClick={() => onRemove(tx.id)} aria-label="Remover"><X size={14} /></button>
      </div>
    </div>
  );
}

function AddRawModal({ fontes, onClose, onSave }) {
  const today = new Date().toISOString().slice(0, 10);
  const [data, setData] = useState(today);
  const [estabelecimento, setEstabelecimento] = useState("");
  const [valor, setValor] = useState("");
  const [fonte, setFonte] = useState(fontes[0]);

  const submit = (e) => {
    e.preventDefault();
    if (!estabelecimento || !valor) return;
    onSave({ data, estabelecimento, valor: valor.replace(",", "."), fonte });
  };

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <form className="modal" onClick={(e) => e.stopPropagation()} onSubmit={submit}>
        <div className="modal-head"><h3>Nova transação</h3><button type="button" onClick={onClose}><X size={18} /></button></div>
        <p className="modal-hint">No futuro isso chega sozinho via Pluggy — por enquanto, lance manualmente.</p>
        <label>Data<input type="date" value={data} onChange={(e) => setData(e.target.value)} required /></label>
        <label>Estabelecimento<input type="text" placeholder="Ex: IFOOD, SMARTFIT, COELBA" value={estabelecimento} onChange={(e) => setEstabelecimento(e.target.value)} required /></label>
        <label>Valor (R$)<input type="text" inputMode="decimal" placeholder="0,00" value={valor} onChange={(e) => setValor(e.target.value)} required /></label>
        <label>Fonte
          <select value={fonte} onChange={(e) => setFonte(e.target.value)}>
            {fontes.map((f) => <option key={f} value={f}>{f}</option>)}
          </select>
        </label>
        <button type="submit" className="submit-btn">Adicionar</button>
      </form>
    </div>
  );
}

function SettingsModal({ fechamentos, setFechamentos, rules, categories, onDeleteRule, onClose }) {
  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head"><h3>Configurações</h3><button onClick={onClose}><X size={18} /></button></div>
        <p className="modal-hint">Dia de fechamento da fatura — gastos depois desse dia contam para o mês seguinte.</p>
        <label>Nubank — dia de fechamento
          <input type="number" min="1" max="31" value={fechamentos.Nubank}
            onChange={(e) => setFechamentos({ ...fechamentos, Nubank: parseInt(e.target.value) || 1 })} />
        </label>
        <label>Bradesco — dia de fechamento
          <input type="number" min="1" max="31" value={fechamentos.Bradesco}
            onChange={(e) => setFechamentos({ ...fechamentos, Bradesco: parseInt(e.target.value) || 1 })} />
        </label>
        <p className="modal-hint" style={{ marginTop: 8 }}>Regras aprendidas ({rules.length})</p>
        <div className="rules-list">
          {rules.length === 0 && <p className="empty" style={{ padding: "8px 0" }}>Nenhuma regra ainda — vão surgindo conforme você categoriza pendentes.</p>}
          {rules.map((r) => {
            const cat = categories.find((c) => c.id === r.categoryId);
            return (
              <div key={r.keyword} className="rule-row">
                <span>{r.keyword}</span>
                <span className="of">{cat?.name}{r.alwaysAsk ? " · sempre confirmar" : ""}</span>
                <button className="ledger-remove" onClick={() => onDeleteRule(r.keyword)} aria-label="Apagar regra"><X size={13} /></button>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

function Root() {
  return (
    <style>{`
      :root {
        --bg: #0F1613; --surface: #172019; --surface-2: #1D2721;
        --text: #EDEBE4; --muted: #8B9389; --ok: #5FA377; --warn: #C1613D; --gold: #C9A24B; --line: #2A342D;
      }
      body { margin: 0; background: var(--bg); }
      .app { background: var(--bg); color: var(--text); font-family: 'IBM Plex Sans', Inter, sans-serif; padding: 28px 20px 60px; max-width: 720px; margin: 0 auto; min-height: 100vh; }
      .header { display: flex; justify-content: space-between; align-items: flex-end; margin-bottom: 18px; flex-wrap: wrap; gap: 12px; }
      .eyebrow { font-size: 11px; letter-spacing: 0.12em; text-transform: uppercase; color: var(--muted); margin: 0 0 4px; }
      h1 { font-family: 'Fraunces', Georgia, serif; font-size: 28px; margin: 0; font-weight: 600; }
      .header-actions { display: flex; align-items: center; gap: 10px; }
      .icon-btn { background: var(--surface); border: 1px solid var(--line); color: var(--text); border-radius: 999px; padding: 8px; display: flex; cursor: pointer; }
      .connect-btn { width: auto; gap: 6px; padding: 8px 14px; font-size: 12px; font-weight: 600; color: var(--gold); border-color: var(--gold); }
      .connect-btn:disabled { opacity: 0.6; cursor: default; }
      .month-nav { display: flex; align-items: center; gap: 10px; background: var(--surface); border: 1px solid var(--line); border-radius: 999px; padding: 6px 14px; font-size: 14px; }
      .month-nav button { background: none; border: none; color: var(--text); cursor: pointer; display: flex; padding: 2px; }
      .banner { display: flex; align-items: center; gap: 8px; padding: 10px 14px; border-radius: 8px; font-size: 13px; margin-bottom: 12px; }
      .banner-error { background: rgba(193,97,61,0.15); border: 1px solid var(--warn); color: var(--warn); }
      .banner-pending { background: rgba(201,162,75,0.14); border: 1px solid var(--gold); color: var(--gold); }
      .ledger-head { display: flex; justify-content: flex-end; align-items: center; }
      .add-btn { display: flex; align-items: center; gap: 6px; background: var(--ok); color: #0F1613; border: none; border-radius: 999px; padding: 8px 16px; font-size: 13px; font-weight: 600; cursor: pointer; }
      .section-title { display: flex; align-items: center; gap: 8px; font-family: 'Fraunces', Georgia, serif; font-size: 17px; font-weight: 600; margin: 0 0 14px; }
      .pendentes { background: var(--surface); border: 1px solid var(--gold); border-radius: 14px; padding: 18px; margin-bottom: 20px; }
      .pendentes-list { display: grid; gap: 12px; }
      .pendente-row { display: grid; gap: 8px; padding: 10px 0; border-bottom: 1px dashed var(--line); }
      .pendente-row:last-child { border-bottom: none; }
      .pendente-info { display: flex; flex-direction: column; gap: 2px; }
      .pendente-estab { font-weight: 600; }
      .pendente-actions { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; }
      .pendente-actions select { background: var(--surface-2); border: 1px solid var(--line); border-radius: 8px; padding: 6px 8px; color: var(--text); font-size: 13px; }
      .checkbox { display: flex; align-items: center; gap: 5px; font-size: 12px; color: var(--muted); }
      .confirm-btn { background: var(--ok); border: none; border-radius: 999px; padding: 6px; display: flex; cursor: pointer; color: #0F1613; }
      .groups { display: grid; gap: 14px; margin-bottom: 24px; }
      .group-card { background: var(--surface); border: 1px solid var(--line); border-radius: 14px; padding: 18px; }
      .group-head { display: flex; align-items: center; gap: 8px; margin-bottom: 14px; }
      .group-head .dot { width: 9px; height: 9px; border-radius: 50%; background: var(--group-color); }
      .group-head h2 { font-family: 'Fraunces', Georgia, serif; font-size: 16px; font-weight: 600; margin: 0; flex: 1; }
      .group-total { font-family: 'IBM Plex Mono', monospace; font-size: 13px; }
      .of { color: var(--muted); font-weight: 400; }
      .cat-list { display: grid; gap: 12px; }
      .cat-row-top { display: flex; justify-content: space-between; align-items: center; font-size: 13px; margin-bottom: 6px; }
      .cat-values { font-family: 'IBM Plex Mono', monospace; display: flex; align-items: center; gap: 4px; }
      .cat-values.over { color: var(--warn); }
      .limit-input { width: 60px; background: transparent; border: none; border-bottom: 1px dashed var(--line); color: var(--muted); font-family: 'IBM Plex Mono', monospace; font-size: 12px; padding: 0 2px; }
      .limit-input:focus { outline: none; border-bottom-color: var(--ok); color: var(--text); }
      .cat-bar { height: 6px; border-radius: 3px; background: var(--surface-2); overflow: hidden; }
      .cat-bar-fill { height: 100%; border-radius: 3px; transition: width .3s; }
      .empty { color: var(--muted); font-size: 14px; padding: 20px 0; text-align: center; }
      .ledger-list { display: grid; }
      .ledger-row { display: grid; grid-template-columns: 40px 1fr auto auto 24px; align-items: center; gap: 8px; padding: 10px 0; border-bottom: 1px dashed var(--line); font-size: 13px; }
      .ledger-date { color: var(--muted); font-family: 'IBM Plex Mono', monospace; }
      .ledger-cat { color: var(--muted); font-size: 12px; }
      .ledger-amount { font-family: 'IBM Plex Mono', monospace; font-weight: 600; }
      .ledger-remove { background: none; border: none; color: var(--muted); cursor: pointer; display: flex; }
      .ledger-remove:hover { color: var(--warn); }
      .modal-backdrop { position: fixed; inset: 0; background: rgba(0,0,0,0.6); display: flex; align-items: center; justify-content: center; padding: 20px; z-index: 50; }
      .modal { background: var(--surface); border: 1px solid var(--line); border-radius: 14px; padding: 22px; width: 100%; max-width: 380px; display: grid; gap: 14px; max-height: 85vh; overflow-y: auto; }
      .modal-head { display: flex; justify-content: space-between; align-items: center; }
      .modal-head h3 { font-family: 'Fraunces', Georgia, serif; margin: 0; font-size: 18px; }
      .modal-head button { background: none; border: none; color: var(--muted); cursor: pointer; }
      .modal-hint { font-size: 12px; color: var(--muted); margin: 0; }
      .modal label { display: grid; gap: 6px; font-size: 12px; color: var(--muted); }
      .modal input, .modal select { background: var(--surface-2); border: 1px solid var(--line); border-radius: 8px; padding: 9px 10px; color: var(--text); font-size: 14px; font-family: inherit; }
      .submit-btn { background: var(--gold); color: #0F1613; border: none; border-radius: 999px; padding: 10px; font-weight: 600; cursor: pointer; margin-top: 4px; }
      .rules-list { display: grid; gap: 6px; max-height: 160px; overflow-y: auto; }
      .rule-row { display: flex; align-items: center; justify-content: space-between; gap: 8px; font-size: 12px; padding: 4px 0; border-bottom: 1px dashed var(--line); }
      @media (max-width: 420px) {
        .ledger-row { grid-template-columns: 34px 1fr auto 20px; }
        .ledger-cat { display: none; }
      }
    `}</style>
  );
}
