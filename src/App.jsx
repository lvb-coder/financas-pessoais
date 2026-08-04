import { useState, useEffect, useMemo } from "react";
import { Plus, Settings, X, AlertTriangle, ChevronLeft, ChevronRight, Inbox, Check, LogOut, Landmark, RefreshCw, RotateCcw, Pencil } from "lucide-react";
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

// Antes de aprovar, ainda não existe fatura definida — mostra a transação no mês real da compra.
// Depois de aprovada, passa a valer a fatura (calculada ou escolhida manualmente).
function displayMonth(tx, fechamentosFatura) {
  if (tx.status !== "categorizado") return tx.data.slice(0, 7);
  return competencia(tx, fechamentosFatura);
}

function addFatura(competenciaStr, n) {
  const [y, m] = competenciaStr.split("-").map(Number);
  const dt = new Date(y, m - 1 + n, 1);
  return monthKey(dt);
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

function titleCase(str) {
  const conectores = new Set(["de", "da", "do", "das", "dos", "e", "no", "na", "nos", "nas"]);
  return (str || "")
    .toLowerCase()
    .split(" ")
    .filter(Boolean)
    .map((w, i) => (i > 0 && conectores.has(w) ? w : w.charAt(0).toUpperCase() + w.slice(1)))
    .join(" ");
}

function stripPixPrefix(name) {
  return (name || "").replace(/^pix no cr[ée]dito\s*-\s*/i, "").trim();
}

// Pix pago no crédito costuma chegar como só o nome da pessoa, sem marcador nenhum de loja/processadora
function looksLikePersonName(text) {
  const t = stripParcela(text).trim();
  if (!t) return false;
  if (/\d/.test(t)) return false;
  if (/[*.]/.test(t)) return false;
  const words = t.split(/\s+/);
  if (words.length < 2) return false;
  const comercial = /\b(ltda|me|eireli|s\.?a\.?|com|pagamentos?|comercio|loja|shop|store|instituicao)\b/i;
  if (comercial.test(t)) return false;
  return true;
}

function matchesSearch(tx, categories, merchants, query) {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  const merch = merchants.find((m) => m.id === tx.merchantId);
  const nome = (merch?.name || tx.estabelecimento).toLowerCase();
  if (nome.includes(q)) return true;
  const qNum = q.replace(",", ".").replace(/[^\d.]/g, "");
  if (qNum) {
    const total = (tx.valor * tx.parcelaTotal).toFixed(2);
    const mensal = tx.valor.toFixed(2);
    if (total.includes(qNum) || mensal.includes(qNum)) return true;
  }
  return false;
}

// Duas transações "parecidas": mesmo estabelecimento + categoria, valor a até R$5 de diferença
function isSimilar(a, b) {
  return a.merchantId && a.merchantId === b.merchantId && a.categoryId === b.categoryId && Math.abs(a.valor - b.valor) <= 5;
}

// Agrupa transações aprovadas (e ainda não revisadas) que parecem duplicadas,
// só entre transações da MESMA fatura (mês).
function findDuplicateGroups(transactions, fechamentosFatura) {
  const candidates = transactions
    .filter((t) => t.status === "categorizado" && !t.duplicateReviewed && t.merchantId)
    .map((t) => ({ ...t, _fatura: competencia(t, fechamentosFatura) }));
  const used = new Set();
  const groups = [];
  for (const t of candidates) {
    if (used.has(t.id)) continue;
    const group = candidates.filter((o) => o._fatura === t._fatura && isSimilar(o, t));
    if (group.length > 1) {
      group.forEach((g) => used.add(g.id));
      groups.push(group.sort((a, b) => b.data.localeCompare(a.data)));
    }
  }
  return groups;
}

// -- Mapeadores entre linhas do Supabase (snake_case) e o formato usado na UI --
const mapCategory = (row) => ({ id: row.id, name: row.name, group: row.group, limit: row.limit_value });
const mapTransaction = (row) => ({
  id: row.id, data: row.data, estabelecimento: row.estabelecimento, valor: Number(row.valor),
  tipo: row.tipo, banco: row.banco, status: row.status, categoryId: row.category_id, merchantId: row.merchant_id,
  competenciaOverride: row.competencia_override, projetada: row.projetada,
  parcelaAtual: row.parcela_atual, parcelaTotal: row.parcela_total, paymentData: row.payment_data,
  duplicateReviewed: row.duplicate_reviewed, origemId: row.origem_id,
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
  const [search, setSearch] = useState("");

  const [syncController, setSyncController] = useState(null);

  const syncBank = async () => {
    setSyncing(true);
    setSyncMsg("");
    setError("");
    const controller = new AbortController();
    setSyncController(controller);
    try {
      const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
      if (!supabaseUrl) throw new Error("VITE_SUPABASE_URL não está configurada nesse ambiente.");
      const { data: sessionData } = await supabase.auth.getSession();
      const token = sessionData.session?.access_token;
      if (!token) throw new Error("Sessão expirada — sai e entra de novo.");
      const res = await fetch(`${supabaseUrl}/functions/v1/pluggy-sync`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          apikey: import.meta.env.VITE_SUPABASE_ANON_KEY,
          "Content-Type": "application/json",
        },
        signal: controller.signal,
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Erro ao sincronizar.");
      setSyncMsg(`${data.novasDespesas} gasto(s) novo(s) esperando aprovação, ${data.novasRendas} recebimento(s) novo(s).`);
      const { data: inc } = await supabase.from("incomes").select("*").order("data", { ascending: false });
      setIncomes(inc || []);
    } catch (e) {
      if (e.name === "AbortError") {
        setSyncMsg("Sincronização cancelada. O que já tinha sido trazido até agora continua salvo — nada foi perdido.");
      } else {
        setError(e.message || "Não consegui sincronizar agora.");
      }
    } finally {
      setSyncing(false);
      setSyncController(null);
    }
  };

  const cancelSync = () => {
    syncController?.abort();
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
    () => transactions.filter((t) => t.status !== "excluida" && displayMonth(t, fechamentosFatura) === currentMonth),
    [transactions, currentMonth, fechamentosFatura]
  );
  const categorizadas = monthTx.filter((t) => t.status === "categorizado");
  const pendingCount = monthTx.filter((t) => t.status !== "categorizado").length;
  const excluidas = useMemo(() => transactions.filter((t) => t.status === "excluida"), [transactions]);
  const duplicateGroups = useMemo(() => findDuplicateGroups(transactions, fechamentosFatura), [transactions, fechamentosFatura]);
  const globalSearchResults = useMemo(() => {
    if (!search.trim()) return [];
    return transactions
      .filter((t) => t.status !== "excluida" && matchesSearch(t, categories, merchants, search))
      .map((t) => ({ ...t, fatura: displayMonth(t, fechamentosFatura) }))
      .sort((a, b) => b.data.localeCompare(a.data));
  }, [search, transactions, categories, merchants, fechamentosFatura]);

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
    const p = parseParcela(estabelecimento);
    const row = {
      data, estabelecimento, valor: parseFloat(valor), tipo, banco, user_id: userId,
      status: "pendente_estabelecimento", category_id: null, merchant_id: null,
      parcela_atual: p.atual, parcela_total: p.total,
    };
    const { data: inserted, error } = await supabase.from("transactions").insert(row).select().single();
    if (error) { setError(error.message); return; }
    setTransactions((prev) => [mapTransaction(inserted), ...prev]);
    setShowAdd(false);
  };

  // Aprova (ou edita) uma transação: identifica o estabelecimento e já define a categoria, tudo de uma vez.
  // Funciona tanto pra aprovar uma pendente quanto pra editar uma já aprovada — sem mudar o status nesse segundo caso.
  const resolveApproval = async (tx, { merchantName, categoryId, competenciaOverride, parcelaAtual, parcelaTotal, valor, data }) => {
    const name = titleCase(merchantName.trim());
    if (!name || !categoryId) return;
    const pattern = stripParcela(tx.estabelecimento).toLowerCase();
    if (!pattern) return;
    const dataFinal = data || tx.data;

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

    // grava nesta transação específica os valores que você editou (parcela, valor, data, fatura manual)
    const origemId = tx.origemId || tx.id;
    const selfUpdate = { status: "categorizado", category_id: categoryId, merchant_id: merchant.id, parcela_atual: parcelaAtual, parcela_total: parcelaTotal, valor, data: dataFinal, origem_id: origemId };
    if (competenciaOverride) selfUpdate.competencia_override = competenciaOverride;
    const { error: selfErr } = await supabase.from("transactions").update(selfUpdate).eq("id", tx.id);
    if (selfErr) { setError(selfErr.message); return; }

    setTransactions((prev) => prev.map((t) => {
      if (t.id === tx.id) {
        return { ...t, status: "categorizado", categoryId, merchantId: merchant.id, parcelaAtual, parcelaTotal, valor, data: dataFinal, origemId, ...(competenciaOverride ? { competenciaOverride } : {}) };
      }
      return t;
    }));

    // gera as parcelas futuras que ainda não existem, se for uma compra parcelada.
    // Ancoradas na fatura escolhida (2026-07, 2026-08, 2026-09...), e ligadas a ESSA compra
    // específica (origemId) — assim compras diferentes do mesmo estabelecimento não colidem.
    if (parcelaTotal > 1) {
      const faturaBase = competenciaOverride || competencia({ ...tx, data: dataFinal }, fechamentosFatura);
      const faltantes = [];
      for (let n = parcelaAtual + 1; n <= parcelaTotal; n++) {
        const jaExiste = transactions.some((t) =>
          (t.origemId || t.id) === origemId && t.parcelaAtual === n && t.parcelaTotal === parcelaTotal
        );
        if (!jaExiste) faltantes.push(n);
      }
      if (faltantes.length > 0) {
        const rows = faltantes.map((n) => ({
          data: addMonths(dataFinal, n - parcelaAtual),
          estabelecimento: `${name} ${n}/${parcelaTotal}`,
          valor,
          tipo: tx.tipo,
          banco: tx.banco,
          user_id: userId,
          status: "categorizado",
          category_id: categoryId,
          merchant_id: merchant.id,
          projetada: true,
          parcela_atual: n,
          parcela_total: parcelaTotal,
          origem_id: origemId,
          competencia_override: addFatura(faturaBase, n - parcelaAtual),
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

  // "Excluir" agora manda pra lixeira em vez de apagar de vez
  const removeTransaction = async (id) => {
    const tx = transactions.find((t) => t.id === id);
    const { error } = await supabase.from("transactions").update({ status: "excluida" }).eq("id", id);
    if (error) { setError(error.message); return; }
    setTransactions((prev) => prev.map((t) => (t.id === id ? { ...t, status: "excluida", statusAnterior: tx?.status } : t)));
  };

  const restoreTransaction = async (id) => {
    const tx = transactions.find((t) => t.id === id);
    const novoStatus = tx?.statusAnterior || "pendente_estabelecimento";
    const { error } = await supabase.from("transactions").update({ status: novoStatus }).eq("id", id);
    if (error) { setError(error.message); return; }
    setTransactions((prev) => prev.map((t) => (t.id === id ? { ...t, status: novoStatus } : t)));
  };

  const purgeTransaction = async (id) => {
    const { error } = await supabase.from("transactions").delete().eq("id", id);
    if (error) { setError(error.message); return; }
    setTransactions((prev) => prev.filter((t) => t.id !== id));
  };

  const markNotDuplicate = async (ids) => {
    const { error } = await supabase.from("transactions").update({ duplicate_reviewed: true }).in("id", ids);
    if (error) { setError(error.message); return; }
    setTransactions((prev) => prev.map((t) => (ids.includes(t.id) ? { ...t, duplicateReviewed: true } : t)));
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
          {syncing && (
            <button className="icon-btn connect-btn" onClick={cancelSync} aria-label="Cancelar sincronização" style={{ color: "var(--warn)", borderColor: "var(--warn)" }}>
              <X size={16} /> Cancelar
            </button>
          )}
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
        <button className={"tab-btn" + (view === "lixeira" ? " active" : "")} onClick={() => setView("lixeira")}>Lixeira{excluidas.length > 0 ? ` (${excluidas.length})` : ""}</button>
      </div>

      {error && <div className="banner banner-error"><AlertTriangle size={16} /> {error}</div>}

      {view === "transacoes" && duplicateGroups.length > 0 && (
        <section className="duplicates-panel">
          <h2 className="section-title"><AlertTriangle size={16} color="var(--warn)" /> Possíveis duplicidades</h2>
          {duplicateGroups.map((group) => {
            const merch = merchants.find((m) => m.id === group[0].merchantId);
            const cat = categories.find((c) => c.id === group[0].categoryId);
            return (
              <div key={group.map((g) => g.id).join("-")} className="duplicate-group">
                <div className="duplicate-group-head">
                  <strong>{merch?.name}</strong> <span className="of">· {cat?.name}</span>
                  <button className="ignore-link" onClick={() => markNotDuplicate(group.map((g) => g.id))}>Não são duplicatas</button>
                </div>
                {group.map((t) => (
                  <div key={t.id} className="duplicate-item">
                    <span className="tx-date">{t.data.slice(8, 10)}/{t.data.slice(5, 7)}</span>
                    <span>{t.banco} · {t.tipo}</span>
                    <span className="tx-valor-total">{currency(t.valor)}</span>
                    <button className="ledger-remove" onClick={() => removeTransaction(t.id)} aria-label="Excluir" title="Excluir esta"><X size={14} /></button>
                  </div>
                ))}
              </div>
            );
          })}
        </section>
      )}

      {pendingCount > 0 && (
        <div className="banner banner-pending">
          <Inbox size={16} />
          <span>{pendingCount} lançamento(s) esperando aprovação neste mês.</span>
        </div>
      )}

      {syncMsg && <div className="banner banner-pending"><RefreshCw size={16} /> {syncMsg}</div>}

      <div className="ledger-head" style={{ marginBottom: 18 }}>
        {view === "transacoes" ? (
          <input className="search-input" type="text" placeholder="Buscar por estabelecimento ou valor…" value={search} onChange={(e) => setSearch(e.target.value)} />
        ) : <span />}
        <button className="add-btn" onClick={() => setShowAdd(true)}><Plus size={16} /> Nova transação</button>
      </div>

      {view === "transacoes" && search.trim() && (
        <section className="search-panel">
          <p className="tx-subhead" style={{ margin: "0 0 8px" }}>
            {globalSearchResults.length} resultado(s) em todas as faturas
          </p>
          {globalSearchResults.length === 0 ? (
            <p className="empty">Nada encontrado.</p>
          ) : (
            <div className="search-results-list">
              {globalSearchResults.map((t) => {
                const merch = merchants.find((m) => m.id === t.merchantId);
                return (
                  <button
                    key={t.id}
                    className="search-result-row"
                    onClick={() => {
                      const [y, m] = t.fatura.split("-").map(Number);
                      setCursor(new Date(y, m - 1, 1));
                    }}
                  >
                    <span className="tx-date">{t.data.slice(8, 10)}/{t.data.slice(5, 7)}</span>
                    <span className="tx-desc">{merch?.name || t.estabelecimento}</span>
                    <span className="of">{t.banco} · {t.tipo}</span>
                    <span className="of">fatura {t.fatura}</span>
                    <span className="tx-valor-total">{currency(t.valor)}</span>
                  </button>
                );
              })}
            </div>
          )}
        </section>
      )}

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
              search={search}
              onApprove={resolveApproval}
              onIgnore={removeTransaction}
              onRevert={rejectTransaction}
              onRemove={removeTransaction}
            />
          ))}
        </>
      )}

      {view === "lixeira" && (
        <section className="bank-group">
          <div className="group-head"><h2>Lixeira</h2></div>
          {excluidas.length === 0 ? (
            <p className="empty">Nada na lixeira.</p>
          ) : (
            <div className="tx-list">
              <div className="tx-row tx-row-head" style={{ gridTemplateColumns: "52px 1fr 90px 90px 24px 24px" }}>
                <span>Data</span><span>Estabelecimento</span><span>Total</span><span>Mês</span><span /><span />
              </div>
              {[...excluidas].sort((a, b) => b.data.localeCompare(a.data)).map((t) => {
                const merch = merchants.find((m) => m.id === t.merchantId);
                return (
                  <div key={t.id} className="tx-row" style={{ gridTemplateColumns: "52px 1fr 90px 90px 24px 24px" }}>
                    <span className="tx-date">{t.data.slice(8, 10)}/{t.data.slice(5, 7)}</span>
                    <span className="tx-desc">{merch?.name || t.estabelecimento}</span>
                    <span className="tx-valor">{currency(t.valor * t.parcelaTotal)}</span>
                    <span className="tx-valor tx-valor-mes">{currency(t.valor)}</span>
                    <button className="ledger-remove" onClick={() => restoreTransaction(t.id)} aria-label="Restaurar" title="Restaurar"><RotateCcw size={14} /></button>
                    <button className="ledger-remove" onClick={() => purgeTransaction(t.id)} aria-label="Apagar de vez" title="Apagar de vez"><X size={14} /></button>
                  </div>
                );
              })}
            </div>
          )}
        </section>
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

function BankGroupSection({ banco, tipo, transactions, categories, merchants, patterns, fechamentosFatura, search, onApprove, onIgnore, onRevert, onRemove }) {
  const all = transactions.filter((t) => t.banco === banco && t.tipo === tipo);
  if (all.length === 0) return null;

  const approved = all.filter((t) => t.status === "categorizado");
  const isProgramada = (t) => t.parcelaAtual > 1 || t.data.slice(0, 7) !== competencia(t, fechamentosFatura);
  const programadas = approved.filter(isProgramada);
  const novas = approved.filter((t) => !isProgramada(t));
  const pending = all.filter((t) => t.status !== "categorizado");

  const totalFatura = approved.reduce((s, t) => s + Number(t.valor), 0);
  const totalProgramadas = programadas.reduce((s, t) => s + Number(t.valor), 0);
  const totalNovas = novas.reduce((s, t) => s + Number(t.valor), 0);

  const q = search || "";
  const pendingF = pending.filter((t) => matchesSearch(t, categories, merchants, q)).sort((a, b) => b.data.localeCompare(a.data));
  const novasF = novas.filter((t) => matchesSearch(t, categories, merchants, q)).sort((a, b) => b.data.localeCompare(a.data));
  const programadasF = programadas.filter((t) => matchesSearch(t, categories, merchants, q)).sort((a, b) => b.data.localeCompare(a.data));

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
        <span>Novas transações <strong>{currency(totalNovas)}</strong> ({novas.length})</span>
        <span>Parcelas programadas <strong>{currency(totalProgramadas)}</strong> ({programadas.length})</span>
      </div>

      {pendingF.length > 0 && (
        <>
          <p className="tx-subhead">Pendentes de aprovação</p>
          <div className="pendentes-cards">
            {pendingF.map((t) => (
              <ApprovalRow key={t.id} tx={t} categories={categories} merchants={merchants} patterns={patterns} fechamentosFatura={fechamentosFatura} allTransactions={approved} onApprove={onApprove} onIgnore={onIgnore} />
            ))}
          </div>
        </>
      )}

      {novasF.length > 0 && (
        <>
          <p className="tx-subhead">Novas transações</p>
          <div className="tx-list">
            <div className="tx-row tx-row-head">
              <span>Data</span><span>Estabelecimento</span><span>Categoria</span><span>Fatura</span><span>Parc.</span><span>Total</span><span>Mês</span><span /><span />
            </div>
            {novasF.map((t) => (
              <DisplayRow key={t.id} tx={t} categories={categories} merchants={merchants} patterns={patterns} fechamentosFatura={fechamentosFatura} onApprove={onApprove} onRevert={onRevert} onRemove={onRemove} />
            ))}
          </div>
        </>
      )}

      {programadasF.length > 0 && (
        <>
          <p className="tx-subhead">Parcelas programadas</p>
          <div className="tx-list">
            <div className="tx-row tx-row-head">
              <span>Data</span><span>Estabelecimento</span><span>Categoria</span><span>Fatura</span><span>Parc.</span><span>Total</span><span>Mês</span><span /><span />
            </div>
            {programadasF.map((t) => (
              <DisplayRow key={t.id} tx={t} categories={categories} merchants={merchants} patterns={patterns} fechamentosFatura={fechamentosFatura} onApprove={onApprove} onRevert={onRevert} onRemove={onRemove} />
            ))}
          </div>
        </>
      )}

      {pendingF.length === 0 && novasF.length === 0 && programadasF.length === 0 && (
        <p className="empty">Nada encontrado.</p>
      )}
    </section>
  );
}

function DisplayRow({ tx, categories, merchants, patterns, fechamentosFatura, onApprove, onRevert, onRemove }) {
  const [editing, setEditing] = useState(false);
  const merch = merchants.find((m) => m.id === tx.merchantId);
  const cat = categories.find((c) => c.id === tx.categoryId);

  if (editing) {
    return (
      <ApprovalRow
        tx={tx}
        categories={categories}
        merchants={merchants}
        patterns={patterns}
        fechamentosFatura={fechamentosFatura}
        mode="editing"
        onApprove={(t, payload) => { onApprove(t, payload); setEditing(false); }}
        onCancel={() => setEditing(false)}
        onRevert={(id) => { onRevert(id); setEditing(false); }}
      />
    );
  }

  return (
    <div className="tx-row">
      <span className="tx-date">{tx.data.slice(8, 10)}/{tx.data.slice(5, 7)}</span>
      <span className="tx-desc" title={tx.estabelecimento}>
        {merch?.name || tx.estabelecimento}
      </span>
      <span className="tx-desc">{cat?.name || "—"}</span>
      <span className="tx-desc" style={{ fontSize: 11, color: "var(--muted)" }}>
        {competencia(tx, fechamentosFatura)}
      </span>
      <span className="tx-parcela">{tx.parcelaAtual}/{tx.parcelaTotal}</span>
      <span className="tx-valor">{currency(tx.valor * tx.parcelaTotal)}</span>
      <span className="tx-valor tx-valor-mes">{currency(tx.valor)}</span>
      <button className="ledger-remove" onClick={() => setEditing(true)} aria-label="Editar" title="Editar sem voltar pra pendentes"><Pencil size={14} /></button>
      <button className="ledger-remove" onClick={() => onRemove(tx.id)} aria-label="Excluir" title="Excluir permanentemente"><X size={14} /></button>
    </div>
  );
}

function ApprovalRow({ tx, categories, merchants, patterns, fechamentosFatura, allTransactions = [], onApprove, onIgnore, mode = "pending", onCancel, onRevert }) {
  const [merchantName, setMerchantName] = useState("");
  const [pixCredito, setPixCredito] = useState(false);
  const [categoryId, setCategoryId] = useState(categories[0]?.id);
  const [fatura, setFatura] = useState(competencia(tx, fechamentosFatura));
  const [data, setData] = useState(tx.data);
  const parcelaDetectada = parseParcela(tx.estabelecimento);
  const [parcelaAtual, setParcelaAtual] = useState(tx.parcelaAtual > 1 ? tx.parcelaAtual : parcelaDetectada.atual);
  const [parcelaTotal, setParcelaTotal] = useState(tx.parcelaTotal > 1 ? tx.parcelaTotal : parcelaDetectada.total);
  const [valorMes, setValorMes] = useState(String(tx.valor).replace(".", ","));
  const faturaAutomatica = competencia(tx, fechamentosFatura);
  const valorMesNum = parseFloat(valorMes.replace(",", ".")) || 0;

  const possiveisDuplicatas = allTransactions.filter((t) => {
    if (t.id === tx.id || !t.merchantId) return false;
    if (competencia(t, fechamentosFatura) !== fatura) return false;
    const m = merchants.find((mm) => mm.id === t.merchantId);
    if (!m || m.name.trim().toLowerCase() !== merchantName.trim().toLowerCase()) return false;
    if (t.categoryId !== categoryId) return false;
    return Math.abs(t.valor - valorMesNum) <= 5;
  });

  useEffect(() => {
    const isPixRaw = /^pix no cr[éÃ]©?dito\s*-/i.test(tx.estabelecimento.trim());

    const applyMerchant = (m, cat) => {
      const hasPrefix = /^pix no cr[ée]dito\s*-/i.test(m.name);
      setPixCredito(hasPrefix || isPixRaw);
      setMerchantName(hasPrefix ? stripPixPrefix(m.name) : m.name);
      if (cat) setCategoryId(cat);
    };

    if (tx.merchantId) {
      const m = merchants.find((mm) => mm.id === tx.merchantId);
      if (m) { applyMerchant(m, tx.categoryId || m.categoryId || categories[0]?.id); return; }
    }
    const patMatch = matchPattern(patterns, tx.estabelecimento);
    if (patMatch) {
      const m = merchants.find((mm) => mm.id === patMatch.merchantId);
      if (m) { applyMerchant(m, m.categoryId); return; }
    }
    const alvo = tx.estabelecimento.toLowerCase();
    const guess = merchants.find((m) => alvo.includes(m.name.toLowerCase()));
    if (guess) {
      applyMerchant(guess, guess.categoryId);
    } else {
      const cleaned = stripParcela(tx.estabelecimento).replace(/^pix no cr[éÃ]©?dito\s*-\s*/i, "").trim();
      const looksPerson = looksLikePersonName(cleaned);
      setPixCredito(isPixRaw || looksPerson);
      setMerchantName(titleCase(cleaned));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleMerchantChange = (value) => {
    setMerchantName(value);
    const match = merchants.find((m) => m.name.toLowerCase() === value.trim().toLowerCase());
    if (match?.categoryId) setCategoryId(match.categoryId);
  };

  const submit = () => {
    const nomeFinal = pixCredito ? `Pix no Crédito - ${merchantName.trim()}` : merchantName.trim();
    onApprove(tx, {
      merchantName: nomeFinal, categoryId,
      competenciaOverride: fatura !== faturaAutomatica ? fatura : null,
      parcelaAtual, parcelaTotal, valor: valorMesNum, data,
    });
  };

  return (
    <div className={mode === "editing" ? "approval-card approval-card-editing" : "approval-card"}>
      {possiveisDuplicatas.length > 0 && (
        <div className="duplicate-warning">
          <AlertTriangle size={13} color="var(--warn)" />
          <span>
            Parecido com {possiveisDuplicatas.length > 1 ? `${possiveisDuplicatas.length} lançamentos já aprovados` : "um lançamento já aprovado"} nesta mesma fatura
            {possiveisDuplicatas[0] && ` (${possiveisDuplicatas[0].data.slice(8, 10)}/${possiveisDuplicatas[0].data.slice(5, 7)} · ${currency(possiveisDuplicatas[0].valor)})`}.
          </span>
          <button className="ignore-link" onClick={() => onIgnore(tx.id)}>Excluir esta</button>
        </div>
      )}
      <div className="approval-top">
        <div className="approval-field">
          <label>Data</label>
          <input className="tx-input" type="date" value={data} onChange={(e) => setData(e.target.value)} />
        </div>
        <div className="approval-field approval-field-grow">
          <label>Estabelecimento</label>
          <input className="tx-input" list="merchants-list" placeholder="Estabelecimento" value={merchantName} onChange={(e) => handleMerchantChange(e.target.value)} />
          <span className="tx-raw-hint" title={tx.estabelecimento}>{tx.estabelecimento}</span>
          {tx.paymentData && (
            <span className="tx-raw-hint" style={{ color: "var(--gold)" }} title={JSON.stringify(tx.paymentData)}>
              paymentData: {JSON.stringify(tx.paymentData)}
            </span>
          )}
          <label className="checkbox" style={{ marginTop: 3 }}>
            <input type="checkbox" checked={pixCredito} onChange={(e) => setPixCredito(e.target.checked)} />
            Pix no Crédito
          </label>
        </div>
        <div className="approval-field">
          <label>Categoria</label>
          <select className="tx-input" value={categoryId} onChange={(e) => setCategoryId(e.target.value)}>
            {categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        </div>
      </div>
      <div className="approval-bottom">
        <div className="approval-field">
          <label>Fatura</label>
          <select className="tx-input" value={fatura} onChange={(e) => setFatura(e.target.value)} title="Fatura em que essa transação será lançada">
            {nearbyMonths().map((mk) => <option key={mk} value={mk}>{mk}</option>)}
          </select>
        </div>
        <div className="approval-field approval-field-parcela">
          <label>Parcela</label>
          <span className="tx-parcela-edit">
            <input className="tx-parcela-input" type="number" min="1" value={parcelaAtual} onFocus={(e) => e.target.select()} onChange={(e) => setParcelaAtual(parseInt(e.target.value) || 1)} />
            <span>/</span>
            <input className="tx-parcela-input" type="number" min="1" value={parcelaTotal} onFocus={(e) => e.target.select()} onChange={(e) => setParcelaTotal(parseInt(e.target.value) || 1)} />
          </span>
        </div>
        <div className="approval-field">
          <label>Valor / mês</label>
          <input className="tx-input tx-valor-input" type="text" inputMode="decimal" value={valorMes} onChange={(e) => setValorMes(e.target.value)} />
        </div>
        <div className="approval-field">
          <label>Total</label>
          <span className="tx-valor-total">{currency(valorMesNum * parcelaTotal)}</span>
        </div>
        <div className="approval-actions">
          <button className="confirm-btn" disabled={!merchantName.trim()} onClick={submit}>
            <Check size={14} />
          </button>
          {mode === "editing" ? (
            <>
              <button className="ledger-remove" onClick={() => onRevert(tx.id)} aria-label="Voltar para pendentes" title="Voltar para pendentes"><RotateCcw size={14} /></button>
              <button className="ledger-remove" onClick={onCancel} aria-label="Cancelar edição" title="Cancelar"><X size={14} /></button>
            </>
          ) : (
            <button className="ledger-remove" onClick={() => onIgnore(tx.id)} aria-label="Excluir" title="Excluir permanentemente"><X size={14} /></button>
          )}
        </div>
      </div>
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
      .pendentes-cards { display: grid; gap: 10px; }
      .approval-card { background: rgba(201,162,75,0.08); border: 1px solid var(--gold); border-radius: 10px; padding: 12px; display: grid; gap: 10px; }
      .approval-card-editing { background: rgba(95,163,119,0.08); border-color: var(--ok); }
      .duplicate-warning { display: flex; align-items: center; gap: 8px; background: rgba(193,97,61,0.15); border: 1px solid var(--warn); border-radius: 8px; padding: 8px 10px; font-size: 12px; color: var(--warn); }
      .approval-top { display: flex; gap: 10px; align-items: flex-start; }
      .approval-bottom { display: flex; gap: 10px; align-items: flex-end; flex-wrap: wrap; }
      .approval-field { display: flex; flex-direction: column; gap: 3px; min-width: 0; }
      .approval-field label { font-size: 10px; color: var(--muted); text-transform: uppercase; letter-spacing: 0.04em; }
      .approval-field-grow { flex: 1; }
      .approval-field-parcela { min-width: 70px; }
      .approval-actions { display: flex; gap: 6px; margin-left: auto; align-items: center; }
      .tx-valor-total { font-family: 'IBM Plex Mono', monospace; font-weight: 600; font-size: 13px; padding: 6px 0; display: block; }
      .tx-list { min-width: 720px; }
      .tx-row { display: grid; grid-template-columns: 52px 1.4fr 1fr 70px 46px 90px 90px 24px 24px; align-items: center; gap: 6px; padding: 8px 0; border-bottom: 1px dashed var(--line); font-size: 12px; }
      .tx-row:last-child { border-bottom: none; }
      .tx-row-head { color: var(--muted); font-size: 10px; text-transform: uppercase; letter-spacing: 0.05em; padding-bottom: 6px; }
      .tx-row-pending { background: rgba(201,162,75,0.06); border-radius: 8px; }
      .tx-date { color: var(--muted); font-family: 'IBM Plex Mono', monospace; }
      .tx-desc { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
      .tx-row-duplicada { background: rgba(193,97,61,0.08); border-radius: 6px; }
      .duplicates-panel { background: rgba(193,97,61,0.08); border: 1px solid var(--warn); border-radius: 14px; padding: 16px 18px; margin-bottom: 18px; }
      .duplicate-group { margin-bottom: 14px; padding-bottom: 12px; border-bottom: 1px dashed var(--line); }
      .duplicate-group:last-child { margin-bottom: 0; padding-bottom: 0; border-bottom: none; }
      .duplicate-group-head { display: flex; align-items: center; gap: 8px; font-size: 13px; margin-bottom: 6px; }
      .ignore-link { margin-left: auto; background: none; border: none; color: var(--muted); text-decoration: underline; font-size: 12px; cursor: pointer; }
      .duplicate-item { display: grid; grid-template-columns: 52px 1fr 90px 24px; align-items: center; gap: 8px; font-size: 12px; padding: 4px 0; }
      .tx-input { background: var(--surface-2); border: 1px solid var(--line); border-radius: 6px; padding: 5px 7px; color: var(--text); font-size: 12px; font-family: inherit; width: 100%; box-sizing: border-box; }
      .tx-input-wrap { display: flex; flex-direction: column; gap: 2px; min-width: 0; }
      .tx-raw-hint { font-size: 10px; color: var(--muted); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; padding-left: 2px; }
      .tx-valor-input { text-align: right; font-family: 'IBM Plex Mono', monospace; }
      .tx-parcela { color: var(--muted); font-family: 'IBM Plex Mono', monospace; text-align: center; }
      .tx-parcela-edit { display: flex; align-items: center; justify-content: center; gap: 2px; font-family: 'IBM Plex Mono', monospace; color: var(--muted); font-size: 11px; }
      .tx-parcela-input { width: 34px; background: var(--surface-2); border: 1px solid var(--line); border-radius: 4px; padding: 3px 2px; color: var(--text); font-size: 12px; font-family: inherit; text-align: center; }
      .search-input { flex: 1; background: var(--surface); border: 1px solid var(--line); border-radius: 999px; padding: 8px 14px; color: var(--text); font-size: 13px; font-family: inherit; margin-right: 10px; }
      .search-panel { background: var(--surface); border: 1px solid var(--line); border-radius: 14px; padding: 16px 18px; margin-bottom: 18px; }
      .search-results-list { display: grid; gap: 2px; }
      .search-result-row { display: grid; grid-template-columns: 44px 1.4fr auto auto 80px; align-items: center; gap: 10px; padding: 7px 4px; border-radius: 6px; border: none; background: none; color: var(--text); font-size: 12px; font-family: inherit; text-align: left; cursor: pointer; width: 100%; }
      .search-result-row:hover { background: var(--surface-2); }
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
