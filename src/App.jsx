import { useState, useEffect, useMemo, Component } from "react";
import { Plus, Settings, X, AlertTriangle, ChevronLeft, ChevronRight, Inbox, Check, LogOut, Landmark, RefreshCw, RotateCcw, Pencil, Eye, EyeOff, Shield } from "lucide-react";
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

// Dicas de categoria pra estabelecimentos que a gente já sabe o que são,
// usadas só quando não existe estabelecimento/padrão cadastrado ainda.
const ESTABELECIMENTOS_CONHECIDOS = [
  { match: /nova primavera/i, categoryName: "Mercado/Farmácia" },
];

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

// Mostra a transação sempre na fatura calculada (fechamento do banco), pendente ou não —
// assim o mês em que ela aparece bate com o que o cartão de aprovação mostra.
function displayMonth(tx, fechamentosFatura) {
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

// Repete a mesma lógica de sugestão da tela de aprovação, só pra "adivinhar" o nome
// base (sem "Pix no Crédito -") de um pendente, sem de fato resolver/aprovar ele.
function guessBaseName(estabelecimento, merchants, patterns) {
  const patMatch = matchPattern(patterns, estabelecimento);
  if (patMatch) {
    const m = merchants.find((mm) => mm.id === patMatch.merchantId);
    if (m) return m.name.toLowerCase();
  }
  const alvo = estabelecimento.toLowerCase();
  const guess = merchants.find((m) => alvo.includes(m.name.toLowerCase()));
  if (guess) return guess.name.toLowerCase();
  const cleaned = stripParcela(estabelecimento).replace(/^pix no cr[éÃ]©?dito\s*-\s*/i, "").trim();
  return cleaned.toLowerCase();
}

function MaskText({ value, active, show, mono, dots = "••••" }) {
  if (!active) return <>{value}</>;
  return <span className={mono ? "mask-text mono" : "mask-text"}>{show ? value : dots}</span>;
}

function RevealButton({ onHoldChange, small }) {
  const onDown = (e) => {
    e.preventDefault();
    e.stopPropagation();
    try { e.currentTarget.setPointerCapture(e.pointerId); } catch (err) {}
    onHoldChange(true);
  };
  const onUp = (e) => {
    e.preventDefault();
    e.stopPropagation();
    onHoldChange(false);
  };
  return (
    <button
      type="button"
      className="mask-peek"
      tabIndex={-1}
      aria-label="Manter pressionado para ver"
      onPointerDown={onDown}
      onPointerUp={onUp}
      onPointerCancel={onUp}
      onContextMenu={(e) => e.preventDefault()}
    >
      <Eye size={small ? 11 : 12} />
    </button>
  );
}

// Combina um rótulo fixo com um valor mascarável: no modo seguro, os dois
// escondem/aparecem juntos; fora dele, só o valor é mascarado (quando hidden).
function MaskLine({ label, value, hidden, seguro, mono }) {
  if (seguro) return <Mask value={`${label} ${value}`} active mono={mono} />;
  return <>{label} <Mask value={value} active={hidden} mono={mono} /></>;
}

function Mask({ value, active, mono, dots = "••••" }) {
  const [show, setShow] = useState(false);
  if (!active) return <>{value}</>;
  const onDown = (e) => {
    e.preventDefault();
    e.stopPropagation();
    try { e.currentTarget.setPointerCapture(e.pointerId); } catch (err) {}
    setShow(true);
  };
  const onUp = (e) => {
    e.preventDefault();
    e.stopPropagation();
    setShow(false);
  };
  return (
    <span
      className="mask-wrap"
      onPointerDown={onDown}
      onPointerUp={onUp}
      onPointerCancel={onUp}
      onContextMenu={(e) => e.preventDefault()}
    >
      <span className={mono ? "mask-text mono" : "mask-text"}>{show ? value : dots}</span>
      <button type="button" className="mask-peek" tabIndex={-1} aria-label="Manter pressionado para ver">
        <Eye size={10} />
      </button>
    </span>
  );
}

function displayBanco(b) {
  return b === "Nubank" ? "NuBank" : b;
}

// Mostra só a pendente mais antiga de cada grupo (mesmo banco/tipo/valor/nome-adivinhado) —
// evita um card por mês pra compra parcelada que o banco manda solta. Aprovar a que aparece
// já limpa as escondidas (mesma lógica usada na aprovação).
function dedupPendentes(list, merchants, patterns) {
  const ordenada = [...list].sort((a, b) => a.data.localeCompare(b.data));
  const vistos = new Set();
  const resultado = [];
  for (const t of ordenada) {
    if (t.parcelaTotal > 1) { resultado.push(t); continue; }
    const chave = `${t.banco}|${t.tipo}|${t.valor.toFixed(2)}|${guessBaseName(t.estabelecimento, merchants, patterns)}`;
    if (vistos.has(chave)) continue;
    vistos.add(chave);
    resultado.push(t);
  }
  return resultado;
}

function matchesSearch(tx, categories, merchants, query, fechamentosFatura) {
  const q = query.trim().toLowerCase();
  if (!q) return true;

  const merch = merchants.find((m) => m.id === tx.merchantId);
  const nome = (merch?.name || tx.estabelecimento).toLowerCase();
  if (nome.includes(q)) return true;

  const cat = categories.find((c) => c.id === tx.categoryId);
  if (cat && cat.name.toLowerCase().includes(q)) return true;

  const dataFmt = `${tx.data.slice(8, 10)}/${tx.data.slice(5, 7)}`;
  if (dataFmt.includes(q) || tx.data.includes(q)) return true;

  if (fechamentosFatura) {
    const fatura = competencia(tx, fechamentosFatura);
    if (fatura.toLowerCase().includes(q)) return true;
  }

  const parcelaStr = `${tx.parcelaAtual}/${tx.parcelaTotal}`;
  if (parcelaStr.includes(q)) return true;

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
  return a.merchantId && a.merchantId === b.merchantId && a.categoryId === b.categoryId && a.banco === b.banco && Math.abs(a.valor - b.valor) <= 0.5;
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
  duplicateReviewed: row.duplicate_reviewed, origemId: row.origem_id, conferido: row.conferido,
  excluidaEm: row.excluida_em, pixCredito: row.pix_credito,
});
const mapMerchant = (row) => ({ id: row.id, name: row.name, categoryId: row.category_id });
const mapPattern = (row) => ({ id: row.id, pattern: row.pattern, merchantId: row.merchant_id });
const mapFechamento = (row) => ({ id: row.id, banco: row.banco, competencia: row.competencia, fechamento: row.fechamento });

function loadLS(key, fallback) {
  try {
    const v = localStorage.getItem(key);
    return v ? JSON.parse(v) : fallback;
  } catch {
    return fallback;
  }
}
function saveLS(key, value) {
  try { localStorage.setItem(key, JSON.stringify(value)); } catch {}
}

class ErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { error: null };
  }
  static getDerivedStateFromError(error) {
    return { error };
  }
  render() {
    if (this.state.error) {
      return (
        <div style={{ minHeight: "100vh", background: "#0F1613", color: "#EDEBE4", padding: 24, fontFamily: "sans-serif" }}>
          <h2 style={{ color: "#C1613D" }}>Deu um erro na tela</h2>
          <p>Isso costuma acontecer depois de uma atualização, quando dados salvos no navegador ficam num formato antigo.</p>
          <p style={{ fontSize: 12, opacity: 0.7, marginTop: 16 }}>{String(this.state.error?.message || this.state.error)}</p>
          <button
            onClick={() => { localStorage.clear(); window.location.reload(); }}
            style={{ marginTop: 16, background: "#C9A24B", color: "#0F1613", border: "none", borderRadius: 999, padding: "10px 18px", fontWeight: 600, cursor: "pointer" }}
          >
            Limpar preferências salvas e recarregar
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}

export default function App() {
  const [session, setSession] = useState(undefined); // undefined = carregando, null = deslogado

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => setSession(data.session));
    const { data: sub } = supabase.auth.onAuthStateChange((_event, s) => setSession(s));
    return () => sub.subscription.unsubscribe();
  }, []);

  if (session === undefined) return <div style={{ minHeight: "100vh", background: "#0F1613" }} />;
  if (!session) return <Auth />;
  return (
    <ErrorBoundary>
      <Dashboard userId={session.user.id} />
    </ErrorBoundary>
  );
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
  const [showImport, setShowImport] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [error, setError] = useState("");
  const [connecting, setConnecting] = useState(false);
  const [incomes, setIncomes] = useState([]);
  const [syncing, setSyncing] = useState(false);
  const [syncMsg, setSyncMsg] = useState("");
  const [view, setView] = useState(() => loadLS("view", "transacoes"));
  const [search, setSearch] = useState("");
  const [subView, setSubView] = useState(() => loadLS("subView", "mensal")); // mensal | geral
  const [privacyMode, setPrivacyMode] = useState(() => loadLS("privacyMode", "normal")); // normal | privado | seguro
  const [geralFiltros, setGeralFiltros] = useState(() => ({
    estabs: [], categorias: [], bancos: [], datas: [], faturas: [],
    ...loadLS("geralFiltros", {}),
  }));
  const [geralSort, setGeralSort] = useState(() => loadLS("geralSort", { key: "data", dir: -1 }));
  const hidden = privacyMode !== "normal";
  const seguro = privacyMode === "seguro";

  useEffect(() => { saveLS("view", view); }, [view]);
  useEffect(() => { saveLS("subView", subView); }, [subView]);
  useEffect(() => { saveLS("privacyMode", privacyMode); }, [privacyMode]);
  useEffect(() => { saveLS("geralFiltros", geralFiltros); }, [geralFiltros]);
  useEffect(() => { saveLS("geralSort", geralSort); }, [geralSort]);

  const resetFiltros = () => {
    setGeralFiltros({ estabs: [], categorias: [], bancos: [], datas: [], faturas: [] });
    setGeralSort({ key: "data", dir: -1 });
    setCursor(new Date());
  };

  useEffect(() => {
    document.title = seguro ? "•••" : "Minhas Finanças";
  }, [seguro]);

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

  const addRawTransaction = async ({ data, estabelecimento, valor, tipo, banco, categoryId, competenciaOverride, parcelaAtual, parcelaTotal }) => {
    const name = titleCase(estabelecimento.trim());
    const { data: merchant, error: merchErr } = await supabase
      .from("merchants")
      .upsert({ name, category_id: categoryId, user_id: userId }, { onConflict: "name,user_id" })
      .select()
      .single();
    if (merchErr) { setError(merchErr.message); return; }
    setMerchants((prev) => [...prev.filter((m) => m.id !== merchant.id), mapMerchant(merchant)]);

    const row = {
      data, estabelecimento: name, valor: parseFloat(valor), tipo, banco, user_id: userId,
      status: "categorizado", category_id: categoryId, merchant_id: merchant.id,
      parcela_atual: parcelaAtual, parcela_total: parcelaTotal,
      competencia_override: competenciaOverride || null,
    };
    const { data: inserted, error } = await supabase.from("transactions").insert(row).select().single();
    if (error) { setError(error.message); return; }
    setTransactions((prev) => [mapTransaction(inserted), ...prev]);
    setShowAdd(false);
  };

  // Aprova (ou edita) uma transação: identifica o estabelecimento e já define a categoria, tudo de uma vez.
  // Funciona tanto pra aprovar uma pendente quanto pra editar uma já aprovada — sem mudar o status nesse segundo caso.
  const resolveApproval = async (tx, { merchantName, categoryId, competenciaOverride, parcelaAtual, parcelaTotal, valor, data, pixCredito, banco }) => {
    const name = titleCase(merchantName.trim());
    if (!name || !categoryId) return;
    const pattern = stripParcela(tx.estabelecimento).toLowerCase();
    if (!pattern) return;
    const dataFinal = data || tx.data;
    const bancoFinal = banco || tx.banco;

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

    // grava nesta transação específica os valores que você editou (parcela, valor, data, fatura, cartão)
    const origemId = tx.origemId || tx.id;
    const selfUpdate = { status: "categorizado", category_id: categoryId, merchant_id: merchant.id, parcela_atual: parcelaAtual, parcela_total: parcelaTotal, valor, data: dataFinal, banco: bancoFinal, origem_id: origemId, pix_credito: !!pixCredito };
    if (competenciaOverride) selfUpdate.competencia_override = competenciaOverride;
    const { error: selfErr } = await supabase.from("transactions").update(selfUpdate).eq("id", tx.id);
    if (selfErr) { setError(selfErr.message); return; }

    setTransactions((prev) => prev.map((t) => {
      if (t.id === tx.id) {
        return { ...t, status: "categorizado", categoryId, merchantId: merchant.id, parcelaAtual, parcelaTotal, valor, data: dataFinal, banco: bancoFinal, origemId, pixCredito: !!pixCredito, ...(competenciaOverride ? { competenciaOverride } : {}) };
      }
      return t;
    }));

    // Ao editar uma parcela já aprovada (data, categoria/estabelecimento ou número da parcela),
    // propaga a mudança pras outras parcelas da mesma série — vale pra qualquer compra parcelada.
    const wasApproved = tx.status === "categorizado";
    if (wasApproved) {
      const deltaParcela = parcelaAtual - (tx.parcelaAtual || parcelaAtual);
      const siblings = transactions.filter((t) => t.id !== tx.id && (t.origemId || t.id) === origemId);
      for (const s of siblings) {
        const novaParcela = s.parcelaAtual + deltaParcela;
        const upd = { category_id: categoryId, merchant_id: merchant.id, parcela_total: parcelaTotal, parcela_atual: novaParcela, data: dataFinal, pix_credito: !!pixCredito };
        if (competenciaOverride) upd.competencia_override = addFatura(competenciaOverride, novaParcela - parcelaAtual);
        const { error: sibErr } = await supabase.from("transactions").update(upd).eq("id", s.id);
        if (sibErr) { setError(sibErr.message); }
      }
      if (siblings.length > 0) {
        setTransactions((prev) => prev.map((t) => {
          const s = siblings.find((x) => x.id === t.id);
          if (!s) return t;
          const novaParcela = s.parcelaAtual + deltaParcela;
          return {
            ...t, categoryId, merchantId: merchant.id, parcelaTotal, parcelaAtual: novaParcela, data: dataFinal, pixCredito: !!pixCredito,
            ...(competenciaOverride ? { competenciaOverride: addFatura(competenciaOverride, novaParcela - parcelaAtual) } : {}),
          };
        }));
      }
    }
    // gera as parcelas que ainda não existem (passadas e futuras), se for uma compra parcelada.
    // Ancoradas na fatura escolhida (2026-07, 2026-08, 2026-09...), e ligadas a ESSA compra
    // específica (origemId) — assim compras diferentes do mesmo estabelecimento não colidem.
    if (parcelaTotal > 1) {
      const faturaBase = competenciaOverride || competencia({ ...tx, data: dataFinal }, fechamentosFatura);
      const faltantes = [];
      for (let n = 1; n <= parcelaTotal; n++) {
        if (n === parcelaAtual) continue;
        const jaExiste = transactions.some((t) =>
          (t.origemId || t.id) === origemId && t.parcelaAtual === n && t.parcelaTotal === parcelaTotal
        );
        if (!jaExiste) faltantes.push(n);
      }
      if (faltantes.length > 0) {
        const rows = faltantes.map((n) => ({
          data: dataFinal,
          estabelecimento: `${name} ${n}/${parcelaTotal}`,
          valor,
          tipo: tx.tipo,
          banco: bancoFinal,
          user_id: userId,
          status: "categorizado",
          category_id: categoryId,
          merchant_id: merchant.id,
          projetada: true,
          parcela_atual: n,
          parcela_total: parcelaTotal,
          origem_id: origemId,
          pix_credito: !!pixCredito,
          competencia_override: addFatura(faturaBase, n - parcelaAtual),
        }));
        const { data: inseridas, error: projErr } = await supabase.from("transactions").insert(rows).select();
        if (projErr) { setError(projErr.message); return; }
        setTransactions((prev) => [...prev, ...(inseridas || []).map(mapTransaction)]);
      }
    }

    // Compra parcelada (qualquer estabelecimento) OU Pix no Crédito à vista: procura pendentes
    // de OUTROS meses com o mesmo valor mensal exato E o mesmo nome base (sem o "Pix no
    // Crédito -"), pra não juntar por engano duas coisas diferentes que coincidentemente
    // cobram o mesmo valor.
    // - À vista + Pix: essas pendentes são o próprio pagamento se repetindo — aprova todas juntas.
    // - Parcelado: alguns bancos mandam cada mês como uma pendente solta "1/1" (não sabem que é
    //   parcela). As parcelas futuras já foram projetadas automaticamente acima, então essas
    //   pendentes soltas passam a ser redundantes — vão pra lixeira em vez de aprovadas.
    if (parcelaTotal > 1 || pixCredito) {
      const baseNameAlvo = name.toLowerCase();
      const merchantsAtual = [...merchants.filter((m) => m.id !== merchant.id), mapMerchant(merchant)];
      const candidatos = transactions.filter((t) =>
        t.id !== tx.id &&
        t.status !== "categorizado" && t.status !== "excluida" &&
        t.banco === bancoFinal && t.tipo === tx.tipo &&
        t.parcelaTotal === 1 &&
        Math.abs(t.valor - valor) < 0.005 &&
        (
          t.estabelecimento.toLowerCase().includes(pattern) ||
          guessBaseName(t.estabelecimento, merchantsAtual, patterns) === baseNameAlvo
        )
      );
      if (candidatos.length > 0) {
        const ids = candidatos.map((t) => t.id);
        if (parcelaTotal === 1) {
          const { error: pixErr } = await supabase
            .from("transactions")
            .update({ status: "categorizado", category_id: categoryId, merchant_id: merchant.id, parcela_atual: 1, parcela_total: 1, pix_credito: !!pixCredito })
            .in("id", ids);
          if (pixErr) { setError(pixErr.message); return; }
          setTransactions((prev) => prev.map((t) =>
            ids.includes(t.id) ? { ...t, status: "categorizado", categoryId, merchantId: merchant.id, parcelaAtual: 1, parcelaTotal: 1, pixCredito: !!pixCredito } : t
          ));
        } else {
          const agoraAuto = new Date().toISOString();
          const { error: pixErr } = await supabase.from("transactions").update({ status: "excluida", excluida_em: agoraAuto }).in("id", ids);
          if (pixErr) { setError(pixErr.message); return; }
          setTransactions((prev) => prev.map((t) => (ids.includes(t.id) ? { ...t, status: "excluida", statusAnterior: t.status, excluidaEm: agoraAuto } : t)));
        }
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
    let ids = [id];
    if (tx && tx.status === "categorizado" && tx.merchantId) {
      const isPix = !!tx.pixCredito;
      const origemIdGroup = tx.origemId || tx.id;
      const relacionadas = transactions.filter((t) =>
        t.id !== tx.id && t.status !== "excluida" &&
        (
          (t.origemId || t.id) === origemIdGroup ||
          (isPix && t.merchantId === tx.merchantId && t.banco === tx.banco && t.tipo === tx.tipo && Math.abs(t.valor - tx.valor) < 0.005)
        )
      );
      if (relacionadas.length > 0) ids = [id, ...relacionadas.map((t) => t.id)];
    }
    const agora = new Date().toISOString();
    const { error } = await supabase.from("transactions").update({ status: "excluida", excluida_em: agora }).in("id", ids);
    if (error) { setError(error.message); return; }
    setTransactions((prev) => prev.map((t) => (ids.includes(t.id) ? { ...t, status: "excluida", statusAnterior: t.status, excluidaEm: agora } : t)));
  };

  const restoreTransaction = async (id) => {
    const tx = transactions.find((t) => t.id === id);
    const novoStatus = tx?.statusAnterior || "pendente_estabelecimento";
    const { error } = await supabase.from("transactions").update({ status: novoStatus, excluida_em: null }).eq("id", id);
    if (error) { setError(error.message); return; }
    setTransactions((prev) => prev.map((t) => (t.id === id ? { ...t, status: novoStatus, excluidaEm: null } : t)));
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

  // Só marca/desmarca — não mexe em mais nada
  const toggleConferido = async (id, value) => {
    const { error } = await supabase.from("transactions").update({ conferido: value }).eq("id", id);
    if (error) { setError(error.message); return; }
    setTransactions((prev) => prev.map((t) => (t.id === id ? { ...t, conferido: value } : t)));
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
          <p className="eyebrow"><Mask value="Fase 1 · Consolidação de gastos" active={seguro} /></p>
          <h1><Mask value="Minhas finanças" active={seguro} /></h1>
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
            <Landmark size={16} /> {connecting ? "Conectando…" : <Mask value="Conectar banco" active={seguro} />}
          </button>
          <div className="privacy-controls">
            <button
              className={"icon-btn privacy-btn" + (privacyMode !== "normal" ? " active" : "")}
              onClick={() => setPrivacyMode(privacyMode === "normal" ? "privado" : privacyMode === "privado" ? "seguro" : "normal")}
              aria-label="Modo de privacidade"
              title={`Modo atual: ${privacyMode}. Clique pra trocar.`}
            >
              <Shield size={16} /> {privacyMode === "normal" ? "Normal" : privacyMode === "privado" ? "Privado" : "Seguro"}
            </button>
          </div>
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
        <button className={"tab-btn" + (view === "transacoes" ? " active" : "")} onClick={() => setView("transacoes")}><Mask value="Cartão de Crédito" active={seguro} /></button>
        <button className={"tab-btn" + (view === "resumo" ? " active" : "")} onClick={() => setView("resumo")}><Mask value="Resumo por categoria" active={seguro} /></button>
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
                  <strong><Mask value={stripPixPrefix(merch?.name)} active={seguro} /></strong> <span className="of">· <Mask value={cat?.name} active={seguro} /></span>
                  <button className="ignore-link" onClick={() => markNotDuplicate(group.map((g) => g.id))}>Não são duplicatas</button>
                </div>
                {group.map((t) => (
                  <div key={t.id} className="duplicate-item">
                    <span className="tx-date">{t.data.slice(8, 10)}/{t.data.slice(5, 7)}</span>
                    <span>{displayBanco(t.banco)} · {t.tipo}</span>
                    <span className="tx-valor-total"><Mask value={currency(t.valor)} active={hidden} mono /></span>
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
        <button className="add-btn" onClick={() => setShowAdd(true)}><Plus size={16} /> <Mask value="Nova transação" active={seguro} /></button>
        <button className="add-btn" onClick={() => setShowImport(true)} style={{ marginLeft: 8 }}><Plus size={16} /> <Mask value="Importar fatura" active={seguro} /></button>
      </div>

      {view === "transacoes" && (
        <div className="subview-tabs">
          <button className={"subtab-btn" + (subView === "mensal" ? " active" : "")} onClick={() => setSubView("mensal")}>Por mês</button>
          <button className={"subtab-btn" + (subView === "geral" ? " active" : "")} onClick={() => setSubView("geral")}>Todos</button>
          {subView === "geral" && Object.values(geralFiltros).some((v) => v.length > 0) && (
            <button className="subtab-btn reset-btn" onClick={resetFiltros} title="Limpar filtros, voltar pra ordenação padrão e mês atual">
              <RotateCcw size={12} /> Redefinir
            </button>
          )}
        </div>
      )}

      {view === "transacoes" && subView === "mensal" && (
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
              allTransactionsGlobal={transactions}
              categories={categories}
              merchants={merchants}
              patterns={patterns}
              fechamentosFatura={fechamentosFatura}
              search={search}
              hidden={hidden}
              seguro={seguro}
              onApprove={resolveApproval}
              onIgnore={removeTransaction}
              onRevert={rejectTransaction}
              onRemove={removeTransaction}
              onToggleConferido={toggleConferido}
            />
          ))}
        </>
      )}

      {view === "transacoes" && subView === "geral" && (
        <GeralView
          transactions={transactions}
          categories={categories}
          merchants={merchants}
          patterns={patterns}
          fechamentosFatura={fechamentosFatura}
          hidden={hidden}
          seguro={seguro}
          search={search}
          filtros={geralFiltros}
          setFiltros={setGeralFiltros}
          sort={geralSort}
          setSort={setGeralSort}
          onApprove={resolveApproval}
          onIgnore={removeTransaction}
          onRevert={rejectTransaction}
          onRemove={removeTransaction}
        />
      )}

      {view === "lixeira" && (
        <section className="bank-group">
          <div className="group-head"><h2>Lixeira</h2></div>
          {excluidas.length === 0 ? (
            <p className="empty">Nada na lixeira.</p>
          ) : (
            <div className="tx-list">
              <div className="tx-row tx-row-head" style={{ gridTemplateColumns: "42px 1fr 0.85fr 0.85fr 90px 18px 18px" }}>
                <span>Data</span><span>Estabelecimento</span><span>Valor Total</span><span>Valor/Mês</span><span>Excluída em</span><span /><span />
              </div>
              {[...excluidas].sort((a, b) => (b.excluidaEm || "").localeCompare(a.excluidaEm || "")).map((t) => {
                const merch = merchants.find((m) => m.id === t.merchantId);
                const ex = t.excluidaEm ? new Date(t.excluidaEm) : null;
                return (
                  <div key={t.id} className="tx-row" style={{ gridTemplateColumns: "42px 1fr 0.85fr 0.85fr 90px 18px 18px" }}>
                    <span className="tx-cell">{t.data.slice(8, 10)}/{t.data.slice(5, 7)}</span>
                    <span className="tx-cell tx-cell-estab"><Mask value={stripPixPrefix(merch?.name || t.estabelecimento)} active={seguro} /></span>
                    <span className="tx-cell tx-cell-mono"><Mask value={currency(t.valor * t.parcelaTotal)} active={hidden} mono /></span>
                    <span className="tx-cell tx-cell-mono"><Mask value={currency(t.valor)} active={hidden} mono /></span>
                    <span className="tx-cell" style={{ fontSize: 10 }}>
                      {ex ? `${String(ex.getDate()).padStart(2, "0")}/${String(ex.getMonth() + 1).padStart(2, "0")}/${String(ex.getFullYear()).slice(2)} ${String(ex.getHours()).padStart(2, "0")}:${String(ex.getMinutes()).padStart(2, "0")}` : "—"}
                    </span>
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
                <span className="group-total"><Mask value={currency(totals[key].spent)} active={hidden} mono /> <span className="of">/ <Mask value={currency(totals[key].planned)} active={hidden} mono /></span></span>
              </div>
              <div className="cat-list">
                {categories.filter((c) => c.group === key).map((c) => {
                  const spent = spentByCategory[c.id] || 0;
                  const pct = c.limit > 0 ? Math.min(100, (spent / c.limit) * 100) : 0;
                  const over = c.limit > 0 && spent > c.limit;
                  return (
                    <div key={c.id} className="cat-row">
                      <div className="cat-row-top">
                        <span className="cat-name"><Mask value={c.name} active={seguro} /></span>
                        <span className={"cat-values" + (over ? " over" : "")}>
                          <Mask value={currency(spent)} active={hidden} mono /> <span className="of">/</span>
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

      {showAdd && <AddRawModal tipos={TIPOS} bancos={BANCOS} categories={categories} fechamentosFatura={fechamentosFatura} onClose={() => setShowAdd(false)} onSave={addRawTransaction} />}
      {showImport && (
        <ImportModal
          categories={categories}
          bancos={BANCOS.filter((b) => b !== "Itaú")}
          tipos={TIPOS}
          userId={userId}
          setError={setError}
          onClose={() => setShowImport(false)}
          onImported={async (inseridas) => {
            setTransactions((prev) => [...inseridas.map(mapTransaction), ...prev]);
            const { data: merch } = await supabase.from("merchants").select("*").order("name");
            if (merch) setMerchants(merch.map(mapMerchant));
            setShowImport(false);
          }}
        />
      )}
      {showSettings && (
        <SettingsModal fechamentosFatura={fechamentosFatura} onSaveFechamento={saveFechamento} onDeleteFechamento={deleteFechamento} merchants={merchants} patterns={patterns} categories={categories} onDeletePattern={deletePattern} onClose={() => setShowSettings(false)} />
      )}
    </div>
  );
}

function SortableHead({ sort, setSort, seguro, showBanco, showConferido }) {
  const [revealed, setRevealed] = useState(false);
  const cols = [
    { key: "data", label: "Data" },
    ...(showBanco ? [{ key: "banco", label: "Cartão" }] : []),
    { key: "estabelecimento", label: "Estabelecimento" },
    { key: "categoria", label: "Categoria" },
    { key: "fatura", label: "Fatura" },
  ];
  const click = (key) => setSort((s) => (s.key === key ? { key, dir: -s.dir } : { key, dir: 1 }));
  const arrow = (key) => (sort.key === key ? (sort.dir === 1 ? " ▲" : " ▼") : "");
  const clickParcelamento = () => setSort((s) => {
    if (s.key === "parcelaAtual" && s.dir === 1) return { key: "parcelaAtual", dir: -1 };
    if (s.key === "parcelaAtual" && s.dir === -1) return { key: "parcelaTotal", dir: 1 };
    if (s.key === "parcelaTotal" && s.dir === 1) return { key: "parcelaTotal", dir: -1 };
    return { key: "parcelaAtual", dir: 1 };
  });
  const parcelamentoArrow = (sort.key === "parcelaAtual" || sort.key === "parcelaTotal") ? (sort.dir === 1 ? " ▲" : " ▼") : "";
  const parcelamentoTitle = sort.key === "parcelaTotal" ? "Ordenando por quantidade de parcelas" : "Ordenando por número da parcela atual";
  return (
    <div className={"tx-row tx-row-head" + (showBanco ? " tx-row-banco" : "") + (showConferido ? " tx-row-conferido" : "")}>
      {cols.map((c) => (
        <button key={c.key} className={"tx-head-btn" + (c.key === "estabelecimento" ? " tx-head-btn-left" : "")} onClick={() => click(c.key)}>
          <MaskText value={c.label} active={seguro} show={revealed} />{arrow(c.key)}
        </button>
      ))}
      <button className="tx-head-btn" onClick={clickParcelamento} title={parcelamentoTitle}>
        <MaskText value="Parcelamento" active={seguro} show={revealed} />{parcelamentoArrow}
      </button>
      <button className="tx-head-btn" onClick={() => click("total")}><MaskText value="Valor Total" active={seguro} show={revealed} />{arrow("total")}</button>
      <button className="tx-head-btn" onClick={() => click("mes")}><MaskText value="Valor/Mês" active={seguro} show={revealed} />{arrow("mes")}</button>
      {seguro ? <RevealButton onHoldChange={setRevealed} small /> : <span />}
      <span /><span />
      {showConferido && <span title="Já conferido">✓</span>}
    </div>
  );
}

function MultiFilter({ label, options, selected, onChange, seguro }) {
  const [open, setOpen] = useState(false);
  if (options.length === 0) return null;
  const toggle = (value) => {
    onChange(selected.includes(value) ? selected.filter((v) => v !== value) : [...selected, value]);
  };
  return (
    <div className="multi-filter">
      <button type="button" className="filter-select" onClick={() => setOpen((o) => !o)}>
        <Mask value={label} active={seguro} />{selected.length > 0 ? ` (${selected.length})` : ""}
      </button>
      {open && (
        <div className="multi-filter-panel">
          <div className="multi-filter-actions">
            {selected.length > 0 && <button type="button" className="ignore-link" onClick={() => onChange([])}>Limpar</button>}
            <button type="button" className="ignore-link" onClick={() => setOpen(false)}>Fechar</button>
          </div>
          {options.map((o) => (
            <label key={o.value} className="multi-filter-option">
              <input type="checkbox" checked={selected.includes(o.value)} onChange={() => toggle(o.value)} />
              <Mask value={o.label} active={seguro} />
            </label>
          ))}
        </div>
      )}
    </div>
  );
}

function GeralView({ transactions, categories, merchants, patterns, fechamentosFatura, hidden, seguro, search, filtros, setFiltros, sort, setSort, onApprove, onIgnore, onRevert, onRemove }) {
  const todasCredito = transactions.filter((t) => t.tipo === "Crédito" && t.status !== "excluida");
  const all = todasCredito.filter((t) => t.status === "categorizado");
  const pending = todasCredito.filter((t) => t.status !== "categorizado");
  const nomeDe = (t) => merchants.find((m) => m.id === t.merchantId)?.name || t.estabelecimento;

  const opcoes = {
    bancos: [...new Set(all.map((t) => t.banco))].sort(),
    estabs: [...new Set(all.map(nomeDe))].sort(),
    categorias: [...new Set(all.map((t) => t.categoryId))]
      .map((id) => categories.find((c) => c.id === id))
      .filter(Boolean)
      .sort((a, b) => a.name.localeCompare(b.name)),
    datas: [...new Set(all.map((t) => t.data))].sort(),
    faturas: [...new Set(all.map((t) => competencia(t, fechamentosFatura)))].sort(),
  };

  const q = search || "";
  const pendingF = dedupPendentes(pending.filter((t) => matchesSearch(t, categories, merchants, q, fechamentosFatura)), merchants, patterns).sort((a, b) => b.data.localeCompare(a.data));

  const filtrados = all.filter((t) => {
    if (!matchesSearch(t, categories, merchants, q, fechamentosFatura)) return false;
    if (filtros.bancos.length && !filtros.bancos.includes(t.banco)) return false;
    if (filtros.categorias.length && !filtros.categorias.includes(t.categoryId)) return false;
    if (filtros.datas.length && !filtros.datas.includes(t.data)) return false;
    if (filtros.faturas.length && !filtros.faturas.includes(competencia(t, fechamentosFatura))) return false;
    if (filtros.estabs.length && !filtros.estabs.includes(nomeDe(t))) return false;
    return true;
  });

  const sortValue = (t, key) => {
    switch (key) {
      case "data": return t.data;
      case "estabelecimento": return nomeDe(t).toLowerCase();
      case "categoria": return (categories.find((c) => c.id === t.categoryId)?.name || "").toLowerCase();
      case "fatura": return competencia(t, fechamentosFatura);
      case "parcelaTotal": return t.parcelaTotal;
      case "parcelaAtual": return t.parcelaAtual;
      case "total": return t.valor * t.parcelaTotal;
      case "mes": return t.valor;
      default: return t.data;
    }
  };
  const ordenados = [...filtrados].sort((a, b) => {
    const va = sortValue(a, sort.key), vb = sortValue(b, sort.key);
    if (va < vb) return -1 * sort.dir;
    if (va > vb) return 1 * sort.dir;
    return 0;
  });

  const total = filtrados.reduce((s, t) => s + Number(t.valor), 0);

  return (
    <section className="bank-group">
      <div className="group-head">
        <h2><Mask value="Gastos gerais no cartão de crédito" active={seguro} /></h2>
        <span className="group-total"><Mask value={currency(total)} active={hidden} mono /> <span className="of">· {filtrados.length} lançamento(s)</span></span>
      </div>

      <div className="filter-row" style={{ marginBottom: 14 }}>
        <MultiFilter label="Cartão" options={opcoes.bancos.map((b) => ({ value: b, label: displayBanco(b) }))} selected={filtros.bancos} onChange={(v) => setFiltros({ ...filtros, bancos: v })} seguro={seguro} />
        <MultiFilter label="Datas" options={opcoes.datas.map((d) => ({ value: d, label: `${d.slice(8, 10)}/${d.slice(5, 7)}/${d.slice(0, 4)}` }))} selected={filtros.datas} onChange={(v) => setFiltros({ ...filtros, datas: v })} seguro={seguro} />
        <MultiFilter label="Estabelecimentos" options={opcoes.estabs.map((e) => ({ value: e, label: e }))} selected={filtros.estabs} onChange={(v) => setFiltros({ ...filtros, estabs: v })} seguro={seguro} />
        <MultiFilter label="Categorias" options={opcoes.categorias.map((c) => ({ value: c.id, label: c.name }))} selected={filtros.categorias} onChange={(v) => setFiltros({ ...filtros, categorias: v })} seguro={seguro} />
        <MultiFilter label="Faturas" options={opcoes.faturas.map((f) => ({ value: f, label: f }))} selected={filtros.faturas} onChange={(v) => setFiltros({ ...filtros, faturas: v })} seguro={seguro} />
      </div>

      {pendingF.length > 0 && (
        <>
          <p className="tx-subhead"><Mask value="Pendentes de aprovação" active={seguro} /></p>
          <div className="pendentes-cards">
            {pendingF.map((t) => (
              <ApprovalRow key={t.id} tx={t} categories={categories} merchants={merchants} patterns={patterns} fechamentosFatura={fechamentosFatura} allTransactions={all} hidden={hidden} seguro={seguro} onApprove={onApprove} onIgnore={onIgnore} />
            ))}
          </div>
        </>
      )}

      {ordenados.length === 0 ? (
        pendingF.length === 0 && <p className="empty">Nada encontrado.</p>
      ) : (
        <div className="tx-list">
          <SortableHead sort={sort} setSort={setSort} seguro={seguro} showBanco />
          {ordenados.map((t) => (
            <DisplayRow key={t.id} tx={t} categories={categories} merchants={merchants} patterns={patterns} fechamentosFatura={fechamentosFatura} hidden={hidden} seguro={seguro} showYear showBanco onApprove={onApprove} onRevert={onRevert} onRemove={onRemove} />
          ))}
        </div>
      )}
    </section>
  );
}

function BankGroupSection({ banco, tipo, transactions, allTransactionsGlobal, categories, merchants, patterns, fechamentosFatura, search, hidden, seguro, onApprove, onIgnore, onRevert, onRemove, onToggleConferido }) {
  const [sortNovas, setSortNovas] = useState({ key: "data", dir: -1 });
  const [sortProgramadas, setSortProgramadas] = useState({ key: "data", dir: -1 });
  const all = transactions.filter((t) => t.banco === banco && t.tipo === tipo);
  if (all.length === 0) return null;

  const approved = all.filter((t) => t.status === "categorizado");
  const approvedGlobal = (allTransactionsGlobal || transactions).filter(
    (t) => t.banco === banco && t.tipo === tipo && t.status === "categorizado"
  );
  const isProgramada = (t) => {
    if (t.banco === "Bradesco" && t.parcelaTotal === 1) return false;
    return t.parcelaAtual > 1 || t.data.slice(0, 7) !== competencia(t, fechamentosFatura);
  };
  const programadas = approved.filter(isProgramada);
  const novas = approved.filter((t) => !isProgramada(t));
  const pending = all.filter((t) => t.status !== "categorizado");

  const totalFatura = approved.reduce((s, t) => s + Number(t.valor), 0);
  const totalProgramadas = programadas.reduce((s, t) => s + Number(t.valor), 0);
  const totalNovas = novas.reduce((s, t) => s + Number(t.valor), 0);

  const nomeDe = (t) => merchants.find((m) => m.id === t.merchantId)?.name || t.estabelecimento;

  const sortValue = (t, key) => {
    switch (key) {
      case "data": return t.data;
      case "estabelecimento": return nomeDe(t).toLowerCase();
      case "categoria": return (categories.find((c) => c.id === t.categoryId)?.name || "").toLowerCase();
      case "fatura": return competencia(t, fechamentosFatura);
      case "parcelaTotal": return t.parcelaTotal;
      case "parcelaAtual": return t.parcelaAtual;
      case "total": return t.valor * t.parcelaTotal;
      case "mes": return t.valor;
      default: return t.data;
    }
  };
  const aplicarOrdenacao = (list, sort) =>
    [...list].sort((a, b) => {
      const va = sortValue(a, sort.key), vb = sortValue(b, sort.key);
      if (va < vb) return -1 * sort.dir;
      if (va > vb) return 1 * sort.dir;
      return 0;
    });

  const q = search || "";
  const pendingF = dedupPendentes(pending.filter((t) => matchesSearch(t, categories, merchants, q, fechamentosFatura)), merchants, patterns).sort((a, b) => b.data.localeCompare(a.data));
  const novasF = aplicarOrdenacao(novas.filter((t) => matchesSearch(t, categories, merchants, q, fechamentosFatura)), sortNovas);
  const programadasF = aplicarOrdenacao(programadas.filter((t) => matchesSearch(t, categories, merchants, q, fechamentosFatura)), sortProgramadas);

  return (
    <section className="bank-group">
      <div className="group-head">
        <h2><Mask value={`${displayBanco(banco)} · ${tipo}`} active={seguro} /></h2>
        {pending.length > 0 && <span className="group-total of">{pending.length} pendente(s)</span>}
      </div>

      <div className="fatura-summary">
        <span>{seguro ? <Mask value={`Total da fatura ${currency(totalFatura)} (${approved.length})`} active mono /> : <>Total da fatura <strong><Mask value={currency(totalFatura)} active={hidden} mono /></strong> ({approved.length})</>}</span>
        <span>{seguro ? <Mask value={`Novas transações ${currency(totalNovas)} (${novas.length})`} active mono /> : <>Novas transações <strong><Mask value={currency(totalNovas)} active={hidden} mono /></strong> ({novas.length})</>}</span>
        <span>{seguro ? <Mask value={`Parcelas programadas ${currency(totalProgramadas)} (${programadas.length})`} active mono /> : <>Parcelas programadas <strong><Mask value={currency(totalProgramadas)} active={hidden} mono /></strong> ({programadas.length})</>}</span>
      </div>

      {pendingF.length > 0 && (
        <>
          <p className="tx-subhead"><Mask value="Pendentes de aprovação" active={seguro} /></p>
          <div className="pendentes-cards">
            {pendingF.map((t) => (
              <ApprovalRow key={t.id} tx={t} categories={categories} merchants={merchants} patterns={patterns} fechamentosFatura={fechamentosFatura} allTransactions={approvedGlobal} hidden={hidden} seguro={seguro} onApprove={onApprove} onIgnore={onIgnore} />
            ))}
          </div>
        </>
      )}

      {novasF.length > 0 && (
        <>
          <p className="tx-subhead"><Mask value="Novas transações" active={seguro} /></p>
          <div className="tx-list">
            <SortableHead sort={sortNovas} setSort={setSortNovas} seguro={seguro} showConferido />
            {novasF.map((t) => (
              <DisplayRow key={t.id} tx={t} categories={categories} merchants={merchants} patterns={patterns} fechamentosFatura={fechamentosFatura} hidden={hidden} seguro={seguro} showConferido onToggleConferido={onToggleConferido} onApprove={onApprove} onRevert={onRevert} onRemove={onRemove} />
            ))}
          </div>
        </>
      )}

      {programadasF.length > 0 && (
        <>
          <p className="tx-subhead"><Mask value="Parcelas programadas" active={seguro} /></p>
          <div className="tx-list">
            <SortableHead sort={sortProgramadas} setSort={setSortProgramadas} seguro={seguro} showConferido />
            {programadasF.map((t) => (
              <DisplayRow key={t.id} tx={t} categories={categories} merchants={merchants} patterns={patterns} fechamentosFatura={fechamentosFatura} hidden={hidden} seguro={seguro} showConferido onToggleConferido={onToggleConferido} onApprove={onApprove} onRevert={onRevert} onRemove={onRemove} />
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

function DisplayRow({ tx, categories, merchants, patterns, fechamentosFatura, hidden, seguro, showYear, showBanco, showConferido, onToggleConferido, onApprove, onRevert, onRemove }) {
  const [editing, setEditing] = useState(false);
  const [revealed, setRevealed] = useState(false);
  const merch = merchants.find((m) => m.id === tx.merchantId);
  const cat = categories.find((c) => c.id === tx.categoryId);
  const nomeExibido = merch?.name || tx.estabelecimento;
  const ehPix = !!tx.pixCredito;

  if (editing) {
    return (
      <ApprovalRow
        tx={tx}
        categories={categories}
        merchants={merchants}
        patterns={patterns}
        fechamentosFatura={fechamentosFatura}
        hidden={hidden}
        seguro={seguro}
        mode="editing"
        onApprove={(t, payload) => { onApprove(t, payload); setEditing(false); }}
        onCancel={() => setEditing(false)}
        onRevert={(id) => { onRevert(id); setEditing(false); }}
      />
    );
  }

  return (
    <div className={"tx-row" + (showBanco ? " tx-row-banco" : "") + (showConferido ? " tx-row-conferido" : "")}>
      <span className="tx-cell">{tx.data.slice(8, 10)}/{tx.data.slice(5, 7)}/{tx.data.slice(2, 4)}</span>
      {showBanco && <span className="tx-cell"><Mask value={displayBanco(tx.banco)} active={seguro} /></span>}
      <span className="tx-cell tx-cell-estab" title={seguro ? "" : nomeExibido}>
        <MaskText value={nomeExibido} active={seguro} show={revealed} />
        {ehPix && <span className="pix-badge" title="Pix no Crédito">Pix no Crédito</span>}
      </span>
      <span className="tx-cell" title={seguro ? "" : (cat?.name || "")}><MaskText value={cat?.name || "—"} active={seguro} show={revealed} /></span>
      <span className="tx-cell">{competencia(tx, fechamentosFatura)}</span>
      <span className="tx-cell">{tx.parcelaAtual}/{tx.parcelaTotal}</span>
      <span className="tx-cell tx-cell-mono"><MaskText value={currency(tx.valor * tx.parcelaTotal)} active={hidden} show={revealed} mono /></span>
      <span className="tx-cell tx-cell-mono"><MaskText value={currency(tx.valor)} active={hidden} show={revealed} mono /></span>
      {(hidden || seguro) ? <RevealButton onHoldChange={setRevealed} small /> : <span />}
      <button className="ledger-remove" onClick={() => setEditing(true)} aria-label="Editar" title="Editar sem voltar pra pendentes"><Pencil size={14} /></button>
      <button className="ledger-remove" onClick={() => onRemove(tx.id)} aria-label="Excluir" title="Excluir permanentemente"><X size={14} /></button>
      {showConferido && (
        <input
          type="checkbox"
          className="conferido-check"
          checked={!!tx.conferido}
          onChange={(e) => onToggleConferido(tx.id, e.target.checked)}
          title="Já conferi com a fatura original"
        />
      )}
    </div>
  );
}

function ApprovalRow({ tx, categories, merchants, patterns, fechamentosFatura, allTransactions = [], hidden, seguro, onApprove, onIgnore, mode = "pending", onCancel, onRevert }) {
  const [merchantName, setMerchantName] = useState("");
  const [pixCredito, setPixCredito] = useState(false);
  const [categoryId, setCategoryId] = useState(categories[0]?.id);
  const [banco, setBanco] = useState(tx.banco);
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
    if (t.banco !== banco) return false;
    if (competencia(t, fechamentosFatura) !== fatura) return false;
    const m = merchants.find((mm) => mm.id === t.merchantId);
    if (!m || m.name.trim().toLowerCase() !== merchantName.trim().toLowerCase()) return false;
    if (t.categoryId !== categoryId) return false;
    if (!!t.pixCredito !== pixCredito) return false;
    return Math.abs(t.valor - valorMesNum) <= 0.5;
  });

  useEffect(() => {
    const isBradesco = tx.banco === "Bradesco";
    const isPixRaw = !isBradesco && /^pix no cr[éÃ]©?dito\s*-/i.test(tx.estabelecimento.trim());

    if (tx.merchantId) {
      const m = merchants.find((mm) => mm.id === tx.merchantId);
      if (m) {
        setMerchantName(m.name);
        setCategoryId(tx.categoryId || m.categoryId || categories[0]?.id);
        setPixCredito(!!tx.pixCredito); // já aprovada — usa o valor real gravado nela
        return;
      }
    }
    const patMatch = matchPattern(patterns, tx.estabelecimento);
    if (patMatch) {
      const m = merchants.find((mm) => mm.id === patMatch.merchantId);
      if (m) {
        setMerchantName(m.name);
        if (m.categoryId) setCategoryId(m.categoryId);
        // pendente nova: Pix é por transação, não por estabelecimento — não herda do histórico
        setPixCredito(isPixRaw);
        return;
      }
    }
    const alvo = tx.estabelecimento.toLowerCase();
    const guess = merchants.find((m) => alvo.includes(m.name.toLowerCase()));
    if (guess) {
      setMerchantName(guess.name);
      if (guess.categoryId) setCategoryId(guess.categoryId);
      setPixCredito(isPixRaw);
    } else {
      const cleaned = stripParcela(tx.estabelecimento).replace(/^pix no cr[éÃ]©?dito\s*-\s*/i, "").trim();
      const looksPerson = !isBradesco && looksLikePersonName(cleaned);
      setPixCredito(isPixRaw || looksPerson);
      setMerchantName(titleCase(cleaned));
      const dica = ESTABELECIMENTOS_CONHECIDOS.find((d) => d.match.test(tx.estabelecimento));
      if (dica) {
        const cat = categories.find((c) => c.name === dica.categoryName);
        if (cat) setCategoryId(cat.id);
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleMerchantChange = (value) => {
    setMerchantName(value);
    const match = merchants.find((m) => m.name.toLowerCase() === value.trim().toLowerCase());
    if (match?.categoryId) setCategoryId(match.categoryId);
  };

  const submit = () => {
    onApprove(tx, {
      merchantName: merchantName.trim(), categoryId,
      competenciaOverride: fatura !== faturaAutomatica ? fatura : null,
      parcelaAtual, parcelaTotal, valor: valorMesNum, data, pixCredito, banco,
    });
  };

  return (
    <div className={mode === "editing" ? "approval-card approval-card-editing" : "approval-card"}>
      {possiveisDuplicatas.length > 0 && (
        <div className="duplicate-warning">
          <div className="duplicate-warning-head">
            <AlertTriangle size={13} color="var(--warn)" />
            <span>Parecido com {possiveisDuplicatas.length} lançamento{possiveisDuplicatas.length > 1 ? "s" : ""} já aprovado{possiveisDuplicatas.length > 1 ? "s" : ""} nesta mesma fatura:</span>
            <button className="ignore-link" onClick={() => onIgnore(tx.id)}>Excluir transação pendente</button>
          </div>
          <div className="duplicate-warning-list">
            {possiveisDuplicatas.map((d) => {
              const dMerch = merchants.find((m) => m.id === d.merchantId);
              const dCat = categories.find((c) => c.id === d.categoryId);
              return (
                <div key={d.id} className="duplicate-warning-item">
                  <span className="tx-date">{d.data.slice(8, 10)}/{d.data.slice(5, 7)}</span>
                  <span><Mask value={displayBanco(d.banco)} active={seguro} /></span>
                  <span><Mask value={dMerch?.name || d.estabelecimento} active={seguro} /></span>
                  <span><Mask value={dCat?.name || "—"} active={seguro} /></span>
                  <span>{competencia(d, fechamentosFatura)}</span>
                  <span>parc. {d.parcelaAtual}/{d.parcelaTotal}</span>
                  <span className="tx-valor-total"><Mask value={currency(d.valor * d.parcelaTotal)} active={hidden} mono /></span>
                  <span className="tx-valor-total"><Mask value={currency(d.valor)} active={hidden} mono /></span>
                </div>
              );
            })}
          </div>
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
          <span className="tx-raw-hint" title={seguro ? "" : tx.estabelecimento}><Mask value={tx.estabelecimento} active={seguro} /></span>
          {tx.paymentData && (
            <span className="tx-raw-hint" style={{ color: "var(--gold)" }} title={JSON.stringify(tx.paymentData)}>
              paymentData: {JSON.stringify(tx.paymentData)}
            </span>
          )}
          {banco !== "Bradesco" && (
            <label className="checkbox" style={{ marginTop: 3 }}>
              <input type="checkbox" checked={pixCredito} onChange={(e) => setPixCredito(e.target.checked)} />
              Pix no Crédito
            </label>
          )}
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
          <label>Cartão</label>
          <span className="tx-valor-total">{displayBanco(banco)}</span>
        </div>
        <div className="approval-field">
          <label>Fatura</label>
          <input className="tx-input" type="month" value={fatura} onChange={(e) => setFatura(e.target.value)} title="Fatura em que essa transação será lançada" />
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
          <span className="tx-valor-total"><Mask value={currency(valorMesNum)} active={hidden} mono /></span>
        </div>
        <div className="approval-field">
          <label>Valor Total</label>
          <span className="tx-valor-total"><Mask value={currency(valorMesNum * parcelaTotal)} active={hidden} mono /></span>
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

function ImportModal({ categories, bancos, tipos, userId, onClose, onImported, setError }) {
  const [modo, setModo] = useState("pendente"); // "pendente" | "categorizado"
  const [linhas, setLinhas] = useState(null); // null = nada carregado ainda
  const [nomeArquivo, setNomeArquivo] = useState("");
  const [erroLeitura, setErroLeitura] = useState("");
  const [importando, setImportando] = useState(false);

  const norm = (s) => (s || "").toString().trim().toLowerCase();

  const acharCampo = (row, ...nomes) => {
    for (const key of Object.keys(row)) {
      if (nomes.includes(norm(key))) return row[key];
    }
    return "";
  };

  const parseParcelamentoCampo = (v) => {
    const s = (v || "").toString().trim();
    const m = s.match(/(\d+)\s*\/\s*(\d+)/);
    if (m) return { atual: parseInt(m[1], 10), total: parseInt(m[2], 10) };
    const n = parseInt(s, 10);
    if (n > 1) return { atual: 1, total: n };
    return { atual: 1, total: 1 };
  };

  const parseValorCampo = (v) => {
    if (typeof v === "number") return v;
    const s = (v || "").toString().replace(/[R$\s]/g, "").replace(/\.(?=\d{3}(\D|$))/g, "").replace(",", ".");
    return parseFloat(s) || 0;
  };

  const parseDataCampo = (v) => {
    if (v instanceof Date) return v.toISOString().slice(0, 10);
    const s = (v || "").toString().trim();
    const br = s.match(/^(\d{1,2})[\/-](\d{1,2})[\/-](\d{2,4})$/);
    if (br) {
      const [, d, m, y] = br;
      const ano = y.length === 2 ? `20${y}` : y;
      return `${ano}-${m.padStart(2, "0")}-${d.padStart(2, "0")}`;
    }
    if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10);
    return "";
  };

  const acharBanco = (v) => {
    const s = norm(v);
    return bancos.find((b) => norm(displayBanco(b)) === s || norm(b) === s) || null;
  };

  const acharCategoria = (v) => {
    const s = norm(v);
    return categories.find((c) => norm(c.name) === s) || null;
  };

  const montarLinha = (i, { data, estabelecimento, banco, parcelaAtual, parcelaTotal, valorMes, categoriaRaw }) => {
    const cat = categoriaRaw ? acharCategoria(categoriaRaw) : null;
    const erros = [];
    if (!data) erros.push("data inválida");
    if (!estabelecimento) erros.push("sem estabelecimento");
    if (modo === "categorizado" && !cat) erros.push(`categoria "${categoriaRaw || ""}" não encontrada`);
    if (!banco) erros.push(`cartão não encontrado`);
    if (!valorMes) erros.push("valor inválido");
    return { linha: i, data, estabelecimento, categoryId: cat?.id, categoriaNome: cat?.name, banco, parcelaAtual, parcelaTotal, valorMes, erros };
  };

  // Fatura da Nubank exportada em CSV (colunas: date, title, amount).
  // "Pagamento recebido" não é transação (é a quitação da fatura); "Crédito de "X"" é estorno
  // (o valor já vem negativo); "X - Parcela N/M" tem o parcelamento embutido no texto.
  const parseNubankCSV = async (file) => {
    const Papa = await import("https://cdn.jsdelivr.net/npm/papaparse@5.4.1/+esm");
    const text = await file.text();
    const { data: registros } = Papa.parse(text.trim(), { header: true, skipEmptyLines: true });
    const linhas = [];
    let i = 2;
    for (const r of registros) {
      const desc = (r.title || "").trim();
      if (!desc || /^pagamento recebido$/i.test(desc)) { i++; continue; }
      let estabelecimento = desc;
      const credMatch = desc.match(/^cr[ée]dito de\s*"?(.+?)"?$/i);
      if (credMatch) estabelecimento = credMatch[1];
      let parcelaAtual = 1, parcelaTotal = 1;
      const parcMatch = estabelecimento.match(/^(.*?)\s*-\s*parcela\s*(\d+)\/(\d+)\s*$/i);
      if (parcMatch) { estabelecimento = parcMatch[1].trim(); parcelaAtual = parseInt(parcMatch[2], 10); parcelaTotal = parseInt(parcMatch[3], 10); }
      const valorMes = parseValorCampo(r.amount);
      linhas.push(montarLinha(i, { data: parseDataCampo(r.date), estabelecimento, banco: "Nubank", parcelaAtual, parcelaTotal, valorMes }));
      i++;
    }
    return linhas;
  };

  // Fatura do Bradesco em PDF: extrai o texto e reconhece linhas no formato
  // "dd/mm Descrição ... valor[,] [-]" — usa dois cartões (só nos importa saber que é Bradesco).
  const parseBradescoPDF = async (file) => {
    const pdfjsLib = await import("https://cdn.jsdelivr.net/npm/pdfjs-dist@3.11.174/+esm");
    pdfjsLib.GlobalWorkerOptions.workerSrc = "https://cdn.jsdelivr.net/npm/pdfjs-dist@3.11.174/build/pdf.worker.min.mjs";
    const buf = await file.arrayBuffer();
    const pdf = await pdfjsLib.getDocument({ data: buf }).promise;
    let linhasTexto = [];
    for (let p = 1; p <= pdf.numPages; p++) {
      const page = await pdf.getPage(p);
      const content = await page.getTextContent();
      // agrupa por posição vertical (y) pra reconstruir as linhas da tabela
      const porLinha = {};
      for (const item of content.items) {
        const y = Math.round(item.transform[5]);
        if (!porLinha[y]) porLinha[y] = [];
        porLinha[y].push(item);
      }
      const ys = Object.keys(porLinha).map(Number).sort((a, b) => b - a);
      for (const y of ys) {
        const texto = porLinha[y].sort((a, b) => a.transform[4] - b.transform[4]).map((it) => it.str).join(" ").replace(/\s+/g, " ").trim();
        if (texto) linhasTexto.push(texto);
      }
    }
    const linhas = [];
    let i = 2;
    const anoAtual = new Date().getFullYear();
    for (const texto of linhasTexto) {
      const m = texto.match(/^(\d{2})\/(\d{2})\s+(.+?)\s+([\d.,]+)\s*(-)?\s*$/);
      if (!m) continue;
      const [, dd, mm, meio, valorStr] = m;
      const negativo = !!m[5];
      if (/pagto\.?\s*por\s*deb/i.test(meio) || /pagamento recebido/i.test(meio)) { continue; }
      if (/^n[uú]mero do cart[ãa]o/i.test(meio) || /^total (para|da fatura)/i.test(meio)) continue;
      // tira a cidade do final (normalmente 1-3 palavras em maiúsculas antes do valor) — fica como veio se não der pra separar
      let estabelecimento = meio.replace(/\s+(RIO DE JANEIR[O]?|SAO PAULO|S[ÃA]O PAULO|SO PAULO|[A-ZÀ-Ú.]{3,20})$/u, "").trim() || meio;
      const parcMatch = estabelecimento.match(/^(.*?)\s+(\d{1,2})\/(\d{1,2})$/);
      let parcelaAtual = 1, parcelaTotal = 1;
      if (parcMatch && parseInt(parcMatch[3], 10) > 1) { estabelecimento = parcMatch[1].trim(); parcelaAtual = parseInt(parcMatch[2], 10); parcelaTotal = parseInt(parcMatch[3], 10); }
      const valorNum = parseValorCampo(valorStr) * (negativo ? -1 : 1);
      // sem o ano explícito na fatura — assume o ano corrente; ajuste manual se cair em dez/jan de virada
      const data = `${anoAtual}-${mm}-${dd}`;
      linhas.push(montarLinha(i, { data, estabelecimento, banco: "Bradesco", parcelaAtual, parcelaTotal, valorMes: valorNum }));
      i++;
    }
    return linhas;
  };

  const handleFile = async (file) => {
    setErroLeitura("");
    setNomeArquivo(file.name);
    try {
      const ext = file.name.split(".").pop().toLowerCase();
      let processadas;
      if (ext === "pdf") {
        processadas = await parseBradescoPDF(file);
      } else if (ext === "csv") {
        const inicio = (await file.slice(0, 200).text()).toLowerCase();
        if (inicio.includes("date") && inicio.includes("title") && inicio.includes("amount")) {
          processadas = await parseNubankCSV(file);
        } else {
          processadas = await parseGenericSheet(file);
        }
      } else {
        processadas = await parseGenericSheet(file);
      }
      setLinhas(processadas);
    } catch (e) {
      setErroLeitura("Não consegui ler esse arquivo: " + e.message);
    }
  };

  const parseGenericSheet = async (file) => {
    const XLSX = await import("https://cdn.jsdelivr.net/npm/xlsx@0.18.5/+esm");
    const buf = await file.arrayBuffer();
    const wb = XLSX.read(buf, { type: "array", cellDates: true });
    const sheet = wb.Sheets[wb.SheetNames[0]];
    const rows = XLSX.utils.sheet_to_json(sheet, { defval: "" });
    return rows.map((row, i) => {
      const data = parseDataCampo(acharCampo(row, "data"));
      const estabelecimento = (acharCampo(row, "estabelecimento") || "").toString().trim();
      const categoriaRaw = acharCampo(row, "categoria");
      const cartaoRaw = acharCampo(row, "cartão", "cartao");
      const banco = acharBanco(cartaoRaw);
      const parc = parseParcelamentoCampo(acharCampo(row, "parcelamento"));
      const valorTotalRaw = acharCampo(row, "valor total");
      const valorMesRaw = acharCampo(row, "valor por mês", "valor por mes", "valor/mês", "valor mês");
      let valorMes = parseValorCampo(valorMesRaw);
      const valorTotal = parseValorCampo(valorTotalRaw);
      if (!valorMes && valorTotal) valorMes = valorTotal / (parc.total || 1);
      return montarLinha(i + 2, { data, estabelecimento, banco, parcelaAtual: parc.atual, parcelaTotal: parc.total, valorMes, categoriaRaw });
    });
  };

  const validas = (linhas || []).filter((l) => l.erros.length === 0);
  const invalidas = (linhas || []).filter((l) => l.erros.length > 0);

  const confirmar = async () => {
    setImportando(true);
    try {
      if (modo === "pendente") {
        // entra cru, igual chegaria da Pluggy — a sugestão de nome/categoria acontece
        // normalmente quando você for aprovar cada uma
        const rows = validas.map((l) => ({
          data: l.data,
          estabelecimento: l.estabelecimento,
          valor: l.valorMes,
          tipo: "Crédito",
          banco: l.banco,
          user_id: userId,
          status: "pendente_estabelecimento",
          category_id: null,
          merchant_id: null,
          parcela_atual: l.parcelaAtual,
          parcela_total: l.parcelaTotal,
        }));
        const { data: inseridas, error } = await supabase.from("transactions").insert(rows).select();
        if (error) { setError(error.message); setImportando(false); return; }
        onImported(inseridas || []);
        return;
      }
      // resolve/upsert um estabelecimento por vez (nomes distintos), pra pegar o id de cada merchant
      const nomesUnicos = [...new Set(validas.map((l) => titleCase(l.estabelecimento)))];
      const merchantIdPorNome = {};
      for (const nome of nomesUnicos) {
        const catId = validas.find((l) => titleCase(l.estabelecimento) === nome)?.categoryId;
        const { data: m, error: mErr } = await supabase
          .from("merchants")
          .upsert({ name: nome, category_id: catId, user_id: userId }, { onConflict: "name,user_id" })
          .select()
          .single();
        if (mErr) { setError(mErr.message); setImportando(false); return; }
        merchantIdPorNome[nome] = m.id;
      }
      const rows = validas.map((l) => ({
        data: l.data,
        estabelecimento: titleCase(l.estabelecimento),
        valor: l.valorMes,
        tipo: "Crédito",
        banco: l.banco,
        user_id: userId,
        status: "categorizado",
        category_id: l.categoryId,
        merchant_id: merchantIdPorNome[titleCase(l.estabelecimento)],
        parcela_atual: l.parcelaAtual,
        parcela_total: l.parcelaTotal,
      }));
      const { data: inseridas, error } = await supabase.from("transactions").insert(rows).select();
      if (error) { setError(error.message); setImportando(false); return; }
      onImported(inseridas || []);
    } finally {
      setImportando(false);
    }
  };

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head"><h3>Importar fatura</h3><button onClick={onClose}><X size={18} /></button></div>
        <div className="import-mode-toggle">
          <label><input type="radio" checked={modo === "pendente"} onChange={() => { setModo("pendente"); setLinhas(null); }} /> Como pendente (revisar depois, com sugestão automática)</label>
          <label><input type="radio" checked={modo === "categorizado"} onChange={() => { setModo("categorizado"); setLinhas(null); }} /> Já categorizado (a planilha já tem a categoria certa)</label>
        </div>
        <p className="modal-hint">
          Reconhece direto: fatura em <strong>PDF do Bradesco</strong>, extrato em <strong>CSV da Nubank</strong> (exportado pelo app do banco), ou planilha própria.
        </p>
        <p className="modal-hint">
          {modo === "pendente"
            ? "Planilha própria — colunas esperadas: Data, Estabelecimento, Cartão, Parcelamento (ex: 1/12), Valor por Mês (Categoria e Valor Total são ignorados aqui)."
            : "Planilha própria — colunas esperadas: Data, Estabelecimento, Categoria, Cartão, Parcelamento (ex: 1/12), Valor Total, Valor por Mês."}
        </p>
        <input type="file" accept=".xlsx,.xls,.csv,.pdf" onChange={(e) => e.target.files[0] && handleFile(e.target.files[0])} />
        {erroLeitura && <p style={{ color: "var(--warn)", fontSize: 12 }}>{erroLeitura}</p>}
        {linhas && (
          <>
            <p className="modal-hint">
              {nomeArquivo}: {validas.length} linha(s) prontas pra importar{invalidas.length > 0 ? `, ${invalidas.length} com problema` : ""}.
            </p>
            {invalidas.length > 0 && (
              <div className="import-errors">
                {invalidas.map((l) => (
                  <div key={l.linha} className="import-error-row">Linha {l.linha}: {l.erros.join(", ")}</div>
                ))}
              </div>
            )}
            <button className="submit-btn" disabled={validas.length === 0 || importando} onClick={confirmar}>
              {importando ? "Importando…" : `Importar ${validas.length} transação(ões)`}
            </button>
          </>
        )}
      </div>
    </div>
  );
}

function AddRawModal({ tipos, bancos, categories, fechamentosFatura, onClose, onSave }) {
  const today = new Date().toISOString().slice(0, 10);
  const [data, setData] = useState(today);
  const [estabelecimento, setEstabelecimento] = useState("");
  const [categoryId, setCategoryId] = useState(categories[0]?.id || "");
  const [tipo, setTipo] = useState(tipos[0]);
  const [banco, setBanco] = useState(bancos[0]);
  const [fatura, setFatura] = useState(monthKey(new Date()));
  const [parcelaAtual, setParcelaAtual] = useState(1);
  const [parcelaTotal, setParcelaTotal] = useState(1);
  const [valorTotal, setValorTotal] = useState("");
  const [valorMes, setValorMes] = useState("");

  const onChangeValorTotal = (v) => {
    setValorTotal(v);
    const num = parseFloat(v.replace(",", "."));
    if (!isNaN(num) && parcelaTotal > 0) setValorMes((num / parcelaTotal).toFixed(2).replace(".", ","));
  };
  const onChangeValorMes = (v) => {
    setValorMes(v);
    const num = parseFloat(v.replace(",", "."));
    if (!isNaN(num)) setValorTotal((num * parcelaTotal).toFixed(2).replace(".", ","));
  };
  const onChangeParcelaTotal = (n) => {
    setParcelaTotal(n);
    const mesNum = parseFloat(valorMes.replace(",", "."));
    if (!isNaN(mesNum)) setValorTotal((mesNum * n).toFixed(2).replace(".", ","));
  };

  const submit = (e) => {
    e.preventDefault();
    if (!estabelecimento || !valorMes || !categoryId) return;
    onSave({
      data, estabelecimento, valor: valorMes.replace(",", "."), tipo, banco,
      categoryId, competenciaOverride: fatura, parcelaAtual, parcelaTotal,
    });
  };

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <form className="modal" onClick={(e) => e.stopPropagation()} onSubmit={submit}>
        <div className="modal-head"><h3>Nova transação</h3><button type="button" onClick={onClose}><X size={18} /></button></div>
        <label>Data<input type="date" value={data} onChange={(e) => setData(e.target.value)} required /></label>
        <label>Estabelecimento<input type="text" placeholder="Ex: IFOOD, SMARTFIT, COELBA" value={estabelecimento} onChange={(e) => setEstabelecimento(e.target.value)} required /></label>
        <label>Categoria
          <select value={categoryId} onChange={(e) => setCategoryId(e.target.value)} required>
            {categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        </label>
        <label>Tipo
          <select value={tipo} onChange={(e) => setTipo(e.target.value)}>
            {tipos.map((t) => <option key={t} value={t}>{t}</option>)}
          </select>
        </label>
        <label>Cartão
          <select value={banco} onChange={(e) => setBanco(e.target.value)}>
            {bancos.map((b) => <option key={b} value={b}>{displayBanco(b)}</option>)}
          </select>
        </label>
        <label>Fatura<input type="month" value={fatura} onChange={(e) => setFatura(e.target.value)} required /></label>
        <label>Parcelamento
          <span className="tx-parcela-edit" style={{ justifyContent: "flex-start" }}>
            <input className="tx-parcela-input" type="number" min="1" value={parcelaAtual} onFocus={(e) => e.target.select()} onChange={(e) => setParcelaAtual(parseInt(e.target.value) || 1)} />
            <span>/</span>
            <input className="tx-parcela-input" type="number" min="1" value={parcelaTotal} onFocus={(e) => e.target.select()} onChange={(e) => onChangeParcelaTotal(parseInt(e.target.value) || 1)} />
          </span>
        </label>
        <label>Valor Total (R$)<input type="text" inputMode="decimal" placeholder="0,00" value={valorTotal} onChange={(e) => onChangeValorTotal(e.target.value)} /></label>
        <label>Valor / mês (R$)<input type="text" inputMode="decimal" placeholder="0,00" value={valorMes} onChange={(e) => onChangeValorMes(e.target.value)} required /></label>
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
              <option value="Nubank">NuBank</option>
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
              <span>{displayBanco(f.banco)} · {f.competencia}</span>
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
      .app { background: var(--bg); color: var(--text); font-family: 'IBM Plex Sans', Inter, sans-serif; padding: 28px 20px 60px; max-width: 720px; margin: 0 auto; min-height: 100vh; overflow-x: hidden; box-sizing: border-box; }
      .header { display: flex; justify-content: space-between; align-items: flex-end; margin-bottom: 18px; flex-wrap: wrap; gap: 12px; }
      .eyebrow { font-size: 11px; letter-spacing: 0.12em; text-transform: uppercase; color: var(--muted); margin: 0 0 4px; }
      h1 { font-family: 'Fraunces', Georgia, serif; font-size: 28px; margin: 0; font-weight: 600; }
      .header-actions { display: flex; align-items: center; gap: 10px; }
      .privacy-controls { display: flex; gap: 6px; }
      .privacy-btn.active { color: var(--gold); border-color: var(--gold); }
      .mask-wrap { display: inline-flex; align-items: center; gap: 3px; user-select: none; -webkit-user-select: none; touch-action: none; }
      .mask-text { letter-spacing: 1px; }
      .mask-text.mono { font-family: 'IBM Plex Mono', monospace; }
      .mask-peek { background: none; border: none; color: var(--muted); cursor: pointer; padding: 2px; display: inline-flex; user-select: none; -webkit-user-select: none; touch-action: none; }
      .mask-peek:hover { color: var(--text); }
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
      .subview-tabs { display: flex; align-items: center; gap: 8px; margin-bottom: 14px; }
      .subtab-btn { background: none; border: 1px solid var(--line); color: var(--muted); border-radius: 999px; padding: 5px 12px; font-size: 12px; cursor: pointer; }
      .subtab-btn.active { background: var(--surface-2); color: var(--text); border-color: var(--ok); font-weight: 600; }
      .reset-btn { display: flex; align-items: center; gap: 4px; margin-left: auto; color: var(--warn); border-color: var(--warn); }
      .tab-btn { background: var(--surface); border: 1px solid var(--line); color: var(--muted); border-radius: 999px; padding: 8px 16px; font-size: 13px; cursor: pointer; }
      .tab-btn.active { background: var(--surface-2); color: var(--text); border-color: var(--gold); font-weight: 600; }
      .checkbox { display: flex; align-items: center; gap: 5px; font-size: 12px; color: var(--muted); }
      .confirm-btn { background: var(--ok); border: none; border-radius: 999px; padding: 6px; display: flex; cursor: pointer; color: #0F1613; }
      .confirm-btn:disabled { opacity: 0.5; cursor: default; }
      .bank-group { background: var(--surface); border: 1px solid var(--line); border-radius: 14px; padding: 18px; margin-bottom: 20px; box-sizing: border-box; }
      .fatura-summary { display: flex; gap: 18px; flex-wrap: wrap; font-size: 12px; color: var(--muted); margin: 4px 0 14px; padding-bottom: 12px; border-bottom: 1px solid var(--line); }
      .fatura-summary strong { color: var(--text); font-family: 'IBM Plex Mono', monospace; margin-left: 4px; }
      .tx-subhead { font-size: 12px; color: var(--muted); text-transform: uppercase; letter-spacing: 0.05em; margin: 16px 0 6px; }
      .tx-subhead-row { display: flex; align-items: center; justify-content: space-between; margin: 16px 0 6px; flex-wrap: wrap; gap: 8px; }
      .tx-subhead-row .tx-subhead { margin: 0; }
      .filter-row { display: flex; gap: 6px; flex-wrap: wrap; }
      .multi-filter { position: relative; }
      .multi-filter-panel { position: absolute; top: calc(100% + 4px); left: 0; right: auto; z-index: 30; background: var(--surface-2); border: 1px solid var(--line); border-radius: 8px; padding: 8px; width: max-content; min-width: 140px; max-width: min(220px, 80vw); max-height: 220px; overflow-y: auto; display: grid; gap: 4px; box-shadow: 0 8px 24px rgba(0,0,0,0.4); }
      .multi-filter-actions { display: flex; justify-content: space-between; padding-bottom: 4px; border-bottom: 1px dashed var(--line); margin-bottom: 4px; }
      .multi-filter-option { display: flex; align-items: center; gap: 6px; font-size: 12px; color: var(--text); white-space: nowrap; }
      .filter-select { background: var(--surface-2); border: 1px solid var(--line); border-radius: 999px; padding: 4px 10px; color: var(--muted); font-size: 11px; font-family: inherit; }
      .filter-input { background: var(--surface-2); border: 1px solid var(--line); border-radius: 999px; padding: 4px 10px; color: var(--text); font-size: 11px; font-family: inherit; width: 120px; }
      .pendentes-cards { display: grid; gap: 10px; }
      .approval-card { background: rgba(201,162,75,0.08); border: 1px solid var(--gold); border-radius: 10px; padding: 12px; display: grid; gap: 10px; }
      .approval-card-editing { background: rgba(95,163,119,0.08); border-color: var(--ok); }
      .duplicate-warning { background: rgba(193,97,61,0.15); border: 1px solid var(--warn); border-radius: 8px; padding: 8px 10px; font-size: 12px; color: var(--warn); }
      .duplicate-warning-head { display: flex; align-items: center; gap: 8px; }
      .duplicate-warning-list { display: grid; gap: 3px; margin-top: 6px; padding-top: 6px; border-top: 1px dashed var(--warn); }
      .duplicate-warning-item { display: flex; flex-wrap: wrap; align-items: center; gap: 4px 10px; font-size: 11px; color: var(--text); padding: 3px 0; }
      .approval-top { display: flex; gap: 10px; align-items: flex-start; }
      .approval-bottom { display: flex; gap: 10px; align-items: flex-end; flex-wrap: wrap; }
      .approval-field { display: flex; flex-direction: column; gap: 3px; min-width: 0; }
      .approval-field label { font-size: 10px; color: var(--muted); text-transform: uppercase; letter-spacing: 0.04em; }
      .approval-field-grow { flex: 1; }
      .approval-field-parcela { min-width: 70px; }
      .approval-actions { display: flex; gap: 6px; margin-left: auto; align-items: center; }
      .tx-valor-total { font-family: 'IBM Plex Mono', monospace; font-weight: 600; font-size: 13px; padding: 6px 0; display: block; }
      .tx-list { display: grid; gap: 2px; }
      .tx-row { display: grid; grid-template-columns: 58px 1.5fr 1fr 0.7fr 0.6fr 0.8fr 0.8fr 18px 18px 18px; align-items: center; gap: 4px; padding: 7px 0; border-bottom: 1px dashed var(--line); font-size: 11px; min-width: 0; }
      .tx-row-banco { grid-template-columns: 58px 64px 1.4fr 1fr 0.7fr 0.6fr 0.8fr 0.8fr 18px 18px 18px; }
      .tx-row-conferido { grid-template-columns: 58px 1.5fr 1fr 0.7fr 0.6fr 0.8fr 0.8fr 18px 18px 18px 20px; }
      .conferido-check { width: 15px; height: 15px; cursor: pointer; justify-self: center; }
      .pix-badge { font-size: 8px; text-transform: uppercase; letter-spacing: 0.03em; background: rgba(201,162,75,0.18); color: var(--gold); border-radius: 4px; padding: 1px 4px; margin-left: 5px; vertical-align: middle; }
      .tx-row-head { border-bottom: 1px solid var(--line); padding-bottom: 8px; margin-bottom: 2px; }
      .tx-cell { text-align: center; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; min-width: 0; }
      .tx-cell-estab { font-weight: 500; text-align: left; }
      .tx-cell-mono { font-family: 'IBM Plex Mono', monospace; }
      .tx-head-btn { background: none; border: none; color: var(--muted); font-size: 9px; text-transform: uppercase; letter-spacing: 0.03em; cursor: pointer; padding: 0; font-family: inherit; text-align: center; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; min-width: 0; }
      .tx-head-btn:hover { color: var(--text); }
      .tx-head-btn-left { text-align: left; }
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
      .search-result-row { display: flex; flex-wrap: wrap; align-items: center; gap: 8px 10px; padding: 7px 4px; border-radius: 6px; border: none; background: none; color: var(--text); font-size: 12px; font-family: inherit; text-align: left; cursor: pointer; width: 100%; }
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
      .import-mode-toggle { display: flex; flex-direction: column; gap: 6px; font-size: 12px; color: var(--text); background: var(--surface-2); border-radius: 8px; padding: 8px 10px; }
      .import-errors { max-height: 140px; overflow-y: auto; background: rgba(193,97,61,0.08); border: 1px solid var(--warn); border-radius: 8px; padding: 8px; }
      .import-error-row { font-size: 11px; color: var(--warn); padding: 2px 0; }
      .modal label { display: grid; gap: 6px; font-size: 12px; color: var(--muted); }
      .modal input, .modal select { background: var(--surface-2); border: 1px solid var(--line); border-radius: 8px; padding: 9px 10px; color: var(--text); font-size: 14px; font-family: inherit; }
      .submit-btn { background: var(--gold); color: #0F1613; border: none; border-radius: 999px; padding: 10px; font-weight: 600; cursor: pointer; margin-top: 4px; }
      .rules-list { display: grid; gap: 6px; max-height: 160px; overflow-y: auto; }
      .rule-row { display: flex; align-items: center; justify-content: space-between; gap: 8px; font-size: 12px; padding: 4px 0; border-bottom: 1px dashed var(--line); }
    `}</style>
  );
}
