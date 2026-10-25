"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useJobs } from "@/components/jobs/use-jobs";
import { Markdown } from "@/components/chat/markdown";
import { VoiceMode } from "@/components/chat/voice-mode";
import { CHAT_AGENTS } from "@/lib/agents/catalog";
import { modeCommand, viewCommand, type ViewCommand } from "@/lib/friday/intent";
import { VIEWS } from "@/lib/friday/plan";
import type { PartInfo } from "@/lib/friday/viewer-core";
import type { ProjectView } from "@/lib/friday/projects";
import type { Output3D } from "@/lib/friday/gesture3d";
import { FridayViewer, type ViewerHandle } from "./viewer";
import { useHandControl } from "./use-hand-control";
import { CSS } from "./styles";

/**
 * FRIDAY. Default: a normal chatbot ("PROJECT: FRIDAY"). The exact command
 * "activate agentic view" (or a natural equivalent) opens the full-screen 3D
 * workspace; "deactivate agentic view" comes back — the conversation, project,
 * version and viewer state are kept either way. Mode switches never go to the AI.
 */

type Msg = { id: string; role: "user" | "assistant"; content: string; status: "done" | "streaming" | "error"; tools?: { status: string; summary: string }[]; local?: boolean };
type Log = { id: string; at: string; text: string; kind: "info" | "ok" | "error" | "cmd" | "friday" };
type ProjectRow = { id: string; name: string; activeVersion: number; latest: { n: number; status: string; label: string | null } | null; updatedAt: string; thumb: string | null };
type Version = ProjectView["versions"][number];
type Panel = null | "new" | "open" | "library" | "gallery" | "components" | "gestures" | "export";

const uid = () => Math.random().toString(36).slice(2, 10);
const now = () => new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
const FRIDAY = CHAT_AGENTS.friday;

export function FridayApp() {
  const params = useSearchParams();
  const router = useRouter();
  const [mode, setMode] = useState<"chat" | "agentic">(params.get("view") === "agentic" ? "agentic" : "chat");
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [busy, setBusy] = useState(false);
  const [input, setInput] = useState("");
  const [logs, setLogs] = useState<Log[]>([]);
  const [projects, setProjects] = useState<ProjectRow[]>([]);
  const [projectId, setProjectId] = useState<string | null>(params.get("project"));
  const [project, setProject] = useState<ProjectView | null>(null);
  const [vn, setVn] = useState<number | null>(Number(params.get("v")) || null);
  const [compareN, setCompareN] = useState<number | null>(Number(params.get("compare")) || null);
  const [panel, setPanel] = useState<Panel>(null);
  const [parts, setParts] = useState<PartInfo[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [blender, setBlender] = useState<{ version: string | null } | null | undefined>(undefined);
  const [blenderHint, setBlenderHint] = useState("");
  const [voice, setVoice] = useState(false);
  const [lightbox, setLightbox] = useState<string | null>(null);
  const [sens, setSens] = useState(1);
  const conv = useRef<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const viewer = useRef<ViewerHandle>(null);
  const jobs = useJobs({ status: "all" });
  const seenSteps = useRef(new Map<string, number>());
  const seenStatus = useRef(new Map<string, string>());
  const voiceUntil = useRef(0);

  const log = useCallback((text: string, kind: Log["kind"] = "info") => setLogs((l) => [...l, { id: uid(), at: now(), text, kind }].slice(-200)), []);

  // —— data ——
  const loadProjects = useCallback(async () => {
    const r = await fetch("/api/friday/projects", { cache: "no-store" }).then((x) => x.json()).catch(() => null);
    if (r?.ok) setProjects(r.data.projects);
    return (r?.data?.projects ?? []) as ProjectRow[];
  }, []);
  const loadProject = useCallback(async (id: string) => {
    const r = await fetch(`/api/friday/projects/${id}`, { cache: "no-store" }).then((x) => x.json()).catch(() => null);
    if (r?.ok) setProject(r.data.project);
    return (r?.data?.project ?? null) as ProjectView | null;
  }, []);
  useEffect(() => {
    void fetch("/api/friday/status", { cache: "no-store" }).then((x) => x.json()).then((r) => { setBlender(r?.data?.blender ?? null); setBlenderHint(r?.data?.hint ?? ""); }).catch(() => setBlender(null));
    void loadProjects().then((ps) => { if (!projectId && ps[0]) setProjectId(ps[0].id); });
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (projectId) void loadProject(projectId); }, [projectId, loadProject]);

  const version: Version | null = useMemo(() => {
    if (!project) return null;
    return project.versions.find((v) => v.n === (vn ?? project.activeVersion)) ?? project.versions.find((v) => v.status === "ready") ?? null;
  }, [project, vn]);
  const compare = useMemo(() => (project && compareN ? project.versions.find((v) => v.n === compareN && v.status === "ready") ?? null : null), [project, compareN]);

  // keep the URL in step (so a refresh or a shared link reopens the same thing)
  useEffect(() => {
    const q = new URLSearchParams();
    if (projectId) q.set("project", projectId);
    if (version) q.set("v", String(version.n));
    if (mode === "agentic") q.set("view", "agentic");
    // no server round trip — just the address bar
    window.history.replaceState(window.history.state, "", `/dashboard/friday${q.toString() ? `?${q}` : ""}`);
  }, [projectId, version?.n, mode]); // eslint-disable-line react-hooks/exhaustive-deps

  // —— Friday's tasks: real progress from the job (Blender's own lines) ——
  const fridayJobs = useMemo(() => jobs.jobs.filter((j) => j.agent === "friday"), [jobs.jobs]);
  const activeJob = fridayJobs.find((j) => ["planning", "assigned", "running"].includes(j.status)) ?? null;
  useEffect(() => {
    for (const j of fridayJobs) {
      const steps = Array.isArray(j.progress) ? j.progress : [];
      const seen = seenSteps.current.get(j.id);
      if (seen == null) { seenSteps.current.set(j.id, steps.length); seenStatus.current.set(j.id, j.status); continue; }
      for (const s of steps.slice(seen)) log(s.text, s.kind === "error" ? "error" : s.kind === "tool" ? "ok" : "info");
      seenSteps.current.set(j.id, steps.length);
      const prev = seenStatus.current.get(j.id);
      if (prev !== j.status) {
        seenStatus.current.set(j.id, j.status);
        if (j.status === "completed") {
          const art = j.resultData?.artifacts?.find((a) => a.kind === "friday") as { projectId: string; version: number } | undefined;
          if (art) { setProjectId(art.projectId); setVn(art.version); void loadProject(art.projectId); }
          void loadProjects();
          if (j.result) setMsgs((m) => [...m, { id: uid(), role: "assistant", content: j.result!.replace(/\n?STATUS: DONE\s*$/, ""), status: "done", local: true }]);
        } else if (j.status === "failed" || j.status === "cancelled") {
          setMsgs((m) => [...m, { id: uid(), role: "assistant", content: j.status === "cancelled" ? `Cancelled: ${j.title}.` : `${j.title} didn't finish: ${j.error ?? j.result ?? "it failed"}`, status: "error", local: true }]);
          if (projectId) void loadProject(projectId);
        }
      }
    }
  }, [fridayJobs]); // eslint-disable-line react-hooks/exhaustive-deps
  const jobProgress = useMemo(() => {
    if (!activeJob) return null;
    const steps = Array.isArray(activeJob.progress) ? activeJob.progress : [];
    let done = 0, total = 0;
    for (const s of steps) { const m = /Rendered view (\d+) of (\d+)/.exec(s.text); if (m) { done = Number(m[1]); total = Number(m[2]); } }
    const last = steps[steps.length - 1]?.text ?? (activeJob.status === "running" ? "Working…" : "Waiting to start…");
    return { title: activeJob.title, last, done, total, id: activeJob.id, status: activeJob.status };
  }, [activeJob]);

  // —— instant viewer commands ——
  const applyView = useCallback((c: ViewCommand): string => {
    const core = viewer.current?.core;
    if (c.kind === "gallery") { setPanel("gallery"); return "Opened the render gallery."; }
    if (!core) return "The 3D viewer opens in the agentic view — say “activate agentic view”.";
    voiceUntil.current = performance.now() + 1000; // a spoken/typed camera move wins over hands for a moment
    switch (c.kind) {
      case "preset": core.setPreset(c.preset); return `${c.preset === "rear" ? "Back" : c.preset[0].toUpperCase() + c.preset.slice(1)} view.`;
      case "shading": core.setShading(c.shading); return `${c.shading === "wireframe" ? "Wireframe" : c.shading === "solid" ? "Solid" : "Material"} shading.`;
      case "explode": core.setExplode(c.amount); return c.amount ? "Exploded view." : "Assembled.";
      case "section": core.setSection(c.on ? { axis: "x", at: 0 } : null); return c.on ? "Section view — drag the slider to move the cut." : "Section off.";
      case "projection": core.setOrtho(c.ortho); return c.ortho ? "Orthographic camera." : "Perspective camera.";
      case "reset": core.reset(); return "View reset and centred.";
      case "fullscreen": viewer.current?.fullscreen(); return "Full screen.";
      case "zoom": core.zoomBy(c.factor); return c.factor < 1 ? "Zoomed in." : "Zoomed out.";
      case "rotate": core.rotateBy(c.yaw, 0); return "Rotated.";
    }
  }, []);

  // —— hands ——
  const onHands = useCallback((o: Output3D) => {
    const core = viewer.current?.core;
    if (!core) return;
    core.setControlsEnabled(o.mode === "none"); // mouse and hands never fight over the camera
    if (performance.now() < voiceUntil.current) return;
    const a = o.actions;
    if (a.rotate) core.rotateBy(a.rotate[0], a.rotate[1]);
    if (a.zoom) core.zoomBy(a.zoom);
    if (a.pan) core.panBy(a.pan[0], a.pan[1]);
    if (a.reset) { core.reset(); log("Gesture: thumbs-up held — view reset", "cmd"); }
    if (a.paused != null) log(a.paused ? "Gesture: both palms — hand control paused" : "Gesture: both palms — hand control resumed", "cmd");
  }, [log]);
  const hands = useHandControl(onHands);
  const lastMode = useRef<string>("none");
  useEffect(() => {
    const m = hands.state.out?.mode ?? "none";
    if (m !== lastMode.current) { if (m !== "none") log(`Gesture: ${m.replace("_hold", " (hold)")}`, "cmd"); lastMode.current = m; }
  }, [hands.state.out?.mode, log]);

  // —— mode switch (never sent to the AI) ——
  const switchMode = useCallback((m: "chat" | "agentic", said: string) => {
    setMode(m);
    if (m === "chat") { hands.stop(); setPanel(null); }
    log(m === "agentic" ? "Agentic view activated" : "Agentic view deactivated — back to chat", "cmd");
    setMsgs((all) => [...all, { id: uid(), role: "user", content: said, status: "done", local: true }, { id: uid(), role: "assistant", content: m === "agentic" ? "Agentic view activated." : "Agentic view deactivated. Your project and this conversation are right where you left them.", status: "done", local: true }]);
  }, [hands, log]);
  useEffect(() => {
    if (mode !== "agentic") return;
    const esc = (e: KeyboardEvent) => { if (e.key === "Escape" && !document.fullscreenElement && !lightbox) switchMode("chat", "deactivate agentic view"); };
    window.addEventListener("keydown", esc);
    return () => window.removeEventListener("keydown", esc);
  }, [mode, lightbox, switchMode]);

  // —— talking to Friday ——
  const ask = useCallback(async (text: string, onDelta?: (s: string) => void): Promise<{ text: string; error?: string }> => {
    const t = text.trim();
    if (!t) return { text: "" };
    abortRef.current?.abort();
    const ac = new AbortController();
    abortRef.current = ac;
    const aId = uid();
    setMsgs((all) => [...all, { id: uid(), role: "user", content: t, status: "done" }, { id: aId, role: "assistant", content: "", status: "streaming", tools: [] }]);
    setBusy(true);
    const patch = (f: (m: Msg) => Msg) => setMsgs((all) => all.map((m) => (m.id === aId ? f(m) : m)));
    let full = "", err: string | null = null;
    try {
      const ctx = project && version ? `\n\n[Workspace: project "${project.name}" (id ${project.id}), version ${version.n}${selected ? `, selected part "${selected}"` : ""}]` : "";
      const r = await fetch("/api/agent", { method: "POST", headers: { "Content-Type": "application/json" }, signal: ac.signal, body: JSON.stringify({ conversationId: conv.current, message: t + ctx, agent: "friday" }) });
      if (!r.ok || !r.body) { const j = await r.json().catch(() => null); throw new Error(j?.error || `Friday answered ${r.status}.`); }
      const reader = r.body.getReader();
      const dec = new TextDecoder();
      let buf = "";
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        buf += dec.decode(value, { stream: true });
        let nl: number;
        while ((nl = buf.indexOf("\n")) >= 0) {
          const line = buf.slice(0, nl).trim(); buf = buf.slice(nl + 1);
          if (!line) continue;
          let ev: Record<string, unknown>;
          try { ev = JSON.parse(line); } catch { continue; }
          if (ev.type === "meta" && !conv.current) conv.current = String(ev.conversationId);
          else if (ev.type === "text") { full += String(ev.delta ?? ""); onDelta?.(full); patch((m) => ({ ...m, content: full })); }
          else if (ev.type === "tool") { patch((m) => ({ ...m, tools: [...(m.tools ?? []), { status: String(ev.status), summary: String(ev.summary ?? "") }] })); log(`Friday: ${String(ev.summary ?? ev.name)}`, ev.status === "error" ? "error" : "friday"); }
          else if (ev.type === "job") { void jobs.refresh(); log(`Task started: ${String(ev.title)}`, "friday"); }
          else if (ev.type === "navigate") {
            const u = new URL(String(ev.path), location.origin);
            if (u.pathname === "/dashboard/friday") {
              const p = u.searchParams.get("project"); if (p) setProjectId(p);
              const v = Number(u.searchParams.get("v")); if (v) setVn(v);
              const c = Number(u.searchParams.get("compare")); if (c) { setCompareN(c); setPanel("gallery"); }
              if (u.searchParams.get("view") === "agentic") setMode("agentic");
            } else router.push(String(ev.path));
          }
          else if (ev.type === "done" && typeof ev.text === "string" && ev.text) { full = ev.text; onDelta?.(full); }
          else if (ev.type === "error") err = String(ev.message ?? "Something went wrong.");
        }
      }
      patch((m) => ({ ...m, content: full || (err ?? ""), status: err ? "error" : "done" }));
      if (full) log(`Friday: ${full.replace(/\s+/g, " ").slice(0, 160)}`, "friday");
      if (err) log(err, "error");
    } catch (e) {
      err = (e as Error).name === "AbortError" ? "stopped" : (e as Error).message;
      patch((m) => ({ ...m, status: "error", content: m.content || (err === "stopped" ? "(stopped)" : err!) }));
    } finally {
      if (abortRef.current === ac) abortRef.current = null;
      setBusy(false);
    }
    return err && err !== "stopped" ? { text: full, error: err } : { text: full };
  }, [project, version, selected, jobs, log, router]);

  /** Everything typed or said goes through here: mode switch → instant view command → Friday. */
  const submit = useCallback(async (raw: string, onDelta?: (s: string) => void): Promise<{ text: string; error?: string }> => {
    const t = raw.trim();
    if (!t) return { text: "" };
    const mc = modeCommand(t);
    if (mc) {
      if ((mc === "activate") === (mode === "agentic")) { const m = mc === "activate" ? "The agentic view is already open." : "You're already in the chat."; log(m, "cmd"); return { text: m }; }
      switchMode(mc === "activate" ? "agentic" : "chat", t);
      return { text: mc === "activate" ? "Agentic view activated." : "Agentic view deactivated." };
    }
    const vc = viewCommand(t);
    if (vc && (mode === "agentic" || vc.kind === "gallery")) {
      log(`> ${t}`, "cmd");
      const m = applyView(vc);
      log(m, "info");
      if (mode === "chat") setMsgs((all) => [...all, { id: uid(), role: "user", content: t, status: "done", local: true }, { id: uid(), role: "assistant", content: m, status: "done", local: true }]);
      return { text: m };
    }
    if (mode === "agentic") log(`> ${t}`, "cmd");
    return ask(t, onDelta);
  }, [mode, switchMode, applyView, ask, log]);

  const asked = useRef(false);
  useEffect(() => {
    const q = params.get("ask")?.trim();
    if (q && !asked.current) { asked.current = true; void submit(q); }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const send = () => { const t = input; setInput(""); void submit(t); };
  const startJob = async (body: Record<string, unknown>) => {
    const r = await fetch("/api/friday/projects", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }).then((x) => x.json()).catch(() => null);
    if (!r?.ok) { log(r?.error ?? "Couldn't start.", "error"); return; }
    log(`Task started: ${r.data.job.title}`, "friday");
    void jobs.refresh();
  };
  const setActive = async (n: number) => {
    if (!project) return;
    setVn(n);
    const r = await fetch(`/api/friday/projects/${project.id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ activeVersion: n }) }).then((x) => x.json()).catch(() => null);
    if (r?.ok) { setProject(r.data.project); log(`Switched to version ${n}`, "cmd"); }
  };

  const status = activeJob ? (jobProgress?.last.replace(/^✓\s*/, "") ?? "Working") : version?.status === "failed" ? "FAILED" : "IDLE";
  const modelUrl = version?.status === "ready" ? version.model : null;
  const sel = selected && viewer.current?.core ? { info: parts.find((p) => p.id === selected), mat: viewer.current.core.materialOf(selected), box: viewer.current.core.partBoxMm(selected) } : null;

  // ———————————————————— render ————————————————————
  const chatList = (
    <div className="fr-msgs">
      {!msgs.length && (
        <div className="fr-hello">
          <p>I&apos;m Friday — I turn inventions into real 3D models: Blender geometry, ten verified renders, and an interactive viewer you can drive with your hands.</p>
          <div className="fr-sugs">{FRIDAY.suggestions.map((s) => <button key={s} onClick={() => void submit(s)}>{s}</button>)}</div>
          <p className="fr-dim">Say or type <b>activate agentic view</b> to open the 3D workspace.</p>
        </div>
      )}
      {msgs.map((m) => (
        <div key={m.id} className={`fr-m ${m.role}${m.status === "error" ? " err" : ""}`}>
          {m.role === "assistant" ? <Markdown text={m.content || (m.status === "streaming" ? "…" : "")} /> : <p>{m.content}</p>}
          {!!m.tools?.length && <ul className="fr-tools">{m.tools.map((t, i) => <li key={i} className={t.status === "error" ? "err" : ""}>{t.status === "error" ? "✗" : "✓"} {t.summary}</li>)}</ul>}
        </div>
      ))}
    </div>
  );
  const progressCard = jobProgress && (
    <div className="fr-prog">
      <div className="fr-prog-h"><b>{jobProgress.title}</b><button onClick={() => void jobs.act(jobProgress.id, "cancel")}>Cancel</button></div>
      {jobProgress.total > 0 ? <div className="fr-bar"><i style={{ width: `${(jobProgress.done / jobProgress.total) * 100}%` }} /><span>{jobProgress.done}/{jobProgress.total} views</span></div> : <div className="fr-bar ind"><i /></div>}
      <small>{jobProgress.last}</small>
    </div>
  );
  const composer = (placeholder: string) => (
    <form className="fr-in" onSubmit={(e) => { e.preventDefault(); send(); }}>
      <input value={input} onChange={(e) => setInput(e.target.value)} placeholder={placeholder} aria-label="Message Friday" />
      {busy ? <button type="button" onClick={() => abortRef.current?.abort()}>Stop</button> : <button type="submit" disabled={!input.trim()}>Send</button>}
      <button type="button" title="Voice" onClick={() => setVoice(true)}>🎙</button>
    </form>
  );

  return (
    <div className="fr">
      <style dangerouslySetInnerHTML={{ __html: CSS }} />
      {mode === "chat" && (
        <div className="fr-chat">
          <header className="fr-head"><div><h1>PROJECT: FRIDAY</h1><span>3D modelling · rendering · holographic viewer</span></div>
            <button className="fr-cta" onClick={() => switchMode("agentic", "activate agentic view")}>Activate agentic view</button></header>
          {blender === null && <div className="fr-warn">Blender isn&apos;t installed on the computer running JARVIS, so Friday can talk but can&apos;t model or render. {blenderHint}</div>}
          {version?.status === "ready" && (
            <div className="fr-card">
              {version.renders.find((r) => r.view === "front_34") && <img src={version.renders.find((r) => r.view === "front_34")!.url} alt={`${project?.name} front three-quarter render`} onClick={() => setLightbox(version.renders.find((r) => r.view === "front_34")!.url)} />}
              <div><b>{project?.name}</b> · version {version.n}{version.label ? ` “${version.label}”` : ""}<br /><small>{version.components.length} parts · {version.size?.map((n) => Math.round(n)).join(" × ")} mm · {version.renders.length} renders</small>
                <div className="fr-strip">{version.renders.map((r) => <img key={r.view} src={r.url} alt={r.label} title={r.label} onClick={() => setLightbox(r.url)} />)}</div></div>
            </div>
          )}
          {progressCard}
          {chatList}
          {composer("Describe an invention, ask for a change, or say “activate agentic view”…")}
        </div>
      )}

      {mode === "agentic" && (
        <div className="fw">
          <div className="fw-top">
            <b className="fw-brand">FRIDAY</b>
            <span>PROJECT: {project?.name?.toUpperCase() ?? "—"}</span>
            <span>VERSION {version ? `${String(version.n)}${version.label ? ` · ${version.label}` : ""}` : "—"}</span>
            <span className={activeJob ? "busy" : version?.status === "failed" ? "bad" : ""}>STATUS: {status.toUpperCase().slice(0, 60)}</span>
            <span>BLENDER: {blender === undefined ? "…" : blender ? blender.version ?? "found" : "NOT INSTALLED"}</span>
            {version?.device && <span>RENDER: {version.device}</span>}
            <span>GESTURE TRACKING: {hands.state.on ? `ON${hands.state.fps != null ? ` · ${hands.state.fps} FPS` : ""}${hands.state.latency != null ? ` · ${hands.state.latency} ms ${hands.state.latencyKind === "capture" ? "latency" : "processing"}` : ""}` : "OFF"}
              <button onClick={() => (hands.state.on ? hands.stop() : void hands.start())} disabled={hands.state.starting}>{hands.state.starting ? "Starting…" : hands.state.on ? "Disable" : "Enable"}</button></span>
            <button className="fw-x" title="deactivate agentic view" onClick={() => switchMode("chat", "deactivate agentic view")}>✕</button>
          </div>

          <nav className="fw-rail">
            {([["new", "New Project", "＋"], ["open", "Open Project", "📂"], ["library", "Model Library", "▦"], ["gallery", "Render Gallery", "🖼"], ["components", "Components", "⚙"], ["gestures", "Gesture Controls", "✋"], ["export", "Export", "⇩"]] as [Panel, string, string][]).map(([id, label, ic]) => (
              <button key={id} className={panel === id ? "on" : ""} onClick={() => setPanel(panel === id ? null : id)} title={label}><span>{ic}</span><small>{label}</small></button>
            ))}
          </nav>

          <main className="fw-view">
            <FridayViewer ref={viewer} url={modelUrl} onParts={setParts} onSelect={setSelected} onLog={(s) => log(s)} />
            {/* the camera preview (mirrored) — frames stay in this browser */}
            <video ref={hands.video} className={`fw-cam${hands.state.on || hands.state.starting ? " on" : ""}`} muted playsInline aria-label="Camera preview for hand tracking" />
            {hands.state.on && hands.state.out && <GestureHud out={hands.state.out} />}
            {progressCard && <div className="fw-progwrap">{progressCard}</div>}
            {panel && panel !== "gallery" && (
              <div className="fw-drawer">
                {panel === "new" && <NewProject onStart={(request, name) => { void startJob({ action: "create", request, name }); setPanel(null); }} disabled={!blender} />}
                {panel === "open" && <ul className="fw-list">{projects.map((p) => <li key={p.id}><button className={p.id === projectId ? "on" : ""} onClick={() => { setProjectId(p.id); setVn(null); setPanel(null); log(`Opened ${p.name}`, "cmd"); }}>{p.name}<small>v{p.activeVersion} · {new Date(p.updatedAt).toLocaleDateString()}</small></button></li>)}{!projects.length && <li className="fr-dim">No projects yet.</li>}</ul>}
                {panel === "library" && <div className="fw-lib">{projects.map((p) => <button key={p.id} onClick={() => { setProjectId(p.id); setVn(null); setPanel(null); }}>{p.thumb ? <img src={p.thumb} alt={p.name} /> : <div className="fw-noimg">no render yet</div>}<span>{p.name}</span></button>)}{!projects.length && <p className="fr-dim">No models yet.</p>}</div>}
                {panel === "components" && <PartsTree parts={parts} selected={selected} onPick={(id) => viewer.current?.core?.select(id)} />}
                {panel === "gestures" && (
                  <div className="fw-g">
                    <button onClick={() => (hands.state.on ? hands.stop() : void hands.start())}>{hands.state.on ? "Disable gesture tracking" : "Enable gesture tracking (asks for the camera)"}</button>
                    {hands.state.error && <p className="bad">{hands.state.error}</p>}
                    {hands.state.on && <>
                      <button onClick={hands.calibrate}>Calibrate (hold an open hand, fingers spread, 2 s)</button>
                      {hands.state.calibrated && <p className="ok">Calibrated to your hand.</p>}
                      <label>Sensitivity <input type="range" min={40} max={200} value={sens * 100} onChange={(e) => { const k = Number(e.target.value) / 100; setSens(k); hands.setSensitivity(k); }} /> {sens.toFixed(1)}×</label>
                      <button onClick={() => hands.setPaused(!(hands.state.out?.paused ?? false))}>{hands.state.out?.paused ? "Resume hand control" : "Pause hand control"}</button>
                      <p className="fr-dim">Tracking on {hands.state.delegate ?? "…"} · {hands.state.fps ?? "—"} FPS · {hands.state.latency ?? "—"} ms {hands.state.latencyKind === "capture" ? "camera-to-result latency" : "processing time"} (measured)</p>
                    </>}
                    <ul className="fw-guide">
                      <li><b>Open palm, move</b> — rotate</li><li><b>Pinch, move up / down</b> — zoom in / out</li><li><b>Two hands pinching, apart / together</b> — scale</li>
                      <li><b>Fist (grab), move</b> — pan</li><li><b>Both palms open, hold</b> — pause / resume</li><li><b>Thumbs-up, hold</b> — reset view</li>
                    </ul>
                    <p className="fr-dim">Priority: a spoken or typed view command wins for a moment, then hands; the mouse works whenever no hand gesture is active. Frames stay in this browser; the camera turns off when you disable tracking or leave the agentic view.</p>
                  </div>
                )}
                {panel === "export" && version && (
                  <div className="fw-exp">
                    <p className="fr-dim">Visual concept — not engineering-ready. Check dimensions and wall thickness before printing or manufacturing.</p>
                    {Object.entries(version.files).map(([k, u]) => <a key={k} href={`${u}?download=1`}>{k.toUpperCase()} — model.{k === "blend" ? "blend" : k}</a>)}
                    {!version.files.stl && <button disabled={!blender || !!activeJob} onClick={() => void startJob({ action: "export", projectId: project!.id, version: version.n, formats: ["stl"] })}>Export STL (Blender)</button>}
                    {!version.files.gltf && <button disabled={!blender || !!activeJob} onClick={() => void startJob({ action: "export", projectId: project!.id, version: version.n, formats: ["gltf"] })}>Export glTF (Blender)</button>}
                    <h4>Renders</h4>
                    {version.renders.map((r) => <span key={r.view} className="fw-dl">{r.label}: <a href={`${r.url.split("?")[0]}?download=1`}>PNG</a> · <a href={`${r.url.split("?")[0]}?format=jpeg&download=1`}>JPEG</a></span>)}
                  </div>
                )}
              </div>
            )}
            {panel === "gallery" && version && (
              <Gallery version={version} compare={compare} versions={project?.versions ?? []} onCompare={setCompareN} onOpen={setLightbox} onClose={() => setPanel(null)}
                onRegenerate={(view) => void startJob({ action: "render", projectId: project!.id, version: version.n, views: [view] })} busy={!!activeJob || !blender} />
            )}
          </main>

          <aside className="fw-insp">
            <h3>Inspector</h3>
            {sel?.info ? (
              <div className="fw-sel">
                <b>{sel.info.name}</b>
                <dl>
                  <dt>Group</dt><dd>{sel.info.group}</dd>
                  <dt>Material</dt><dd><i className="sw" style={{ background: sel.mat?.color }} />{sel.mat?.name || sel.info.material}</dd>
                  {sel.box && <><dt>Position</dt><dd>{sel.box.center.join(", ")} mm</dd><dt>Size</dt><dd>{sel.box.size.join(" × ")} mm</dd></>}
                  {sel.mat && <><dt>Metallic</dt><dd>{sel.mat.metalness.toFixed(2)}</dd><dt>Roughness</dt><dd>{sel.mat.roughness.toFixed(2)}</dd></>}
                </dl>
                {(sel.info.conceptual || sel.info.internal) && <p className="fr-dim">{sel.info.conceptual ? "Conceptual placeholder — not from your specs. " : ""}{sel.info.internal ? "Internal part." : ""}</p>}
                <MaterialPreview key={selected} initial={sel.mat} onPreview={(v) => viewer.current?.core?.previewMaterial(selected!, v)}
                  onApply={(v) => void submit(`Change the material of the ${sel.info!.name} (${selected}) to colour ${v.color}, metallic ${v.metalness.toFixed(2)}, roughness ${v.roughness.toFixed(2)}.`)} />
              </div>
            ) : <p className="fr-dim">Click a part in the viewer (or pick one under Components).</p>}
            {project && <>
              <h3>Versions</h3>
              <ul className="fw-vers">{project.versions.map((v) => <li key={v.n} className={v.n === version?.n ? "on" : ""}>
                <button disabled={v.status !== "ready"} onClick={() => void setActive(v.n)}>v{v.n}{v.label ? ` · ${v.label}` : ""}</button>
                <small>{v.status === "ready" ? v.change ?? "" : v.status === "failed" ? `failed: ${v.error ?? ""}` : "building…"}</small></li>)}</ul>
              {project.specs && <>
                <h3>Specs</h3>
                {!!project.specs.verified.length && <><h4>Verified</h4><ul>{project.specs.verified.map((s, i) => <li key={i}>{s}</li>)}</ul></>}
                {!!project.specs.assumptions.length && <><h4>Assumptions</h4><ul className="fr-dim">{project.specs.assumptions.map((s, i) => <li key={i}>{s}</li>)}</ul></>}
                {!!project.specs.questions.length && <><h4>Open questions</h4><ul>{project.specs.questions.map((s, i) => <li key={i}>{s}</li>)}</ul></>}
              </>}
              {!!version?.warnings.length && <><h4>Notes</h4><ul className="fr-dim">{version.warnings.map((w, i) => <li key={i}>{w}</li>)}</ul></>}
            </>}
          </aside>

          <section className="fw-console">
            <div className="fw-log">{logs.slice(-80).map((l) => <div key={l.id} className={`l-${l.kind}`}><time>{l.at}</time> {l.text}</div>)}
              {busy && <div className="l-friday"><time>{now()}</time> Friday is thinking…</div>}</div>
            {composer("Command — e.g. “top view”, “make the frame thinner”, “deactivate agentic view”")}
          </section>
        </div>
      )}

      {lightbox && <div className="fr-lb" onClick={() => setLightbox(null)} role="dialog" aria-label="Render"><img src={lightbox} alt="Render" /></div>}
      {voice && <VoiceMode agent={FRIDAY} displayName={null} onAsk={(t, d) => submit(t, d)} onStop={() => abortRef.current?.abort()} onClose={() => setVoice(false)} />}
    </div>
  );
}

function GestureHud({ out }: { out: Output3D }) {
  return (
    <div className="fw-hud" aria-live="polite">
      <b>{out.calibrating ? "CALIBRATING — hold an open hand" : out.paused ? "HAND CONTROL PAUSED" : out.mode === "none" ? (out.hands.length ? "READY" : "NO HAND") : out.mode.replace("_hold", "").toUpperCase()}</b>
      {out.hold > 0 && out.hold < 1 && <i className="hold" style={{ width: `${out.hold * 100}%` }} />}
      {out.hands.map((h, i) => <span key={i}>{h.pose.replace("_", " ")} · {Math.round(h.confidence * 100)}%</span>)}
      {out.hands.map((h, i) => <em key={`d${i}`} className="dot" style={{ left: `${(1 - h.x) * 100}%`, top: `${h.y * 100}%` }} />)}
    </div>
  );
}

function NewProject({ onStart, disabled }: { onStart: (request: string, name: string) => void; disabled: boolean }) {
  const [name, setName] = useState("");
  const [req, setReq] = useState("");
  return (
    <form className="fw-new" onSubmit={(e) => { e.preventDefault(); if (req.trim().length > 4) onStart(req.trim(), name.trim()); }}>
      <label>Name<input value={name} onChange={(e) => setName(e.target.value)} placeholder="EDITH Smart Glasses" /></label>
      <label>Describe the invention<textarea value={req} onChange={(e) => setReq(e.target.value)} rows={6} placeholder="Dimensions, materials, parts, how it works… (your notes are searched for specs too)" /></label>
      <button disabled={disabled || req.trim().length < 5}>{disabled ? "Blender isn't installed" : "Model it"}</button>
    </form>
  );
}

function PartsTree({ parts, selected, onPick }: { parts: PartInfo[]; selected: string | null; onPick: (id: string) => void }) {
  const groups = useMemo(() => { const g = new Map<string, PartInfo[]>(); for (const p of parts) g.set(p.group, [...(g.get(p.group) ?? []), p]); return [...g]; }, [parts]);
  if (!parts.length) return <p className="fr-dim">No model loaded.</p>;
  return <div className="fw-tree">{groups.map(([g, ps]) => <div key={g}><h4>{g}</h4>{ps.map((p) => <button key={p.id} className={p.id === selected ? "on" : ""} onClick={() => onPick(p.id)}>{p.name}{p.conceptual ? <small> · concept</small> : null}{p.internal ? <small> · internal</small> : null}</button>)}</div>)}</div>;
}

function MaterialPreview({ initial, onPreview, onApply }: { initial: { color: string; metalness: number; roughness: number } | null | undefined; onPreview: (v: { color: string; metalness: number; roughness: number }) => void; onApply: (v: { color: string; metalness: number; roughness: number }) => void }) {
  const [v, setV] = useState({ color: initial?.color ?? "#888888", metalness: initial?.metalness ?? 0, roughness: initial?.roughness ?? 0.5 });
  const [dirty, setDirty] = useState(false);
  const up = (p: Partial<typeof v>) => { const n = { ...v, ...p }; setV(n); setDirty(true); onPreview(n); };
  return (
    <div className="fw-mat">
      <h4>Material preview</h4>
      <label>Colour <input type="color" value={v.color} onChange={(e) => up({ color: e.target.value })} /></label>
      <label>Metallic <input type="range" min={0} max={100} value={v.metalness * 100} onChange={(e) => up({ metalness: Number(e.target.value) / 100 })} /></label>
      <label>Roughness <input type="range" min={0} max={100} value={v.roughness * 100} onChange={(e) => up({ roughness: Number(e.target.value) / 100 })} /></label>
      {dirty && <><p className="fr-dim">Preview only (viewer). Apply makes a new version with real renders.</p><button onClick={() => onApply(v)}>Apply as new version</button></>}
    </div>
  );
}

function Gallery({ version, compare, versions, onCompare, onOpen, onClose, onRegenerate, busy }: { version: Version; compare: Version | null; versions: Version[]; onCompare: (n: number | null) => void; onOpen: (u: string) => void; onClose: () => void; onRegenerate: (v: (typeof VIEWS)[number]["id"]) => void; busy: boolean }) {
  return (
    <div className="fw-gal">
      <div className="fw-gal-h"><b>Render gallery · v{version.n}</b>
        <label>Compare with <select value={compare?.n ?? ""} onChange={(e) => onCompare(Number(e.target.value) || null)}><option value="">—</option>{versions.filter((v) => v.status === "ready" && v.n !== version.n).map((v) => <option key={v.n} value={v.n}>v{v.n}{v.label ? ` · ${v.label}` : ""}</option>)}</select></label>
        <button onClick={onClose}>Close</button></div>
      <div className={`fw-grid${compare ? " cmp" : ""}`}>
        {VIEWS.map((vw) => {
          const r = version.renders.find((x) => x.view === vw.id);
          const c = compare?.renders.find((x) => x.view === vw.id);
          return (
            <figure key={vw.id}>
              <div className="pair">
                {r ? <img src={r.url} alt={r.label} onClick={() => onOpen(r.url)} /> : <div className="fw-noimg">not rendered</div>}
                {compare && (c ? <img src={c.url} alt={`${c.label} v${compare.n}`} onClick={() => onOpen(c.url)} /> : <div className="fw-noimg">—</div>)}
              </div>
              <figcaption>{r?.label ?? vw.label}{r?.reused ? ` · reused from v${r.reused}` : r?.seconds != null ? ` · ${r.seconds}s` : ""}{compare ? ` · v${version.n} | v${compare.n}` : ""}
                <button disabled={busy} onClick={() => onRegenerate(vw.id)} title="Re-render this view in Blender">↻</button></figcaption>
            </figure>
          );
        })}
      </div>
    </div>
  );
}
