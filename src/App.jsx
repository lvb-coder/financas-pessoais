import { useState, useEffect, useMemo } from "react";
import { Plus, Settings, X, AlertTriangle, ChevronLeft, ChevronRight, Inbox, Check, LogOut, Landmark, RefreshCw, TrendingUp } from "lucide-react";
import { PluggyConnect } from "pluggy-connect-sdk";
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

const TIPOS = ["Débito", "Crédito"];
const BANCOS = ["Nubank", "Bradesco", "Itaú"];

const currency = (v) =>
  (Number(v) || 0).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

const monthKey = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
const monthLabel = (d) =>
  d.toLocaleDateString("pt-BR", { month: "long", year: "numeric" }).replace(/^\w/, (c) => c.toUpperCase());

function competencia(dateStr, tipo, banco, fechamentos) {
  const [y, m, d] = dateStr.split("-").map(Number);
  if (tipo === "Débito") return `${y}-${String(m).padStart(2, "0")}`;
  const closing = fechamentos[banco] || 1;
  if (d > closing) {
    const next = new Date(y, m, 1);
    return monthKey(next);
  }
  return `${y}-${String(m).padStart(2, "0")}`;
}

function matchPattern(patterns, estabelecimento) {
  const alvo = (estabelecimento || "").toLowerCase();
  return patterns.find((p) => alvo.includes(p.pattern));
}

function parseParcela(estabelecimento) {
  const m = (estabelecimento || "").trim().match(/(\d{1,2})\s*\/\s*(\d{1,2})\s*$/);
  if (m) return { atual: parseInt(m[1], 10), total: parseInt(m[2], 10) };
  return { atual: 1, total: 1 };
}

function stripParcela(estabelecimento) {
  return (estabelecimento || "").replace(/\s*\d{1,2}\s*\/\s*\d{1,2}\s*$/, "").trim();
}

// -- Mapeadores entre linhas do Supabase (snake_case) e o formato usado na UI --
const mapCategory = (row) => ({ id: row.id, name: row.name, group: row.group, limit: row.limit_value });
const mapTransaction = (row) => ({
  id: row.id, data: row.data, estabelecimento: row.estabelecimento, valor: Number(row.valor),
  tipo: row.tipo, banco: row.banco, status: row.status, categoryId: row.category_id, merchantId: row.merchant_id,
});
const mapMerchant = (row) => ({ id: row.id, name: row.name, categoryId: row.category_id });
const mapPattern = (row) => ({ id: row.id, pattern: row.pattern, merchantId: row.merchant_id });

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
  const [merchants, setMerchants] = useState([]);
  const [patterns, setPatterns] = useState([]);
  const [fechamentos, setFechamentos] = useState({ Nubank: 3, Bradesco: 8 });
  const [cursor, setCursor] = useState(new Date());
  const [showAdd, setShowAdd] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [error, setError] = useState("");
  const [connecting, setConnecting] = useState(false);
  const [incomes, setIncomes] = useState([]);
  const [syncing, setSyncing] = useState(false);
  const [syncMsg, setSyncMsg] = useState("");
  const [view, setView] = useState("transacoes");

  const syncBank = async () => {
    setSyncing(true);
    setSyncMsg("");
    setError("");
    try {
      const { data, error: fnError } = await supabase.functions.invoke("pluggy-sync");
      if (fnError) throw fnError;
      setSyncMsg(`${data.novasDespesas} gasto(s) novo(s), ${data.pendentes} pendente(s), ${data.novasRendas} recebimento(s) novo(s). Debug: ${JSON.stringify(data.debug)}`);
      const { data: inc } = await supabase.from("incomes").select("*").order("data", { ascending: false });
      setIncomes(inc || []);
    } catch (e) {
      setError(e.message || "Não consegui sincronizar agora.");
    } finally {
      setSyncing(false);
    }
  };

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

        const { data: merch, error: merchErr } = await supabase.from("merchants").select("*").order("name");
        if (merchErr) throw merchErr;
        setMerchants((merch || []).map(mapMerchant));

        const { data: pats, error: patsErr } = await supabase.from("merchant_patterns").select("*");
        if (patsErr) throw patsErr;
        setPatterns((pats || []).map(mapPattern));

        const { data: settingsRow } = await supabase.from("settings").select("*").eq("key", "fechamentos").maybeSingle();
        if (settingsRow) setFechamentos(settingsRow.value);

        const { data: inc } = await supabase.from("incomes").select("*").order("data", { ascending: false });
        setIncomes(inc || []);
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
    () => transactions.filter((t) => competencia(t.data, t.tipo, t.banco, fechamentos) === currentMonth),
    [transactions, currentMonth, fechamentos]
  );
  const categorizadas = monthTx.filter((t) => t.status === "categorizado");
  const pendingCount = monthTx.filter((t) => t.status !== "categorizado").length;

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

  const monthIncomes = useMemo(
    () => incomes.filter((i) => i.data.slice(0, 7) === currentMonth),
    [incomes, currentMonth]
  );
  const totalIncome = monthIncomes.reduce((s, i) => s + Number(i.valor), 0);

  const addRawTransaction = async ({ data, estabelecimento, valor, tipo, banco }) => {
    const match = matchPattern(patterns, estabelecimento);
    let status = "pendente_estabelecimento", categoryId = null, merchantId = null;
    if (match) {
      const merch = merchants.find((m) => m.id === match.merchantId);
      merchantId = merch?.id || null;
      if (merch?.categoryId) { status = "categorizado"; categoryId = merch.categoryId; }
      else status = "pendente_categoria";
    }
    const row = { data, estabelecimento, valor: parseFloat(valor), tipo, banco, user_id: userId, status, category_id: categoryId, merchant_id: merchantId };
    const { data: inserted, error } = await supabase.from("transactions").insert(row).select().single();
    if (error) { setError(error.message); return; }
    setTransactions((prev) => [mapTransaction(inserted), ...prev]);
    setShowAdd(false);
  };

  // Aprova uma transação: identifica o estabelecimento e já define a categoria, tudo de uma vez
  const resolveApproval = async (tx, { merchantName, categoryId }) => {
    const name = merchantName.trim();
    if (!name || !categoryId) return;
    const pattern = stripParcela(tx.estabelecimento).toLowerCase();
    if (!pattern) return;

    const { data: merchant, error: merchErr } = await supabase
      .from("merchants")
      .upsert({ name, category_id: categoryId, user_id: userId }, { onConflict: "name,user_id" })
      .select()
      .single();
    if (merchErr) { setError(merchErr.message); return; }
    setMerchants((prev) => [...prev.filter((m) => m.id !== merchant.id), mapMerchant(merchant)]);

    const { error: patErr } = await supabase
      .from("merchant_patterns")
      .upsert({ pattern, merchant_id: merchant.id, user_id: userId }, { onConflict: "pattern,user_id" });
    if (patErr) { setError(patErr.message); return; }
    setPatterns((prev) => [...prev.filter((p) => p.pattern !== pattern), { pattern, merchantId: merchant.id }]);

    // resolve todos os pendentes que batem com o padrão (outras parcelas, outras variações)
    const { error: bulkErr1 } = await supabase
      .from("transactions")
      .update({ status: "categorizado", category_id: categoryId, merchant_id: merchant.id })
      .neq("status", "categorizado")
      .ilike("estabelecimento", `%${pattern}%`);
    if (bulkErr1) { setError(bulkErr1.message); return; }

    // resolve também outros pendentes já linkados a esse estabelecimento por um padrão diferente
    const { error: bulkErr2 } = await supabase
      .from("transactions")
      .update({ status: "categorizado", category_id: categoryId })
      .eq("status", "pendente_categoria")
      .eq("merchant_id", merchant.id);
    if (bulkErr2) { setError(bulkErr2.message); return; }

    setTransactions((prev) => prev.map((t) => {
      if (t.status === "categorizado") return t;
      if (t.estabelecimento.toLowerCase().includes(pattern) || t.merchantId === merchant.id) {
        return { ...t, status: "categorizado", categoryId, merchantId: merchant.id };
      }
      return t;
    }));
  };

  // Corrige a categoria de um lançamento já categorizado (só esse, não mexe no estabelecimento)
  const updateTransactionCategory = async (id, categoryId) => {
    const { error } = await supabase.from("transactions").update({ category_id: categoryId }).eq("id", id);
    if (error) { setError(error.message); return; }
    setTransactions((prev) => prev.map((t) => (t.id === id ? { ...t, categoryId } : t)));
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

  const deletePattern = async (pattern) => {
    const { error } = await supabase.from("merchant_patterns").delete().eq("pattern", pattern);
    if (error) { setError(error.message); return; }
    setPatterns((prev) => prev.filter((p) => p.pattern !== pattern));
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
          <button className="icon-btn connect-btn" onClick={syncBank} disabled={syncing} aria-label="Sincronizar">
            <RefreshCw size={16} className={syncing ? "spin" : ""} /> {syncing ? "Sincronizando…" : "Sincronizar"}
          </button>
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

      <div className="view-tabs">
        <button className={"tab-btn" + (view === "transacoes" ? " active" : "")} onClick={() => setView("transacoes")}>Transações</button>
        <button className={"tab-btn" + (view === "resumo" ? " active" : "")} onClick={() => setView("resumo")}>Resumo por categoria</button>
      </div>

      {error && <div className="banner banner-error"><AlertTriangle size={16} /> {error}</div>}

      {pendingCount > 0 && (
        <div className="banner banner-pending">
          <Inbox size={16} />
          <span>{pendingCount} lançamento(s) esperando aprovação neste mês.</span>
        </div>
      )}

      {syncMsg && <div className="banner banner-pending"><RefreshCw size={16} /> {syncMsg}</div>}

      {incomes.length > 0 && (
        <section className="income-card">
          <div className="group-head">
            <TrendingUp size={16} color="var(--ok)" />
            <h2>Renda do mês</h2>
            <span className="group-total" style={{ color: "var(--ok)" }}>{currency(totalIncome)}</span>
          </div>
          {monthIncomes.map((i) => (
            <div key={i.id} className="ledger-row" style={{ gridTemplateColumns: "40px 1fr auto" }}>
              <span className="ledger-date">{i.data.slice(8, 10)}/{i.data.slice(5, 7)}</span>
              <span className="ledger-desc">{i.descricao}</span>
              <span className="ledger-amount" style={{ color: "var(--ok)" }}>{currency(i.valor)}</span>
            </div>
          ))}
        </section>
      )}

      <div className="ledger-head" style={{ marginBottom: 18 }}>
        <span />
        <button className="add-btn" onClick={() => setShowAdd(true)}><Plus size={16} /> Nova transação</button>
      </div>

      {view === "transacoes" && (
        <>
          <datalist id="merchants-list">
            {merchants.map((m) => <option key={m.id} value={m.name} />)}
          </datalist>
          {[
            { banco: "Nubank", tipo: "Crédito" },
            { banco: "Bradesco", tipo: "Crédito" },
          ].map((g) => (
            <BankGroupSection
              key={g.banco + g.tipo}
              banco={g.banco}
              tipo={g.tipo}
              transactions={monthTx}
              categories={categories}
              merchants={merchants}
              onApprove={resolveApproval}
              onIgnore={removeTransaction}
              onCategoryChange={updateTransactionCategory}
              onRemove={removeTransaction}
            />
          ))}
        </>
      )}

      {view === "resumo" && (
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
      )}

      {showAdd && <AddRawModal tipos={TIPOS} bancos={BANCOS} onClose={() => setShowAdd(false)} onSave={addRawTransaction} />}
      {showSettings && (
        <SettingsModal fechamentos={fechamentos} setFechamentos={updateFechamentos} merchants={merchants} patterns={patterns} categories={categories} onDeletePattern={deletePattern} onClose={() => setShowSettings(false)} />
      )}
    </div>
  );
}

function BankGroupSection({ banco, tipo, transactions, categories, merchants, onApprove, onIgnore, onCategoryChange, onRemove }) {
  const list = transactions.filter((t) => t.banco === banco && t.tipo === tipo).sort((a, b) => b.data.localeCompare(a.data));
  if (list.length === 0) return null;
  const totalMes = list.reduce((s, t) => s + (t.status === "categorizado" ? Number(t.valor) : 0), 0);
  const pendCount = list.filter((t) => t.status !== "categorizado").length;

  return (
    <section className="bank-group">
      <div className="group-head">
        <h2>{banco} · {tipo}</h2>
        <span className="group-total">
          {currency(totalMes)}
          {pendCount > 0 && <span className="of"> · {pendCount} pendente(s)</span>}
        </span>
      </div>
      <div className="tx-list">
        <div className="tx-row tx-row-head">
          <span>Data</span><span>Estabelecimento</span><span>Categoria</span><span>Parc.</span><span>Total</span><span>Mês</span><span />
        </div>
        {list.map((t) =>
          t.status === "categorizado" ? (
            <DisplayRow key={t.id} tx={t} categories={categories} merchants={merchants} onCategoryChange={onCategoryChange} onRemove={onRemove} />
          ) : (
            <ApprovalRow key={t.id} tx={t} categories={categories} merchants={merchants} onApprove={onApprove} onIgnore={onIgnore} />
          )
        )}
      </div>
    </section>
  );
}

function DisplayRow({ tx, categories, merchants, onCategoryChange, onRemove }) {
  const merch = merchants.find((m) => m.id === tx.merchantId);
  const parcela = parseParcela(tx.estabelecimento);
  return (
    <div className="tx-row">
      <span className="tx-date">{tx.data.slice(8, 10)}/{tx.data.slice(5, 7)}</span>
      <span className="tx-desc" title={tx.estabelecimento}>{merch?.name || tx.estabelecimento}</span>
      <select className="ledger-cat-select" value={tx.categoryId || ""} onChange={(e) => onCategoryChange(tx.id, e.target.value)}>
        {categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
      </select>
      <span className="tx-parcela">{parcela.atual}/{parcela.total}</span>
      <span className="tx-valor">{currency(tx.valor * parcela.total)}</span>
      <span className="tx-valor tx-valor-mes">{currency(tx.valor)}</span>
      <button className="ledger-remove" onClick={() => onRemove(tx.id)} aria-label="Remover"><X size={14} /></button>
    </div>
  );
}

function ApprovalRow({ tx, categories, merchants, onApprove, onIgnore }) {
  const [merchantName, setMerchantName] = useState("");
  const [categoryId, setCategoryId] = useState(categories[0]?.id);
  const parcela = parseParcela(tx.estabelecimento);

  useEffect(() => {
    const alvo = tx.estabelecimento.toLowerCase();
    const guess = merchants.find((m) => alvo.includes(m.name.toLowerCase()));
    if (guess) {
      setMerchantName(guess.name);
      if (guess.categoryId) setCategoryId(guess.categoryId);
    } else {
      setMerchantName(stripParcela(tx.estabelecimento));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleMerchantChange = (value) => {
    setMerchantName(value);
    const match = merchants.find((m) => m.name.toLowerCase() === value.trim().toLowerCase());
    if (match?.categoryId) setCategoryId(match.categoryId);
  };

  return (
    <div className="tx-row tx-row-pending">
      <span className="tx-date">{tx.data.slice(8, 10)}/{tx.data.slice(5, 7)}</span>
      <input className="tx-input" list="merchants-list" placeholder="Estabelecimento" value={merchantName} onChange={(e) => handleMerchantChange(e.target.value)} />
      <select className="ledger-cat-select" value={categoryId} onChange={(e) => setCategoryId(e.target.value)}>
        {categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
      </select>
      <span className="tx-parcela">{parcela.atual}/{parcela.total}</span>
      <span className="tx-valor">{currency(tx.valor * parcela.total)}</span>
      <span className="tx-valor tx-valor-mes">{currency(tx.valor)}</span>
      <button className="confirm-btn" disabled={!merchantName.trim()} onClick={() => onApprove(tx, { merchantName, categoryId })}><Check size={14} /></button>
      <button className="ledger-remove" onClick={() => onIgnore(tx.id)} aria-label="Ignorar"><X size={14} /></button>
    </div>
  );
}

function AddRawModal({ tipos, bancos, onClose, onSave }) {
  const today = new Date().toISOString().slice(0, 10);
  const [data, setData] = useState(today);
  const [estabelecimento, setEstabelecimento] = useState("");
  const [valor, setValor] = useState("");
  const [tipo, setTipo] = useState(tipos[0]);
  const [banco, setBanco] = useState(bancos[0]);

  const submit = (e) => {
    e.preventDefault();
    if (!estabelecimento || !valor) return;
    onSave({ data, estabelecimento, valor: valor.replace(",", "."), tipo, banco });
  };

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <form className="modal" onClick={(e) => e.stopPropagation()} onSubmit={submit}>
        <div className="modal-head"><h3>Nova transação</h3><button type="button" onClick={onClose}><X size={18} /></button></div>
        <p className="modal-hint">No futuro isso chega sozinho via Pluggy — por enquanto, lance manualmente.</p>
        <label>Data<input type="date" value={data} onChange={(e) => setData(e.target.value)} required /></label>
        <label>Estabelecimento<input type="text" placeholder="Ex: IFOOD, SMARTFIT, COELBA" value={estabelecimento} onChange={(e) => setEstabelecimento(e.target.value)} required /></label>
        <label>Valor (R$)<input type="text" inputMode="decimal" placeholder="0,00" value={valor} onChange={(e) => setValor(e.target.value)} required /></label>
        <label>Tipo
          <select value={tipo} onChange={(e) => setTipo(e.target.value)}>
            {tipos.map((t) => <option key={t} value={t}>{t}</option>)}
          </select>
        </label>
        <label>Banco
          <select value={banco} onChange={(e) => setBanco(e.target.value)}>
            {bancos.map((b) => <option key={b} value={b}>{b}</option>)}
          </select>
        </label>
        <button type="submit" className="submit-btn">Adicionar</button>
      </form>
    </div>
  );
}

function SettingsModal({ fechamentos, setFechamentos, merchants, patterns, categories, onDeletePattern, onClose }) {
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
        <p className="modal-hint" style={{ marginTop: 8 }}>Estabelecimentos conhecidos ({merchants.length})</p>
        <div className="rules-list">
          {merchants.length === 0 && <p className="empty" style={{ padding: "8px 0" }}>Nenhum ainda — vão surgindo conforme você categoriza pendentes.</p>}
          {merchants.map((m) => {
            const cat = categories.find((c) => c.id === m.categoryId);
            const mPatterns = patterns.filter((p) => p.merchantId === m.id);
            return (
              <div key={m.id} style={{ marginBottom: 8 }}>
                <div className="rule-row">
                  <strong>{m.name}</strong>
                  <span className="of">{cat?.name}</span>
                </div>
                {mPatterns.map((p) => (
                  <div key={p.pattern} className="rule-row" style={{ paddingLeft: 10 }}>
                    <span className="of">↳ "{p.pattern}"</span>
                    <button className="ledger-remove" onClick={() => onDeletePattern(p.pattern)} aria-label="Apagar padrão"><X size={13} /></button>
                  </div>
                ))}
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
      .spin { animation: spin 1s linear infinite; }
      @keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }
      .income-card { background: var(--surface); border: 1px solid var(--ok); border-radius: 14px; padding: 18px; margin-bottom: 20px; }
      .month-nav { display: flex; align-items: center; gap: 10px; background: var(--surface); border: 1px solid var(--line); border-radius: 999px; padding: 6px 14px; font-size: 14px; }
      .month-nav button { background: none; border: none; color: var(--text); cursor: pointer; display: flex; padding: 2px; }
      .banner { display: flex; align-items: center; gap: 8px; padding: 10px 14px; border-radius: 8px; font-size: 13px; margin-bottom: 12px; }
      .banner-error { background: rgba(193,97,61,0.15); border: 1px solid var(--warn); color: var(--warn); }
      .banner-pending { background: rgba(201,162,75,0.14); border: 1px solid var(--gold); color: var(--gold); }
      .ledger-head { display: flex; justify-content: flex-end; align-items: center; }
      .add-btn { display: flex; align-items: center; gap: 6px; background: var(--ok); color: #0F1613; border: none; border-radius: 999px; padding: 8px 16px; font-size: 13px; font-weight: 600; cursor: pointer; }
      .section-title { display: flex; align-items: center; gap: 8px; font-family: 'Fraunces', Georgia, serif; font-size: 17px; font-weight: 600; margin: 0 0 14px; }
      .view-tabs { display: flex; gap: 8px; margin-bottom: 18px; }
      .tab-btn { background: var(--surface); border: 1px solid var(--line); color: var(--muted); border-radius: 999px; padding: 8px 16px; font-size: 13px; cursor: pointer; }
      .tab-btn.active { background: var(--surface-2); color: var(--text); border-color: var(--gold); font-weight: 600; }
      .checkbox { display: flex; align-items: center; gap: 5px; font-size: 12px; color: var(--muted); }
      .confirm-btn { background: var(--ok); border: none; border-radius: 999px; padding: 6px; display: flex; cursor: pointer; color: #0F1613; }
      .confirm-btn:disabled { opacity: 0.5; cursor: default; }
      .bank-group { background: var(--surface); border: 1px solid var(--line); border-radius: 14px; padding: 18px; margin-bottom: 20px; overflow-x: auto; }
      .tx-list { min-width: 640px; }
      .tx-row { display: grid; grid-template-columns: 52px 1.6fr 1fr 46px 90px 90px 24px; align-items: center; gap: 8px; padding: 8px 0; border-bottom: 1px dashed var(--line); font-size: 12px; }
      .tx-row:last-child { border-bottom: none; }
      .tx-row-head { color: var(--muted); font-size: 10px; text-transform: uppercase; letter-spacing: 0.05em; padding-bottom: 6px; }
      .tx-row-pending { background: rgba(201,162,75,0.06); border-radius: 8px; }
      .tx-date { color: var(--muted); font-family: 'IBM Plex Mono', monospace; }
      .tx-desc { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
      .tx-input { background: var(--surface-2); border: 1px solid var(--line); border-radius: 6px; padding: 5px 7px; color: var(--text); font-size: 12px; font-family: inherit; width: 100%; box-sizing: border-box; }
      .tx-parcela { color: var(--muted); font-family: 'IBM Plex Mono', monospace; text-align: center; }
      .tx-valor { font-family: 'IBM Plex Mono', monospace; text-align: right; }
      .tx-valor-mes { font-weight: 600; }
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
      .ledger-row { display: grid; grid-template-columns: 40px 1fr auto; align-items: center; gap: 8px; padding: 10px 0; border-bottom: 1px dashed var(--line); font-size: 13px; }
      .ledger-date { color: var(--muted); font-family: 'IBM Plex Mono', monospace; }
      .ledger-cat-select { background: var(--surface-2); border: 1px solid var(--line); border-radius: 6px; padding: 4px 6px; color: var(--muted); font-size: 11px; font-family: inherit; max-width: 120px; }
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
    `}</style>
  );
}
