import { useState, useEffect, useMemo } from "react";
import { Plus, Settings, X, AlertTriangle, ChevronLeft, ChevronRight, Inbox, Check, LogOut, Landmark, RefreshCw, RotateCcw } from "lucide-react";
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

function competencia(tx, fechamentosFatura) {
  if (tx.competenciaOverride) return tx.competenciaOverride;
  if (tx.tipo === "Débito") return tx.data.slice(0, 7);
  const closings = fechamentosFatura
    .filter((f) => f.banco === tx.banco)
    .slice()
    .sort((a, b) => a.fechamento.localeCompare(b.fechamento));
  const txDate = new Date(tx.data + "T12:00:00");
  for (const c of closings) {
    if (txDate <= new Date(c.fechamento)) return c.competencia;
  }
  return tx.data.slice(0, 7); // nenhum fechamento futuro cadastrado ainda — usa o mês da própria compra
}

function addMonths(dateStr, n) {
  const [y, m, d] = dateStr.split("-").map(Number);
  const dt = new Date(y, m - 1 + n, 1);
  const lastDay = new Date(dt.getFullYear(), dt.getMonth() + 1, 0).getDate();
  dt.setDate(Math.min(d, lastDay));
  return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, "0")}-${String(dt.getDate()).padStart(2, "0")}`;
}

function nearbyMonths() {
  const now = new Date();
  const list = [];
  for (let i = -1; i <= 3; i++) {
    const d = new Date(now.getFullYear(), now.getMonth() + i, 1);
    list.push(monthKey(d));
  }
  return list;
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
  competenciaOverride: row.competencia_override, projetada: row.projetada,
});
const mapMerchant = (row) => ({ id: row.id, name: row.name, categoryId: row.category_id });
const mapPattern = (row) => ({ id: row.id, pattern: row.pattern, merchantId: row.merchant_id });
const mapFechamento = (row) => ({ id: row.id, banco: row.banco, competencia: row.competencia, fechamento: row.fechamento });

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
  const [fechamentosFatura, setFechamentosFatura] = useState([]);
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
      setSyncMsg(`${data.novasDespesas} gasto(s) novo(s) esperando aprovação, ${data.novasRendas} recebimento(s) novo(s).`);
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

        const { data: fech, error: fechErr } = await supabase.from("fechamentos_fatura").select("*");
        if (fechErr) throw fechErr;
        setFechamentosFatura((fech || []).map(mapFechamento));

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
    () => transactions.filter((t) => competencia(t, fechamentosFatura) === currentMonth),
    [transactions, currentMonth, fechamentosFatura]
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
    const row = { data, estabelecimento, valor: parseFloat(valor), tipo, banco, user_id: userId, status: "pendente_estabelecimento", category_id: null, merchant_id: null };
    const { data: inserted, error } = await supabase.from("transactions").insert(row).select().single();
    if (error) { setError(error.message); return; }
    setTransactions((prev) => [mapTransaction(inserted), ...prev]);
    setShowAdd(false);
  };

  // Aprova uma transação: identifica o estabelecimento e já define a categoria, tudo de uma vez
  const resolveApproval = async (tx, { merchantName, categoryId, competenciaOverride }) => {
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

    // fatura manual (ex: Pix no crédito que não segue o fechamento normal) — só nesta transação
    if (competenciaOverride) {
      const { error: ovrErr } = await supabase.from("transactions").update({ competencia_override: competenciaOverride }).eq("id", tx.id);
      if (ovrErr) { setError(ovrErr.message); return; }
    }

    setTransactions((prev) => prev.map((t) => {
      if (t.status === "categorizado") return t;
      if (t.estabelecimento.toLowerCase().includes(pattern) || t.merchantId === merchant.id) {
        const extra = t.id === tx.id && competenciaOverride ? { competenciaOverride } : {};
        return { ...t, status: "categorizado", categoryId, merchantId: merchant.id, ...extra };
      }
      return t;
    }));

    // gera as parcelas futuras que ainda não existem, se for uma compra parcelada
    const parcela = parseParcela(tx.estabelecimento);
    if (parcela.total > 1) {
      const faltantes = [];
      for (let n = parcela.atual + 1; n <= parcela.total; n++) {
        const jaExiste = transactions.some((t) =>
          t.merchantId === merchant.id && t.banco === tx.banco && t.tipo === tx.tipo &&
          parseParcela(t.estabelecimento).atual === n && parseParcela(t.estabelecimento).total === parcela.total
        );
        if (!jaExiste) faltantes.push(n);
      }
      if (faltantes.length > 0) {
        const rows = faltantes.map((n) => ({
          data: addMonths(tx.data, n - parcela.atual),
          estabelecimento: `${pattern} ${n}/${parcela.total}`,
          valor: tx.valor,
          tipo: tx.tipo,
          banco: tx.banco,
          user_id: userId,
          status: "categorizado",
          category_id: categoryId,
          merchant_id: merchant.id,
          projetada: true,
        }));
        const { data: inseridas, error: projErr } = await supabase.from("transactions").insert(rows).select();
        if (projErr) { setError(projErr.message); return; }
        setTransactions((prev) => [...prev, ...(inseridas || []).map(mapTransaction)]);
      }
    }
  };

  // Devolve um lançamento já aprovado pra fila de aprovação, editável de novo
  const rejectTransaction = async (id) => {
    const { error } = await supabase.from("transactions").update({ status: "pendente_estabelecimento" }).eq("id", id);
    if (error) { setError(error.message); return; }
    setTransactions((prev) => prev.map((t) => (t.id === id ? { ...t, status: "pendente_estabelecimento" } : t)));
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

  const saveFechamento = async ({ banco, competencia: comp, fechamento }) => {
    const { data, error } = await supabase
      .from("fechamentos_fatura")
      .upsert({ banco, competencia: comp, fechamento, user_id: userId }, { onConflict: "banco,competencia,user_id" })
      .select()
      .single();
    if (error) { setError(error.message); return; }
    setFechamentosFatura((prev) => [...prev.filter((f) => !(f.banco === banco && f.competencia === comp)), mapFechamento(data)]);
  };

  const deleteFechamento = async (id) => {
    const { error } = await supabase.from("fechamentos_fatura").delete().eq("id", id);
    if (error) { setError(error.message); return; }
    setFechamentosFatura((prev) => prev.filter((f) => f.id !== id));
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
        <button className={"tab-btn" + (view === "transacoes" ? " active" : "")} onClick={() => setView("transacoes")}>Cartão de Crédito</button>
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
              patterns={patterns}
              fechamentosFatura={fechamentosFatura}
              onApprove={resolveApproval}
              onIgnore={removeTransaction}
              onReject={rejectTransaction}
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
        <SettingsModal fechamentosFatura={fechamentosFatura} onSaveFechamento={saveFechamento} onDeleteFechamento={deleteFechamento} merchants={merchants} patterns={patterns} categories={categories} onDeletePattern={deletePattern} onClose={() => setShowSettings(false)} />
      )}
    </div>
  );
}

function BankGroupSection({ banco, tipo, transactions, categories, merchants, patterns, fechamentosFatura, onApprove, onIgnore, onReject, onRemove }) {
  const list = transactions.filter((t) => t.banco === banco && t.tipo === tipo).sort((a, b) => b.data.localeCompare(a.data));
  if (list.length === 0) return null;

  const pending = list.filter((t) => t.status !== "categorizado");
  const approved = list.filter((t) => t.status === "categorizado");
  const programadas = approved.filter((t) => parseParcela(t.estabelecimento).atual > 1);
  const novas = approved.filter((t) => parseParcela(t.estabelecimento).atual === 1);

  const totalFatura = approved.reduce((s, t) => s + Number(t.valor), 0);
  const totalProgramadas = programadas.reduce((s, t) => s + Number(t.valor), 0);
  const totalNovas = novas.reduce((s, t) => s + Number(t.valor), 0);
  const qtdNovasParceladas = novas.filter((t) => parseParcela(t.estabelecimento).total > 1).length;

  return (
    <section className="bank-group">
      <div className="group-head">
        <h2>{banco} · {tipo}</h2>
        <span className="group-total">
          {currency(totalFatura)}
          {pending.length > 0 && <span className="of"> · {pending.length} pendente(s)</span>}
        </span>
      </div>

      <div className="fatura-summary">
        <span>Total da fatura <strong>{currency(totalFatura)}</strong></span>
        <span>Qtd. transações <strong>{approved.length}</strong></span>
        <span>Novas transações <strong>{currency(totalNovas)}</strong> ({novas.length}, {qtdNovasParceladas} parcelada{qtdNovasParceladas !== 1 ? "s" : ""})</span>
        <span>Parcelas programadas <strong>{currency(totalProgramadas)}</strong> ({programadas.length})</span>
      </div>

      {pending.length > 0 && (
        <div className="tx-list">
          <div className="tx-row tx-row-head">
            <span>Data</span><span>Estabelecimento</span><span>Categoria</span><span>Fatura</span><span>Parc.</span><span>Total</span><span>Mês</span><span /><span />
          </div>
          {pending.map((t) => (
            <ApprovalRow key={t.id} tx={t} categories={categories} merchants={merchants} patterns={patterns} fechamentosFatura={fechamentosFatura} onApprove={onApprove} onIgnore={onIgnore} />
          ))}
        </div>
      )}

      {novas.length > 0 && (
        <>
          <p className="tx-subhead">Novas transações</p>
          <div className="tx-list">
            <div className="tx-row tx-row-head">
              <span>Data</span><span>Estabelecimento</span><span>Categoria</span><span>Fatura</span><span>Parc.</span><span>Total</span><span>Mês</span><span /><span />
            </div>
            {novas.map((t) => (
              <DisplayRow key={t.id} tx={t} categories={categories} merchants={merchants} fechamentosFatura={fechamentosFatura} onReject={onReject} onRemove={onRemove} />
            ))}
          </div>
        </>
      )}

      {programadas.length > 0 && (
        <>
          <p className="tx-subhead">Parcelas programadas</p>
          <div className="tx-list">
            <div className="tx-row tx-row-head">
              <span>Data</span><span>Estabelecimento</span><span>Categoria</span><span>Fatura</span><span>Parc.</span><span>Total</span><span>Mês</span><span /><span />
            </div>
            {programadas.map((t) => (
              <DisplayRow key={t.id} tx={t} categories={categories} merchants={merchants} fechamentosFatura={fechamentosFatura} onReject={onReject} onRemove={onRemove} />
            ))}
          </div>
        </>
      )}
    </section>
  );
}

function DisplayRow({ tx, categories, merchants, fechamentosFatura, onReject, onRemove }) {
  const merch = merchants.find((m) => m.id === tx.merchantId);
  const cat = categories.find((c) => c.id === tx.categoryId);
  const parcela = parseParcela(tx.estabelecimento);
  return (
    <div className="tx-row">
      <span className="tx-date">{tx.data.slice(8, 10)}/{tx.data.slice(5, 7)}</span>
      <span className="tx-desc" title={tx.estabelecimento}>{merch?.name || tx.estabelecimento}</span>
      <span className="tx-desc">{cat?.name || "—"}</span>
      <span className="tx-desc" style={{ fontSize: 11, color: "var(--muted)" }}>
        {tx.projetada ? "projetada" : competencia(tx, fechamentosFatura)}
      </span>
      <span className="tx-parcela">{parcela.atual}/{parcela.total}</span>
      <span className="tx-valor">{currency(tx.valor * parcela.total)}</span>
      <span className="tx-valor tx-valor-mes">{currency(tx.valor)}</span>
      <button className="ledger-remove" onClick={() => onReject(tx.id)} aria-label="Recusar" title="Recusar e editar de novo"><RotateCcw size={14} /></button>
      <button className="ledger-remove" onClick={() => onRemove(tx.id)} aria-label="Excluir" title="Excluir permanentemente"><X size={14} /></button>
    </div>
  );
}

function ApprovalRow({ tx, categories, merchants, patterns, fechamentosFatura, onApprove, onIgnore }) {
  const [merchantName, setMerchantName] = useState("");
  const [categoryId, setCategoryId] = useState(categories[0]?.id);
  const [fatura, setFatura] = useState(competencia(tx, fechamentosFatura));
  const parcela = parseParcela(tx.estabelecimento);
  const faturaAutomatica = competencia(tx, fechamentosFatura);

  useEffect(() => {
    if (tx.merchantId) {
      const m = merchants.find((mm) => mm.id === tx.merchantId);
      if (m) {
        setMerchantName(m.name);
        setCategoryId(tx.categoryId || m.categoryId || categories[0]?.id);
        return;
      }
    }
    const patMatch = matchPattern(patterns, tx.estabelecimento);
    if (patMatch) {
      const m = merchants.find((mm) => mm.id === patMatch.merchantId);
      if (m) {
        setMerchantName(m.name);
        if (m.categoryId) setCategoryId(m.categoryId);
        return;
      }
    }
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
      <select className="ledger-cat-select" value={fatura} onChange={(e) => setFatura(e.target.value)} title="Fatura em que essa transação será lançada">
        {nearbyMonths().map((mk) => <option key={mk} value={mk}>{mk}</option>)}
      </select>
      <span className="tx-parcela">{parcela.atual}/{parcela.total}</span>
      <span className="tx-valor">{currency(tx.valor * parcela.total)}</span>
      <span className="tx-valor tx-valor-mes">{currency(tx.valor)}</span>
      <button
        className="confirm-btn"
        disabled={!merchantName.trim()}
        onClick={() => onApprove(tx, { merchantName, categoryId, competenciaOverride: fatura !== faturaAutomatica ? fatura : null })}
      >
        <Check size={14} />
      </button>
      <button className="ledger-remove" onClick={() => onIgnore(tx.id)} aria-label="Excluir" title="Excluir permanentemente"><X size={14} /></button>
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

function SettingsModal({ fechamentosFatura, onSaveFechamento, onDeleteFechamento, merchants, patterns, categories, onDeletePattern, onClose }) {
  const [banco, setBanco] = useState("Nubank");
  const [competencia, setCompetencia] = useState(monthKey(new Date()));
  const [fechamento, setFechamento] = useState("");

  const submitFechamento = (e) => {
    e.preventDefault();
    if (!fechamento) return;
    onSaveFechamento({ banco, competencia, fechamento: new Date(fechamento).toISOString() });
    setFechamento("");
  };

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head"><h3>Configurações</h3><button onClick={onClose}><X size={18} /></button></div>

        <p className="modal-hint">Cada fatura pode ter uma data de fechamento diferente (por causa de feriados e fins de semana). Cadastre o fechamento de cada mês aqui.</p>
        <form onSubmit={submitFechamento} style={{ display: "grid", gap: 10 }}>
          <label>Banco
            <select value={banco} onChange={(e) => setBanco(e.target.value)}>
              <option value="Nubank">Nubank</option>
              <option value="Bradesco">Bradesco</option>
            </select>
          </label>
          <label>Mês da fatura
            <input type="month" value={competencia} onChange={(e) => setCompetencia(e.target.value)} />
          </label>
          <label>Data do fechamento
            <input type="date" value={fechamento} onChange={(e) => setFechamento(e.target.value)} required />
          </label>
          <button type="submit" className="submit-btn">Salvar fechamento</button>
        </form>

        <p className="modal-hint" style={{ marginTop: 8 }}>Fechamentos cadastrados ({fechamentosFatura.length})</p>
        <div className="rules-list">
          {fechamentosFatura.length === 0 && <p className="empty" style={{ padding: "8px 0" }}>Nenhum ainda.</p>}
          {[...fechamentosFatura].sort((a, b) => b.competencia.localeCompare(a.competencia)).map((f) => (
            <div key={f.id} className="rule-row">
              <span>{f.banco} · {f.competencia}</span>
              <span className="of">{new Date(f.fechamento).toLocaleDateString("pt-BR", { timeZone: "UTC" })}</span>
              <button className="ledger-remove" onClick={() => onDeleteFechamento(f.id)} aria-label="Apagar fechamento"><X size={13} /></button>
            </div>
          ))}
        </div>

        <p className="modal-hint" style={{ marginTop: 8 }}>Estabelecimentos conhecidos ({merchants.length})</p>
        <div className="rules-list">
          {merchants.length === 0 && <p className="empty" style={{ padding: "8px 0" }}>Nenhum ainda — vão surgindo conforme você aprova transações.</p>}
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
      .fatura-summary { display: flex; gap: 18px; flex-wrap: wrap; font-size: 12px; color: var(--muted); margin: 4px 0 14px; padding-bottom: 12px; border-bottom: 1px solid var(--line); }
      .fatura-summary strong { color: var(--text); font-family: 'IBM Plex Mono', monospace; margin-left: 4px; }
      .tx-subhead { font-size: 12px; color: var(--muted); text-transform: uppercase; letter-spacing: 0.05em; margin: 16px 0 6px; }
      .tx-list { min-width: 720px; }
      .tx-row { display: grid; grid-template-columns: 52px 1.4fr 1fr 70px 46px 90px 90px 24px 24px; align-items: center; gap: 6px; padding: 8px 0; border-bottom: 1px dashed var(--line); font-size: 12px; }
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
