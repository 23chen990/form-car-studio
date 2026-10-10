import {
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type ChangeEvent,
} from "react";
import {
  ArrowUpRight,
  ArrowRight,
  ArrowLeft,
  Plus,
  Check,
  Bookmark,
  Sparkles,
  SlidersHorizontal,
  Download,
  Columns2,
  Camera,
  Upload,
  X,
  Undo2,
  CircleHelp,
  ChevronRight,
  LoaderCircle,
  Pencil,
  Trash2,
  Flag,
  Image as ImageIcon,
  Compass,
  Layers,
  RotateCcw,
  ShieldCheck,
} from "lucide-react";
import type {
  AppState,
  Draft,
  EditField,
  GenerationTask,
  GenerateInput,
  Project,
  StyleDefinition,
  StyleId,
  Target,
  Version,
} from "../shared/types";
import {
  STYLES,
  STYLE_BY_ID,
  BODY_COLORS,
  WHEEL_COLORS,
  KEEP_TARGET,
  colorName,
  styleName,
  styleTarget,
} from "../shared/catalog";
import { api } from "./lib/api";
import { countChanges, selectColor } from "./lib/draft";
import { exportLook, type ExportKind } from "./lib/export";
import { Dialog } from "./components/Dialog";
import { Comparison } from "./components/Comparison";

type Screen =
  | "discover"
  | "looks"
  | "detail"
  | "upload"
  | "task"
  | "result"
  | "refine";
interface View {
  screen: Screen;
  styleId?: StyleId;
  projectId?: string;
  versionId?: string;
  taskId?: string;
}
type Modal =
  | "review"
  | "compare"
  | "export"
  | "leave"
  | "conflict"
  | "rename"
  | "delete"
  | "report"
  | "about"
  | "credits"
  | "retry"
  | null;
const isActive = (task: GenerationTask) =>
  ["queued", "processing", "uncertain"].includes(task.status);
const STORAGE_KEY = "form-view-v1";
function initialView(): View {
  try {
    const view = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "null");
    if (
      view &&
      [
        "discover",
        "looks",
        "detail",
        "upload",
        "task",
        "result",
        "refine",
      ].includes(view.screen)
    )
      return view;
  } catch {
    /* a new browser starts on Discover */
  }
  return { screen: "discover" };
}
function Image({
  src,
  alt,
  className = "",
  current = false,
}: {
  src: string;
  alt: string;
  className?: string;
  current?: boolean;
}) {
  const [failed, setFailed] = useState(false);
  useEffect(() => setFailed(false), [src]);
  return failed ? (
    <div className={`image-fallback ${className}`}>
      <ImageIcon />
      <span>Image unavailable</span>
      <button className="text-button" onClick={() => setFailed(false)}>
        Retry image
      </button>
    </div>
  ) : (
    <img
      src={src}
      alt={alt}
      className={className}
      data-testid={current ? "current-car-image" : undefined}
      onError={() => setFailed(true)}
    />
  );
}

export function App() {
  const [data, setData] = useState<AppState | null>(null);
  const [view, setView] = useState<View>(initialView);
  const [error, setError] = useState(""),
    [toast, setToast] = useState("");
  const [busy, setBusy] = useState(false),
    [online, setOnline] = useState(navigator.onLine);
  const [category, setCategory] = useState("All looks"),
    [collection, setCollection] = useState("Creations");
  const [modal, setModal] = useState<Modal>(null),
    [caseOriginal, setCaseOriginal] = useState(false);
  const [consent, setConsent] = useState(false),
    [target, setTarget] = useState<Target>({ ...KEEP_TARGET });
  const [field, setField] = useState<EditField>("wheelColor"),
    [undo, setUndo] = useState<Target[]>([]);
  const [draftStatus, setDraftStatus] = useState(""),
    [exportKind, setExportKind] = useState<ExportKind>("image");
  const [compareParent, setCompareParent] = useState(false);
  const [manageId, setManageId] = useState<string>(),
    [renameVersion, setRenameVersion] = useState(false),
    [nameInput, setNameInput] = useState(""),
    [reportInput, setReportInput] = useState("");
  const uploadInput = useRef<HTMLInputElement>(null),
    cameraInput = useRef<HTMLInputElement>(null);
  const booted = useRef(false),
    mounted = useRef(true),
    viewRef = useRef(view),
    pendingView = useRef<View | undefined>(undefined),
    conflictingVersion = useRef<Version | undefined>(undefined);
  const queue = useRef<Promise<unknown>>(Promise.resolve()),
    revision = useRef(0),
    submitLock = useRef(false);
  const confirmation = useRef<{ fingerprint: string; key: string } | null>(
    null,
  );
  viewRef.current = view;
  const project = data?.projects.find((item) => item.id === view.projectId);
  const version = project?.versions.find((item) => item.id === view.versionId);
  const style =
    STYLE_BY_ID[view.styleId ?? version?.styleId ?? "sport"] ??
    STYLE_BY_ID.sport;
  const task = data?.tasks.find((item) => item.id === view.taskId);
  const taskHeading = !task
    ? ""
    : isActive(task)
      ? task.status === "uncertain"
        ? "Checking where\nwe left off."
        : "Putting it\ntogether."
      : task.status === "succeeded"
        ? "Your look\nis ready."
        : task.status === "cancelled"
          ? "A pause\nis okay."
          : "Let’s try\nthat again.";
  const activeTask = data?.tasks.find(isActive);
  const changes = countChanges(target);
  const manageProject =
    data?.projects.find((item) => item.id === manageId) ?? project;
  const setScreen = (next: View) => {
    setView(next);
    setError("");
    window.scrollTo({ top: 0, behavior: "instant" });
  };
  const go = (next: View) => {
    if (view.screen === "refine" && changes > 0) {
      pendingView.current = next;
      setModal("leave");
    } else setScreen(next);
  };
  const notify = (message: string) => setToast(message);
  const refresh = async () => {
    const state = await api.state();
    if (mounted.current) setData(state);
    return state;
  };
  useEffect(() => {
    mounted.current = true;
    void api
      .state()
      .then((state) => {
        if (!mounted.current) return;
        setData(state);
        const restored = viewRef.current;
        if (!booted.current) {
          booted.current = true;
          const car = state.projects.find(
            (item) => item.id === restored.projectId,
          );
          if (
            restored.screen === "refine" &&
            car?.draft &&
            car.draft.baseVersionId === restored.versionId
          ) {
            setTarget(car.draft.target);
            setDraftStatus("Draft saved");
          }
          if (
            ["result", "refine"].includes(restored.screen) &&
            !car?.versions.some((item) => item.id === restored.versionId)
          )
            setView({ screen: "discover" });
          if (
            restored.screen === "task" &&
            !state.tasks.some((item) => item.id === restored.taskId)
          )
            setView({ screen: "discover" });
        }
      })
      .catch((err) => {
        if (mounted.current) setError(err.message);
      });
    const connected = () => setOnline(navigator.onLine);
    window.addEventListener("online", connected);
    window.addEventListener("offline", connected);
    return () => {
      mounted.current = false;
      window.removeEventListener("online", connected);
      window.removeEventListener("offline", connected);
    };
  }, []);
  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(view));
    } catch {
      /* server data remains authoritative */
    }
  }, [view]);
  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => setToast(""), 4500);
    return () => clearTimeout(timer);
  }, [toast]);
  useEffect(() => {
    if (!activeTask && view.screen !== "task") return;
    let stopped = false;
    let timer: ReturnType<typeof setTimeout>;
    const poll = async () => {
      try {
        const state = await api.state();
        if (stopped) return;
        setData(state);
        const currentView = viewRef.current,
          currentTask = state.tasks.find(
            (item) => item.id === currentView.taskId,
          );
        if (
          currentView.screen === "task" &&
          currentTask?.status === "succeeded" &&
          currentTask.versionId
        ) {
          setView({
            screen: "result",
            projectId: currentTask.projectId,
            versionId: currentTask.versionId,
          });
          setError("");
        }
        if (state.tasks.some(isActive)) timer = setTimeout(poll, 900);
      } catch {
        if (!stopped) {
          setError("Connection interrupted. Your task and draft are saved.");
          timer = setTimeout(poll, 2500);
        }
      }
    };
    timer = setTimeout(poll, 250);
    return () => {
      stopped = true;
      clearTimeout(timer);
    };
  }, [activeTask?.id, view.screen, view.taskId]);
  useEffect(() => {
    const unload = (event: BeforeUnloadEvent) => {
      if (draftStatus === "Saving draft…") {
        event.preventDefault();
        event.returnValue = "";
      }
    };
    window.addEventListener("beforeunload", unload);
    return () => window.removeEventListener("beforeunload", unload);
  }, [draftStatus]);
  async function action(fn: () => Promise<void>) {
    if (submitLock.current) return;
    submitLock.current = true;
    setBusy(true);
    setError("");
    try {
      await fn();
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : "Something went wrong. Please try again.",
      );
    } finally {
      submitLock.current = false;
      setBusy(false);
    }
  }
  async function saveStyle(id: StyleId) {
    await action(async () => {
      const saved = !data?.savedStyles.includes(id);
      await api.saveStyle(id, saved);
      await refresh();
      notify(saved ? "Style saved to My Looks" : "Style removed from My Looks");
    });
  }
  function saveDraft(next: Target) {
    if (!project || !version) return;
    const carId = project.id,
      serial = ++revision.current;
    const draft: Draft = {
      styleId: version.styleId,
      intent: "refine",
      baseVersionId: version.id,
      target: next,
      updatedAt: new Date().toISOString(),
    };
    setDraftStatus("Saving draft…");
    queue.current = queue.current
      .catch(() => undefined)
      .then(async () => {
        await api.updateProject(carId, { draft });
        if (serial === revision.current) {
          setDraftStatus("Draft saved");
          await refresh();
        }
      })
      .catch((err) => {
        if (serial === revision.current) {
          setDraftStatus("Draft not saved — try again");
          setError(err.message);
        }
        throw err;
      });
    void queue.current.catch(() => undefined);
    return queue.current;
  }
  async function ensureDraftSaved() {
    try {
      await queue.current;
    } catch {
      await saveDraft(target);
    }
  }
  function chooseColor(value: string) {
    const next = selectColor(target, field, value, version?.verifiedTarget);
    if (next[field] === target[field]) return;
    setUndo((history) => [...history, target]);
    setTarget(next);
    saveDraft(next);
    confirmation.current = null;
  }
  function startRefine(nextVersion: Version, discard = false) {
    const car = data!.projects.find(
      (item) => item.id === nextVersion.projectId,
    )!;
    if (
      !discard &&
      car.draft &&
      car.draft.baseVersionId !== nextVersion.id &&
      countChanges(car.draft.target) > 0
    ) {
      conflictingVersion.current = nextVersion;
      setModal("conflict");
      return;
    }
    const restored =
      !discard && car.draft?.baseVersionId === nextVersion.id
        ? car.draft.target
        : { ...KEEP_TARGET };
    setTarget(restored);
    setUndo([]);
    setField("wheelColor");
    setDraftStatus(
      car.draft?.baseVersionId === nextVersion.id ? "Draft saved" : "",
    );
    setScreen({
      screen: "refine",
      projectId: car.id,
      versionId: nextVersion.id,
    });
  }
  async function useDemo() {
    await action(async () => {
      const car = await api.createProject({ source: "sample" });
      await refresh();
      setConsent(false);
      setScreen({ screen: "upload", styleId: style.id, projectId: car.id });
    });
  }
  async function uploadPhoto(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    await action(async () => {
      if (!["image/jpeg", "image/png", "image/webp"].includes(file.type))
        throw new Error("Choose a JPEG, PNG or WebP photo.");
      if (file.size > 10 * 1024 * 1024)
        throw new Error("Choose a photo smaller than 10 MB.");
      const imageData = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result));
        reader.onerror = () =>
          reject(new Error("The photo could not be read."));
        reader.readAsDataURL(file);
      });
      const car = await api.createProject({
        source: "upload",
        imageData,
        name: file.name.replace(/\.[^.]+$/, "").slice(0, 80) || "My car",
      });
      await refresh();
      setConsent(false);
      setScreen({ screen: "upload", styleId: style.id, projectId: car.id });
    });
  }
  async function generate(refine: boolean) {
    if (!project || (refine && !version)) return;
    await action(async () => {
      if (refine) await ensureDraftSaved();
      const payload = {
        projectId: project.id,
        styleId: refine ? version!.styleId : style.id,
        intent: refine ? ("refine" as const) : ("explore" as const),
        baseVersionId: refine ? version!.id : null,
        target: refine ? target : styleTarget(style.id),
        consent: refine || consent,
      };
      await submitGeneration(payload);
    });
  }
  async function submitGeneration(
    payload: Omit<GenerateInput, "idempotencyKey">,
  ) {
    const fingerprint = JSON.stringify(payload);
    if (confirmation.current?.fingerprint !== fingerprint)
      confirmation.current = { fingerprint, key: crypto.randomUUID() };
    const created = await api.generate({
      ...payload,
      idempotencyKey: confirmation.current!.key,
    });
    await refresh();
    setModal(null);
    setScreen({
      screen: "task",
      projectId: created.projectId,
      taskId: created.id,
    });
  }
  async function retryTask() {
    if (!task || task.status !== "failed") return;
    await action(async () => {
      await submitGeneration({
        projectId: task.projectId,
        styleId: task.styleId,
        intent: task.intent,
        baseVersionId: task.baseVersionId,
        target: task.target,
        retryOfTaskId: task.id,
        consent: true,
      });
    });
  }
  async function favorite() {
    if (!version) return;
    await action(async () => {
      await api.updateVersion(version.id, { favorite: !version.favorite });
      await refresh();
      notify(
        version.favorite ? "Removed from saved looks" : "Saved to My Looks",
      );
    });
  }
  function openRename(car: Project, forVersion = false) {
    setManageId(car.id);
    setRenameVersion(forVersion);
    setNameInput(forVersion ? (version?.name ?? car.name) : car.name);
    setModal("rename");
  }
  const closeModal = () => {
    if (!busy) {
      setModal(null);
      setError("");
    }
  };
  const openStyle = (id: StyleId) => {
    setCaseOriginal(false);
    setConsent(false);
    go({ screen: "detail", styleId: id, projectId: view.projectId });
  };
  const photoBlocked = data?.mode === "demo" && project?.source === "upload";

  if (!data)
    return (
      <div className="boot">
        <div className="wordmark">
          FORM<span>®</span>
        </div>
        <LoaderCircle className="spin" />
        <p>{error || "Opening your studio…"}</p>
        {error && (
          <button
            className="button primary"
            onClick={() => void refresh().catch((err) => setError(err.message))}
          >
            Retry connection
          </button>
        )}
      </div>
    );

  return (
    <div className="app-shell">
      <a className="skip-link" href="#main">
        Skip to content
      </a>
      <header className="site-header">
        <button
          className="wordmark"
          aria-label="FORM home"
          onClick={() => go({ screen: "discover" })}
        >
          FORM<span>®</span>
        </button>
        <nav className="desktop-nav" aria-label="Main navigation">
          <button
            className={
              ["discover", "detail", "upload"].includes(view.screen)
                ? "active"
                : ""
            }
            onClick={() =>
              go({ screen: "discover", projectId: view.projectId })
            }
          >
            Discover
          </button>
          <button
            className={view.screen === "looks" ? "active" : ""}
            onClick={() => go({ screen: "looks" })}
          >
            My Looks
          </button>
        </nav>
        <div className="header-tools">
          <button className="credit-pill" onClick={() => setModal("credits")}>
            <Sparkles size={14} />
            <span>
              {data.credits} {data.mode === "demo" ? "demo credits" : "credits"}
            </span>
          </button>
          <button
            className="icon-button"
            aria-label="About FORM"
            onClick={() => setModal("about")}
          >
            <CircleHelp size={19} />
          </button>
        </div>
      </header>
      {!online && (
        <div className="notice notice-warning">
          You’re offline. Your saved looks stay here; reconnect to make a new
          one.
        </div>
      )}
      {error && !modal && (
        <div role="alert" className="notice notice-error">
          <span>{error}</span>
          <button
            aria-label="Dismiss message"
            className="icon-button"
            onClick={() => setError("")}
          >
            <X size={18} />
          </button>
        </div>
      )}
      {activeTask && view.screen !== "task" && (
        <button
          className="task-banner"
          onClick={() =>
            go({
              screen: "task",
              taskId: activeTask.id,
              projectId: activeTask.projectId,
            })
          }
        >
          <LoaderCircle className="spin" size={16} />
          <span>Your look is in progress. You can leave this page.</span>
          <span>
            View task <ArrowRight size={16} />
          </span>
        </button>
      )}
      <main id="main">
        {view.screen === "discover" && (
          <>
            <section className="hero">
              <div className="hero-copy">
                <div className="eyebrow">
                  <span className="lime-dot" /> THE PERSONAL CAR STUDIO
                </div>
                <h1>
                  Same car.
                  <br />
                  New <em>feeling.</em>
                </h1>
                <p>
                  A fresh perspective on the car you love.
                  <br className="desktop-only" /> Find a direction. Make it
                  yours.
                </p>
                <button
                  className="button primary"
                  onClick={() =>
                    document
                      .getElementById("directions")
                      ?.scrollIntoView({ behavior: "smooth" })
                  }
                >
                  Find your look <ArrowUpRight size={20} />
                </button>
                <div className="hero-footnote">
                  <span>01 / EXPLORE</span>
                  <span>02 / REIMAGINE</span>
                  <span>03 / KEEP</span>
                </div>
              </div>
              <div className="hero-visual">
                <div className="image-topline">
                  <span>THE EVERYDAY, RECONSIDERED.</span>
                  <span>FORM STUDY / 001</span>
                </div>
                <Image
                  src="/images/sport.jpg"
                  alt="Blue sample Golf with warm bronze wheels, shown in full"
                />
                <div className="hero-image-caption">
                  <div>
                    <span className="eyebrow">FEATURED DIRECTION</span>
                    <strong>Street Sport</strong>
                    <span>Blue meets bronze. A little more character.</span>
                  </div>
                  <button
                    className="round-arrow"
                    aria-label="Meet Street Sport"
                    onClick={() => openStyle("sport")}
                  >
                    <ArrowUpRight size={25} />
                  </button>
                </div>
                <span className="image-label">DEMO COLOR STUDY</span>
              </div>
            </section>
            {project && (
              <div className="photo-banner">
                <Image src={project.originalUrl} alt="Your original photo" />
                <span>
                  Your original photo is ready.
                  <small>Every new direction starts here.</small>
                </span>
                <button
                  className="text-button"
                  onClick={() =>
                    go({
                      screen: "upload",
                      styleId: style.id,
                      projectId: project.id,
                    })
                  }
                >
                  Change photo <ArrowRight size={16} />
                </button>
              </div>
            )}
            {data.projects.some((car) => car.versions.length > 0) && (
              <button
                className="resume-link"
                onClick={() => {
                  const car = [...data.projects]
                    .reverse()
                    .find((item) => item.versions.length)!;
                  const latest = car.versions.at(-1)!;
                  go({
                    screen: "result",
                    projectId: car.id,
                    versionId: latest.id,
                  });
                }}
              >
                <Layers size={17} />
                Continue your latest look <ArrowUpRight size={17} />
              </button>
            )}
            <section id="directions" className="directions">
              <div className="section-heading">
                <div>
                  <span className="eyebrow">THE DIRECTION LIBRARY</span>
                  <h2>What feels like you?</h2>
                </div>
                <p>Eight starting points. Room to make them your own.</p>
              </div>
              <div
                className="filter-row"
                role="group"
                aria-label="Filter style directions"
              >
                {["All looks", "Subtle", "Sporty", "Expressive"].map((item) => (
                  <button
                    key={item}
                    aria-pressed={category === item}
                    className={category === item ? "selected" : ""}
                    onClick={() => setCategory(item)}
                  >
                    {item}
                    {category === item && <span className="filter-dot" />}
                  </button>
                ))}
                <span className="filter-count">
                  {category === "All looks"
                    ? "08"
                    : String(
                        STYLES.filter((item) => item.category === category)
                          .length,
                      ).padStart(2, "0")}{" "}
                  DIRECTIONS
                </span>
              </div>
              <div className="style-grid">
                {STYLES.filter(
                  (item) =>
                    category === "All looks" || item.category === category,
                ).map((item, index) => (
                  <StyleCard
                    key={item.id}
                    style={item}
                    index={index}
                    saved={data.savedStyles.includes(item.id)}
                    busy={busy}
                    onOpen={() => openStyle(item.id)}
                    onSave={() => void saveStyle(item.id)}
                  />
                ))}
              </div>
              <div className="library-note">
                <ShieldCheck size={17} />
                <p>
                  These are color studies on one demo car. Full styling on your
                  photo requires a connected AI provider. No fitment or
                  real-world modification guarantee.
                </p>
              </div>
            </section>
            <section className="how-it-works">
              <div>
                <span className="eyebrow">
                  LESS CONFIGURING. MORE DISCOVERING.
                </span>
                <h2>
                  Your car is the
                  <br />
                  starting point.
                </h2>
              </div>
              <div className="steps">
                <div>
                  <span>01</span>
                  <h3>Find your direction</h3>
                  <p>Start with a complete look that speaks to you.</p>
                </div>
                <div>
                  <span>02</span>
                  <h3>Bring your car</h3>
                  <p>Upload a clear photo, or take the demo car for a spin.</p>
                </div>
                <div>
                  <span>03</span>
                  <h3>Make it your own</h3>
                  <p>Keep a look you love, or refine just a few details.</p>
                </div>
              </div>
            </section>
          </>
        )}
        {view.screen === "detail" && (
          <section className="work-page">
            <button
              className="back-link"
              onClick={() =>
                go({ screen: "discover", projectId: view.projectId })
              }
            >
              <ArrowLeft size={16} />
              All directions
            </button>
            <div className="work-grid detail-grid">
              <div className="car-stage">
                <div className="stage-toolbar">
                  <span>
                    {caseOriginal ? "Sample photograph" : "Demo color study"}
                  </span>
                  <div className="segmented">
                    <button
                      aria-pressed={caseOriginal}
                      className={caseOriginal ? "selected" : ""}
                      onClick={() => setCaseOriginal(true)}
                    >
                      Original
                    </button>
                    <button
                      aria-pressed={!caseOriginal}
                      className={!caseOriginal ? "selected" : ""}
                      onClick={() => setCaseOriginal(false)}
                    >
                      New look
                    </button>
                  </div>
                </div>
                <Image
                  src={
                    caseOriginal ? "/images/street-sport.jpg" : style.imageUrl
                  }
                  alt={`${style.name} sample color study`}
                />
                <div className="stage-caption">
                  <span>SAMPLE CAR / VW GOLF</span>
                  <span>REFERENCE ONLY</span>
                </div>
              </div>
              <div className="work-copy">
                <span className="eyebrow">
                  {style.category.toUpperCase()} / STYLE DIRECTION
                </span>
                <h1>{style.name}</h1>
                <p className="large-copy">{style.description}</p>
                <div className="detail-tags">
                  {style.details.map((detail) => (
                    <span key={detail}>{detail}</span>
                  ))}
                </div>
                <p className="muted">
                  {style.id === "clean"
                    ? "On your photo, this direction keeps your original paint and focuses on subtle details."
                    : "This direction includes a new paint and wheel palette. Start with the complete look, then refine it if you wish."}
                </p>
                <button
                  className="button primary full"
                  onClick={() =>
                    go({
                      screen: "upload",
                      styleId: style.id,
                      projectId: view.projectId,
                    })
                  }
                >
                  Try this look on my car <ArrowRight size={18} />
                </button>
                <button
                  className="button secondary full"
                  disabled={busy}
                  onClick={() => void saveStyle(style.id)}
                >
                  <Bookmark
                    size={17}
                    fill={
                      data.savedStyles.includes(style.id)
                        ? "currentColor"
                        : "none"
                    }
                  />
                  {data.savedStyles.includes(style.id)
                    ? "Style saved"
                    : "Save this style"}
                </button>
                <p className="fine-print">
                  The preview is a demo color study, not a verified AI styling
                  result. Your car’s identity remains the starting point.
                </p>
              </div>
            </div>
          </section>
        )}
        {view.screen === "upload" && (
          <section className="work-page">
            <button
              className="back-link"
              onClick={() =>
                go({
                  screen: "detail",
                  styleId: style.id,
                  projectId: project?.id,
                })
              }
            >
              <ArrowLeft size={16} />
              Back to direction
            </button>
            <div className="work-grid">
              <div className="upload-stage">
                {project ? (
                  <>
                    <div className="stage-toolbar">
                      <span>YOUR ORIGINAL PHOTO</span>
                      <button
                        className="text-button"
                        onClick={() => {
                          setConsent(false);
                          setScreen({ screen: "upload", styleId: style.id });
                        }}
                      >
                        Remove photo <X size={14} />
                      </button>
                    </div>
                    <Image
                      src={project.originalUrl}
                      alt="Your original car photo"
                    />
                    <div className="stage-caption">
                      <span>
                        {project.source === "sample"
                          ? "DEMO CAR"
                          : "YOUR PHOTO"}
                      </span>
                      <span>FULL CAR. NO CROP.</span>
                    </div>
                  </>
                ) : (
                  <div className="upload-empty">
                    <div className="upload-icon">
                      <ImageIcon size={34} strokeWidth={1.3} />
                    </div>
                    <h2>A different look starts here.</h2>
                    <p>
                      Bring a photo of your car.
                      <br />
                      We’ll keep its character in the picture.
                    </p>
                    <button
                      className="button primary"
                      disabled={busy}
                      onClick={() => uploadInput.current?.click()}
                    >
                      <Upload size={18} />
                      Choose a photo
                    </button>
                    <div className="upload-alternatives">
                      <button
                        className="text-button"
                        disabled={busy}
                        onClick={() => cameraInput.current?.click()}
                      >
                        <Camera size={18} />
                        Take a photo
                      </button>
                      <span>or</span>
                      <button
                        className="text-button"
                        disabled={busy}
                        onClick={() => void useDemo()}
                      >
                        Use demo car <ArrowRight size={17} />
                      </button>
                    </div>
                    <span className="fine-print">
                      JPEG, PNG or WebP · Up to 10 MB
                    </span>
                  </div>
                )}
              </div>
              <div className="work-copy">
                <span className="eyebrow">YOUR CAR / YOUR CANVAS</span>
                <h1>
                  Let’s see
                  <br />
                  another side.
                </h1>
                <div className="selected-direction">
                  <Image src={style.imageUrl} alt={style.name} />
                  <div>
                    <span className="eyebrow">YOUR DIRECTION</span>
                    <strong>{style.name}</strong>
                  </div>
                  <button
                    className="icon-button"
                    aria-label="Change style"
                    onClick={() =>
                      go({ screen: "discover", projectId: project?.id })
                    }
                  >
                    <Pencil size={16} />
                  </button>
                </div>
                <details className="photo-tips">
                  <summary>
                    A few tips for a better photo <Plus size={16} />
                  </summary>
                  <p>
                    Use a front three-quarter view in good light. Keep the whole
                    car and both visible wheels in frame. Avoid heavy
                    reflections, obstructions and extreme angles.
                  </p>
                  <p>
                    We validate the file, but do not claim to recognize your car
                    or assess its photo quality.
                  </p>
                </details>
                {project && (
                  <div className="photo-actions">
                    <button
                      className="text-button"
                      disabled={busy}
                      onClick={() => uploadInput.current?.click()}
                    >
                      <Upload size={16} />
                      Replace photo
                    </button>
                    {project.source !== "sample" && (
                      <button
                        className="text-button"
                        disabled={busy}
                        onClick={() => void useDemo()}
                      >
                        Use demo car
                      </button>
                    )}
                  </div>
                )}
                <label className="consent">
                  <input
                    type="checkbox"
                    disabled={busy || !project}
                    checked={consent}
                    onChange={(event) => setConsent(event.target.checked)}
                  />
                  <span>
                    I have permission to use this photo and agree to process it
                    to create this look.
                  </span>
                </label>
                {photoBlocked && (
                  <div className="inline-note">
                    Your photo is safely stored. This demo can generate color
                    studies on the demo car only; your photo requires a live
                    image provider.
                  </div>
                )}
                <button
                  className="button primary full"
                  aria-label="Generate 1 look"
                  disabled={
                    !project ||
                    !consent ||
                    busy ||
                    !online ||
                    !!activeTask ||
                    photoBlocked ||
                    !data.generationEnabled ||
                    data.credits < 1
                  }
                  onClick={() => void generate(false)}
                >
                  {busy ? (
                    <LoaderCircle className="spin" size={18} />
                  ) : (
                    <Sparkles size={18} />
                  )}
                  Generate 1 look
                  <ArrowRight size={18} />
                </button>
                <p className="fine-print centered">
                  1 {data.mode === "demo" ? "demo " : ""}credit · One image ·
                  Your original stays saved
                </p>
              </div>
            </div>
            <input
              ref={uploadInput}
              className="visually-hidden"
              type="file"
              accept="image/jpeg,image/png,image/webp"
              aria-label="Upload car photo"
              onChange={(event) => void uploadPhoto(event)}
            />
            <input
              ref={cameraInput}
              className="visually-hidden"
              type="file"
              accept="image/jpeg,image/png,image/webp"
              capture="environment"
              aria-label="Take car photo"
              onChange={(event) => void uploadPhoto(event)}
            />
          </section>
        )}
        {view.screen === "task" && task && (
          <section className="task-page">
            <div className="task-preview">
              <Image
                src={
                  project?.versions.find(
                    (item) => item.id === task.baseVersionId,
                  )?.imageUrl ??
                  project?.originalUrl ??
                  "/images/street-sport.jpg"
                }
                alt="Your car at the start of this look"
              />
              <span className="task-preview-label">
                {styleName(task.styleId)} /{" "}
                {task.intent === "refine" ? "NEW VERSION" : "NEW LOOK"}
              </span>
            </div>
            <div className="task-copy">
              <span className="eyebrow">
                YOUR LOOK / {task.status.toUpperCase()}
              </span>
              <h1>
                {taskHeading.split("\n")[0]}
                <br />
                {taskHeading.split("\n")[1]}
              </h1>
              <p>
                {task.status === "uncertain"
                  ? "An interrupted provider request is being resolved. We won’t send it again automatically."
                  : isActive(task)
                    ? "You can leave this page. The same task will be here when you return."
                    : (task.error ??
                      "Your new version is saved in your history.")}
              </p>
              {isActive(task) && (
                <div className="actual-progress">
                  <LoaderCircle className="spin" size={21} />
                  <span>
                    {task.status === "queued"
                      ? "Waiting to start"
                      : task.status === "uncertain"
                        ? "Resolving an interrupted request"
                        : data.mode === "demo"
                          ? "Preparing your demo color study"
                          : "Creating your look with the image provider"}
                  </span>
                </div>
              )}
              <button
                className="button primary"
                onClick={() =>
                  go({ screen: "discover", projectId: project?.id })
                }
              >
                Back to Discover <ArrowRight size={18} />
              </button>
              {task.status === "failed" && project && (
                <button
                  className="button secondary"
                  disabled={
                    busy ||
                    !!activeTask ||
                    !online ||
                    !data.generationEnabled ||
                    data.credits < 1
                  }
                  onClick={() => {
                    confirmation.current = null;
                    setModal("retry");
                  }}
                >
                  <RotateCcw size={17} />
                  Retry this request
                </button>
              )}
              {isActive(task) ? (
                <button
                  className="text-button"
                  disabled={busy}
                  onClick={() =>
                    void action(async () => {
                      await api.cancel(task.id);
                      await refresh();
                    })
                  }
                >
                  Cancel this look
                </button>
              ) : task.status === "succeeded" && task.versionId ? (
                <button
                  className="button secondary"
                  onClick={() =>
                    setScreen({
                      screen: "result",
                      projectId: task.projectId,
                      versionId: task.versionId!,
                    })
                  }
                >
                  Open result
                </button>
              ) : (
                <button
                  className="button secondary"
                  onClick={() => {
                    confirmation.current = null;
                    if (task.intent === "refine") {
                      const base = project?.versions.find(
                        (item) => item.id === task.baseVersionId,
                      );
                      if (base) startRefine(base);
                    } else
                      setScreen({
                        screen: "upload",
                        projectId: task.projectId,
                        styleId: task.styleId,
                      });
                  }}
                >
                  Review and try again
                </button>
              )}
              <p className="fine-print">
                {isActive(task)
                  ? "1 credit reserved. Failed or cancelled tasks return the credit."
                  : "Cancelled and failed tasks use no credits."}
              </p>
            </div>
          </section>
        )}
        {view.screen === "result" && project && version && (
          <section className="work-page result-page">
            <div className="result-heading">
              <button
                className="back-link"
                onClick={() => go({ screen: "looks" })}
              >
                <ArrowLeft size={16} />
                My Looks
              </button>
              <span className="eyebrow">
                A NEW PERSPECTIVE /{" "}
                {version.demo ? "DEMO COLOR STUDY" : "AI CONCEPT"}
              </span>
            </div>
            <div className="work-grid">
              <div>
                <div className="car-stage">
                  <div className="stage-toolbar">
                    <span className="version-pill">
                      V{project.versions.indexOf(version) + 1}
                    </span>
                    <span>{styleName(version.styleId)}</span>
                  </div>
                  <Image
                    current
                    src={version.imageUrl}
                    alt={`${project.name}: ${version.name}`}
                  />
                  <div className="stage-caption">
                    <span>{project.name.toUpperCase()}</span>
                    <button
                      className="text-button"
                      onClick={() => {
                        setCompareParent(false);
                        setModal("compare");
                      }}
                    >
                      <Columns2 size={15} />
                      Compare
                    </button>
                  </div>
                </div>
                <div className="version-strip" aria-label="Version history">
                  {project.versions.map((item, index) => (
                    <button
                      key={item.id}
                      aria-label={`Open V${index + 1}, ${styleName(item.styleId)}`}
                      aria-pressed={version.id === item.id}
                      className={version.id === item.id ? "selected" : ""}
                      onClick={() =>
                        setScreen({
                          screen: "result",
                          projectId: project.id,
                          versionId: item.id,
                        })
                      }
                    >
                      <Image src={item.imageUrl} alt="" />
                      <span>V{index + 1}</span>
                      {item.favorite && (
                        <Bookmark size={11} fill="currentColor" />
                      )}
                    </button>
                  ))}
                </div>
              </div>
              <div className="work-copy">
                <span className="eyebrow">LOOKING GOOD, FEELING LIKE YOU.</span>
                <h1>
                  Your car.
                  <br />
                  Another side.
                </h1>
                <button
                  className="look-name"
                  aria-label="Rename look"
                  onClick={() => openRename(project, true)}
                >
                  {version.name}
                  <Pencil size={14} />
                </button>
                <p className="muted">
                  {version.demo
                    ? "A sample-car color study. Your original and every successful version are already saved in your history."
                    : "An AI styling concept based on your photo. Your original and every successful version are saved in your history."}
                </p>
                <button
                  className={`button ${version.favorite ? "saved-button" : "primary"} full`}
                  aria-label={
                    version.favorite ? "Saved to My Looks" : "Save to My Looks"
                  }
                  disabled={busy}
                  onClick={() => void favorite()}
                >
                  <Bookmark
                    size={18}
                    fill={version.favorite ? "currentColor" : "none"}
                  />
                  {version.favorite ? "Saved to My Looks" : "Save to My Looks"}
                  {version.favorite && <Check size={17} />}
                </button>
                <button
                  className="button secondary full"
                  onClick={() => {
                    confirmation.current = null;
                    startRefine(version);
                  }}
                >
                  <SlidersHorizontal size={17} />
                  Refine this look <ArrowRight size={17} />
                </button>
                <button
                  className="button secondary full"
                  onClick={() => {
                    setExportKind("image");
                    setModal("export");
                  }}
                >
                  <Download size={17} />
                  Export image <ArrowUpRight size={17} />
                </button>
                <div className="result-other">
                  <button
                    className="text-button"
                    onClick={() =>
                      go({ screen: "discover", projectId: project.id })
                    }
                  >
                    Explore another style <ArrowUpRight size={16} />
                  </button>
                  <button
                    className="icon-button"
                    aria-label="Report a problem"
                    onClick={() => {
                      setReportInput("");
                      setModal("report");
                    }}
                  >
                    <Flag size={16} />
                  </button>
                </div>
                <p className="fine-print">
                  No extra generation to save, compare or export.
                </p>
              </div>
            </div>
          </section>
        )}
        {view.screen === "refine" && project && version && (
          <section className="work-page refine-page">
            <button
              className="back-link"
              onClick={() =>
                go({
                  screen: "result",
                  projectId: project.id,
                  versionId: version.id,
                })
              }
            >
              <ArrowLeft size={16} />
              Back to your look
            </button>
            <div className="work-grid">
              <div>
                <div className="car-stage">
                  <div className="stage-toolbar">
                    <span className="version-pill">
                      BASE / V{project.versions.indexOf(version) + 1}
                    </span>
                    <span>{styleName(version.styleId)}</span>
                  </div>
                  <Image
                    current
                    src={version.imageUrl}
                    alt="Current version, unchanged while you choose references"
                  />
                  <div className="stage-caption">
                    <span>YOUR CURRENT IMAGE</span>
                    <span>UNCHANGED</span>
                  </div>
                </div>
                <div className="draft-image-note">
                  <ShieldCheck size={16} />
                  <p>
                    Your image stays as it is while you choose.
                    <br />A new version is made only after you confirm.
                  </p>
                </div>
              </div>
              <div className="work-copy">
                <span className="eyebrow">A LITTLE MORE YOU.</span>
                <h1>
                  Fine-tune
                  <br />
                  the feeling.
                </h1>
                <p className="muted">
                  A few details can make all the difference.
                </p>
                <div
                  className="edit-tabs"
                  role="group"
                  aria-label="Choose an edit field"
                >
                  <button
                    aria-pressed={field === "wheelColor"}
                    className={field === "wheelColor" ? "selected" : ""}
                    onClick={() => setField("wheelColor")}
                  >
                    Wheel color
                  </button>
                  <button
                    aria-pressed={field === "bodyColor"}
                    className={field === "bodyColor" ? "selected" : ""}
                    onClick={() => setField("bodyColor")}
                  >
                    Body color
                  </button>
                </div>
                <div className="reference-title">
                  <span>COLOR REFERENCES</span>
                  <span>REFERENCE ONLY</span>
                </div>
                <div className="color-options">
                  {(field === "wheelColor" ? WHEEL_COLORS : BODY_COLORS).map(
                    (color) => (
                      <button
                        key={color.id}
                        className={`color-option ${target[field] === color.id ? "selected" : ""}`}
                        aria-pressed={target[field] === color.id}
                        onClick={() => chooseColor(color.id)}
                      >
                        <span
                          className={`color-swatch ${field === "wheelColor" && color.id !== "keep" ? "wheel-swatch" : ""} ${color.id === "keep" ? "keep-swatch" : ""}`}
                          style={{ "--swatch": color.hex } as CSSProperties}
                        >
                          {color.id === "keep" && <RotateCcw size={18} />}
                        </span>
                        <span>{color.label}</span>
                        {target[field] === color.id && <Check size={15} />}
                      </button>
                    ),
                  )}
                </div>
                <div className="draft-summary">
                  <strong>
                    {changes} {changes === 1 ? "change" : "changes"} selected.
                    Image not updated.
                  </strong>
                  <span>
                    {draftStatus || "Choose a reference to start your draft."}
                  </span>
                  <div className="draft-actions">
                    {draftStatus.startsWith("Draft not saved") && (
                      <button
                        className="text-button"
                        disabled={busy || !online}
                        onClick={() => void action(ensureDraftSaved)}
                      >
                        <RotateCcw size={15} />
                        Retry saving draft
                      </button>
                    )}
                    <button
                      className="text-button"
                      disabled={!undo.length}
                      onClick={() => {
                        const last = undo.at(-1)!;
                        setUndo((items) => items.slice(0, -1));
                        setTarget(last);
                        saveDraft(last);
                      }}
                    >
                      <Undo2 size={15} />
                      Undo selection
                    </button>
                    <button
                      className="text-button"
                      disabled={!changes}
                      onClick={() => {
                        setUndo((items) => [...items, target]);
                        setTarget({ ...KEEP_TARGET });
                        saveDraft({ ...KEEP_TARGET });
                      }}
                    >
                      Reset all
                    </button>
                  </div>
                </div>
                <button
                  className="button primary full"
                  disabled={
                    !changes ||
                    busy ||
                    draftStatus.startsWith("Saving") ||
                    !online ||
                    !!activeTask
                  }
                  onClick={() => setModal("review")}
                >
                  Review changes <ArrowRight size={18} />
                </button>
                <p className="fine-print centered">
                  Choosing references uses no credits.
                </p>
              </div>
            </div>
          </section>
        )}
        {view.screen === "looks" && (
          <section className="looks-page">
            <div className="section-heading">
              <div>
                <span className="eyebrow">YOUR PERSONAL COLLECTION</span>
                <h1>
                  My Looks<span className="title-dot">.</span>
                </h1>
              </div>
              <p>Good ideas deserve a place to stay.</p>
            </div>
            <div className="filter-row">
              <button
                className={collection === "Creations" ? "selected" : ""}
                aria-pressed={collection === "Creations"}
                onClick={() => setCollection("Creations")}
              >
                Creations
              </button>
              <button
                className={collection === "Saved styles" ? "selected" : ""}
                aria-pressed={collection === "Saved styles"}
                onClick={() => setCollection("Saved styles")}
              >
                Saved styles
              </button>
            </div>
            {collection === "Saved styles" ? (
              data.savedStyles.length ? (
                <div className="style-grid">
                  {STYLES.filter((item) =>
                    data.savedStyles.includes(item.id),
                  ).map((item, index) => (
                    <StyleCard
                      key={item.id}
                      style={item}
                      index={index}
                      saved
                      busy={busy}
                      onOpen={() => openStyle(item.id)}
                      onSave={() => void saveStyle(item.id)}
                    />
                  ))}
                </div>
              ) : (
                <Empty
                  title="A direction worth keeping."
                  text="Save a style as you explore. It will be waiting here when you’re ready."
                  onStart={() => go({ screen: "discover" })}
                />
              )
            ) : data.projects.length ? (
              <div className="creations-grid">
                {[...data.projects].reverse().map((car) => {
                  const latest = car.versions.at(-1);
                  return (
                    <article key={car.id} className="creation-card">
                      <button
                        className="creation-image"
                        aria-label={`Open ${car.name}`}
                        onClick={() =>
                          go(
                            latest
                              ? {
                                  screen: "result",
                                  projectId: car.id,
                                  versionId: latest.id,
                                }
                              : {
                                  screen: "upload",
                                  projectId: car.id,
                                  styleId: "sport",
                                },
                          )
                        }
                      >
                        <Image
                          src={latest?.imageUrl ?? car.originalUrl}
                          alt={car.name}
                        />
                        <span className="image-label">
                          {latest
                            ? `V${car.versions.length}${car.versions.some((item) => item.favorite) ? " / SAVED" : ""}`
                            : "ORIGINAL PHOTO"}
                        </span>
                        <span className="card-arrow">
                          <ArrowUpRight size={20} />
                        </span>
                      </button>
                      <div className="creation-info">
                        <div>
                          <h3>{car.name}</h3>
                          <p>
                            {latest
                              ? `${styleName(latest.styleId)} · ${car.versions.length} ${car.versions.length === 1 ? "version" : "versions"}`
                              : "Ready for a new direction"}
                            {car.draft && countChanges(car.draft.target) > 0
                              ? " · Draft saved"
                              : ""}
                          </p>
                        </div>
                        <button
                          className="icon-button"
                          aria-label={`Rename ${car.name}`}
                          onClick={() => openRename(car)}
                        >
                          <Pencil size={16} />
                        </button>
                        <button
                          className="icon-button"
                          aria-label={`Delete ${car.name}`}
                          onClick={() => {
                            setManageId(car.id);
                            setModal("delete");
                          }}
                        >
                          <Trash2 size={16} />
                        </button>
                      </div>
                    </article>
                  );
                })}
              </div>
            ) : (
              <Empty
                title="Your next favorite starts here."
                text="Every successful look is kept automatically. Save your favorites, compare versions and revisit an idea."
                onStart={() => go({ screen: "discover" })}
              />
            )}
          </section>
        )}
      </main>
      <footer className="site-footer">
        <span>FORM / A fresh perspective.</span>
        <span>
          {data.mode === "demo"
            ? "Demo studio · Color studies on a sample car"
            : "Personal styling studio"}
        </span>
        <button onClick={() => setModal("about")}>
          About & privacy <ArrowUpRight size={13} />
        </button>
      </footer>
      <nav className="mobile-nav" aria-label="Mobile navigation">
        <button
          className={view.screen !== "looks" ? "active" : ""}
          onClick={() => go({ screen: "discover", projectId: view.projectId })}
        >
          <Compass size={20} />
          Discover
        </button>
        <button
          className={view.screen === "looks" ? "active" : ""}
          onClick={() => go({ screen: "looks" })}
        >
          <Bookmark size={20} />
          My Looks
        </button>
      </nav>
      {toast && (
        <div className="toast" role="status">
          <Check size={17} />
          {toast}
        </div>
      )}
      {modal === "review" && version && project && (
        <Dialog title="Review changes" onClose={closeModal} error={error}>
          <span className="eyebrow">
            ONE NEW VERSION / {changes} SELECTED{" "}
            {changes === 1 ? "CHANGE" : "CHANGES"}
          </span>
          <h2>
            A few details.
            <br />A new feeling.
          </h2>
          <p>
            Starting from V{project.versions.indexOf(version) + 1}. Your current
            image stays in your history.
          </p>
          <div className="review-base">
            <Image
              src={version.imageUrl}
              alt="Base version for these changes"
            />
            <div>
              <strong>{styleName(version.styleId)}</strong>
              <span>V{project.versions.indexOf(version) + 1} / YOUR BASE</span>
            </div>
          </div>
          <div className="change-list">
            {(["bodyColor", "wheelColor"] as const).map((key) => (
              <div key={key}>
                <strong>
                  {key === "bodyColor" ? "Body paint" : "Wheel color"}
                </strong>
                <span>
                  {target[key] === "keep"
                    ? "Keep current"
                    : `${version.verifiedTarget ? colorName(version.verifiedTarget[key]) : "Current appearance"} → ${colorName(target[key])}`}
                </span>
              </div>
            ))}
          </div>
          <div className="inline-note">
            Both selections are combined into one version. Color references do
            not preview your car.
          </div>
          <button
            className="button primary full"
            aria-label="Generate 1 new version"
            disabled={
              busy || !changes || !online || !!activeTask || data.credits < 1
            }
            onClick={() => void generate(true)}
          >
            {busy ? (
              <LoaderCircle className="spin" size={18} />
            ) : (
              <Sparkles size={18} />
            )}
            Generate 1 new version
            <ArrowRight size={18} />
          </button>
          <p className="fine-print centered">
            1 {data.mode === "demo" ? "demo " : ""}credit · One image · Current
            version preserved
          </p>
        </Dialog>
      )}
      {modal === "retry" && task?.status === "failed" && project && (
        <Dialog title="Retry this request" onClose={closeModal} error={error}>
          <span className="eyebrow">YOUR ORIGINAL REQUEST</span>
          <h2>Give it another try.</h2>
          <p>
            The same photo and selections. Your failed attempt stays in history.
          </p>
          <div className="review-base">
            <Image
              src={
                project.versions.find((item) => item.id === task.baseVersionId)
                  ?.imageUrl ?? project.originalUrl
              }
              alt="The original base for this request"
            />
            <div>
              <strong>{styleName(task.styleId)}</strong>
              <span>
                {task.intent === "refine"
                  ? "SAME BASE VERSION"
                  : "ORIGINAL PHOTO"}
              </span>
            </div>
          </div>
          <div className="change-list">
            <div>
              <strong>Body paint</strong>
              <span>{colorName(task.target.bodyColor)}</span>
            </div>
            <div>
              <strong>Wheel color</strong>
              <span>{colorName(task.target.wheelColor)}</span>
            </div>
          </div>
          <button
            className="button primary full"
            disabled={
              busy ||
              !online ||
              !!activeTask ||
              !data.generationEnabled ||
              data.credits < 1
            }
            onClick={() => void retryTask()}
          >
            {busy ? (
              <LoaderCircle className="spin" size={18} />
            ) : (
              <RotateCcw size={18} />
            )}
            Confirm retry
            <ArrowRight size={18} />
          </button>
          <p className="fine-print centered">
            1 {data.mode === "demo" ? "demo " : ""}credit · One image
          </p>
        </Dialog>
      )}
      {modal === "compare" && version && project && (
        <Dialog
          title="Compare your look"
          wide
          onClose={closeModal}
          error={error}
        >
          <span className="eyebrow">A DIFFERENT PERSPECTIVE</span>
          <h2>See the difference.</h2>
          <div className="compare-tabs segmented">
            <button
              className={!compareParent ? "selected" : ""}
              aria-pressed={!compareParent}
              onClick={() => setCompareParent(false)}
            >
              Original / Current
            </button>
            {version.parentVersionId && (
              <button
                className={compareParent ? "selected" : ""}
                aria-pressed={compareParent}
                onClick={() => setCompareParent(true)}
              >
                Previous / Current
              </button>
            )}
          </div>
          <Comparison
            key={`${version.id}-${compareParent}`}
            beforeUrl={
              compareParent
                ? (project.versions.find(
                    (item) => item.id === version.parentVersionId,
                  )?.imageUrl ?? project.originalUrl)
                : project.originalUrl
            }
            afterUrl={version.imageUrl}
            beforeLabel={compareParent ? "Previous" : "Original"}
          />
          <p className="fine-print">
            {compareParent
              ? "Compared with the actual version this look was created from."
              : "Compared with your saved original photo."}
          </p>
        </Dialog>
      )}
      {modal === "export" && version && project && (
        <Dialog title="Export image" onClose={closeModal} error={error}>
          <span className="eyebrow">A LOOK WORTH KEEPING</span>
          <h2>Take it with you.</h2>
          <p>Made from your existing images. No new generation.</p>
          <div className={`export-preview ${exportKind}`}>
            <Image
              src={version.imageUrl}
              alt="Your look, fitted completely in the export frame"
            />
          </div>
          <div className="export-options">
            {(
              [
                { id: "image", label: "Image", note: "Full image · PNG" },
                {
                  id: "wallpaper",
                  label: "Wallpaper",
                  note: "1080 × 1920 · Full car",
                },
                {
                  id: "comparison",
                  label: "Before & After",
                  note: "Original and current",
                },
              ] as const
            ).map((item) => (
              <button
                key={item.id}
                aria-label={item.label}
                aria-pressed={exportKind === item.id}
                className={exportKind === item.id ? "selected" : ""}
                onClick={() => setExportKind(item.id)}
              >
                <span>
                  {item.label}
                  <small>{item.note}</small>
                </span>
                {exportKind === item.id && <Check size={17} />}
              </button>
            ))}
          </div>
          <button
            className="button primary full"
            disabled={busy}
            onClick={() =>
              void action(async () => {
                await exportLook({
                  kind: exportKind,
                  imageUrl: version.imageUrl,
                  originalUrl: project.originalUrl,
                  filename: `form-${project.name}-v${project.versions.indexOf(version) + 1}-${exportKind}`,
                });
                notify("Image downloaded");
              })
            }
          >
            <Download size={18} />
            {busy ? "Preparing image…" : "Download image"}
          </button>
        </Dialog>
      )}
      {modal === "leave" && (
        <Dialog title="Keep your draft?" onClose={closeModal} error={error}>
          <span className="eyebrow">YOU HAVE A DRAFT</span>
          <h2>Keep that thought?</h2>
          <p>
            {changes} {changes === 1 ? "change is" : "changes are"} selected.
            Your image has not been updated.
          </p>
          <button
            className="button primary full"
            disabled={busy}
            onClick={() =>
              void action(async () => {
                await ensureDraftSaved();
                setModal(null);
                setScreen(pendingView.current ?? { screen: "discover" });
              })
            }
          >
            Keep draft & leave <ArrowRight size={18} />
          </button>
          <button
            className="button secondary full"
            disabled={busy}
            onClick={() =>
              void action(async () => {
                await queue.current.catch(() => undefined);
                if (project)
                  await api.updateProject(project.id, { draft: null });
                await refresh();
                setTarget({ ...KEEP_TARGET });
                setModal(null);
                setScreen(pendingView.current ?? { screen: "discover" });
              })
            }
          >
            Discard changes
          </button>
          <button className="text-button centered full" onClick={closeModal}>
            Continue choosing
          </button>
        </Dialog>
      )}
      {modal === "conflict" && project && (
        <Dialog
          title="A draft is already saved"
          onClose={closeModal}
          error={error}
        >
          <span className="eyebrow">ONE DRAFT / ONE BASE VERSION</span>
          <h2>
            Pick up where
            <br />
            you left off?
          </h2>
          <p>
            A draft belongs to another version of this car. Choose where you
            want to continue.
          </p>
          <button
            className="button primary full"
            onClick={() => {
              const base = project.versions.find(
                (item) => item.id === project.draft?.baseVersionId,
              );
              if (base) {
                setModal(null);
                startRefine(base);
              }
            }}
          >
            Continue saved draft
          </button>
          <button
            className="button secondary full"
            disabled={busy}
            onClick={() =>
              void action(async () => {
                await api.updateProject(project.id, { draft: null });
                await refresh();
                setModal(null);
                if (conflictingVersion.current)
                  startRefine(conflictingVersion.current, true);
              })
            }
          >
            Discard draft & start here
          </button>
          <button className="text-button centered full" onClick={closeModal}>
            Keep viewing this look
          </button>
        </Dialog>
      )}
      {modal === "rename" && manageProject && (
        <Dialog title="Rename your look" onClose={closeModal} error={error}>
          <span className="eyebrow">MAKE IT PERSONAL</span>
          <h2>A name that fits.</h2>
          <form
            onSubmit={(event) => {
              event.preventDefault();
              void action(async () => {
                if (renameVersion && version)
                  await api.updateVersion(version.id, { name: nameInput });
                else
                  await api.updateProject(manageProject.id, {
                    name: nameInput,
                  });
                await refresh();
                setModal(null);
                notify("Name updated");
              });
            }}
          >
            <label className="form-field">
              {renameVersion ? "Look name" : "Car name"}
              <input
                autoFocus
                maxLength={80}
                required
                value={nameInput}
                onChange={(event) => setNameInput(event.target.value)}
              />
            </label>
            <button
              className="button primary full"
              disabled={busy || !nameInput.trim()}
            >
              Save name <Check size={17} />
            </button>
          </form>
        </Dialog>
      )}
      {modal === "delete" && manageProject && (
        <Dialog
          title="Delete this car and its looks?"
          onClose={closeModal}
          error={error}
        >
          <span className="eyebrow">YOUR COLLECTION</span>
          <h2>Delete this car?</h2>
          <p>
            This removes {manageProject.name}, its original photo, draft and{" "}
            {manageProject.versions.length}{" "}
            {manageProject.versions.length === 1 ? "version" : "versions"} from
            your workspace. This cannot be undone.
          </p>
          <button
            className="button danger full"
            disabled={busy}
            onClick={() =>
              void action(async () => {
                await api.deleteProject(manageProject.id);
                await refresh();
                setModal(null);
                notify("Car and looks deleted");
              })
            }
          >
            <Trash2 size={17} />
            Delete car and looks
          </button>
          <button className="button secondary full" onClick={closeModal}>
            Keep this car
          </button>
        </Dialog>
      )}
      {modal === "report" && version && (
        <Dialog title="Report a problem" onClose={closeModal} error={error}>
          <span className="eyebrow">HELP IMPROVE THE RESULT</span>
          <h2>What feels off?</h2>
          <p>
            This records feedback in your workspace. It does not generate
            another image or use a credit.
          </p>
          <form
            onSubmit={(event) => {
              event.preventDefault();
              void action(async () => {
                const sourceTask = data.tasks.find(
                  (item) => item.versionId === version.id,
                );
                if (!sourceTask)
                  throw new Error(
                    "The original generation task was not found.",
                  );
                await api.report(sourceTask.id, reportInput);
                setModal(null);
                notify("Feedback recorded");
              });
            }}
          >
            <label className="form-field">
              Tell us about the result
              <textarea
                required
                maxLength={1000}
                rows={4}
                value={reportInput}
                onChange={(event) => setReportInput(event.target.value)}
                placeholder="The wheels, car identity, proportions, or something else…"
              />
            </label>
            <button
              className="button primary full"
              disabled={busy || !reportInput.trim()}
            >
              Record feedback <ArrowRight size={17} />
            </button>
          </form>
        </Dialog>
      )}
      {modal === "credits" && (
        <Dialog title="Your credits" onClose={closeModal} error={error}>
          <span className="eyebrow">YOUR STUDIO BALANCE</span>
          <h2>
            {data.credits} {data.mode === "demo" ? "demo credits" : "credits"}
            <span className="title-dot">.</span>
          </h2>
          <p>
            {data.reservedCredits} reserved for active tasks. A credit is used
            only for a successfully completed look.
          </p>
          <div className="change-list">
            <div>
              <strong>Browse, choose, save & export</strong>
              <span>Free</span>
            </div>
            <div>
              <strong>Generate a look or version</strong>
              <span>1 credit</span>
            </div>
            <div>
              <strong>Failed or cancelled task</strong>
              <span>Credit returned</span>
            </div>
          </div>
          <p className="fine-print">
            {data.mode === "demo"
              ? "These are demonstration credits with no monetary value. There is no purchase flow in this build."
              : "Credits are allocated by the studio operator. There is no purchase flow in this build."}
          </p>
          <button className="button primary full" onClick={closeModal}>
            Back to the studio
          </button>
        </Dialog>
      )}
      {modal === "about" && (
        <Dialog title="About FORM" onClose={closeModal} error={error}>
          <span className="eyebrow">FORM / PERSONAL CAR STUDIO</span>
          <h2>
            Your car.
            <br />
            Your point of view.
          </h2>
          <p>
            A place to discover a look, explore an idea and keep something you
            love.
          </p>
          <div className="about-section">
            <h3>
              {data.mode === "demo" ? "An honest demo" : "AI styling concepts"}
            </h3>
            <p>
              {data.mode === "demo"
                ? "All eight previews use the same supplied sample photograph. The demo changes paint and wheel color only. It does not generate AI styling on uploaded photos."
                : "Your original or selected base image is sent to the configured image provider only when you confirm generation. Results are visual concepts, not mechanical fitment advice."}
            </p>
            <h3>Your photos & history</h3>
            <p>
              Your original, versions, draft and feedback are stored on this
              server and isolated by your browser session. Delete a car in My
              Looks to remove its images. Keep this browser’s cookies to revisit
              your collection.
            </p>
            <h3>Made for exploration</h3>
            <p>
              Colors, parts and stance shown here are visual ideas. They do not
              guarantee real-world parts, color accuracy, legality or fitment.
              No car recognition or automated photo quality claims are made.
            </p>
          </div>
          <button className="button primary full" onClick={closeModal}>
            Keep exploring <ArrowRight size={18} />
          </button>
        </Dialog>
      )}
    </div>
  );
}

function StyleCard({
  style,
  index,
  saved,
  busy,
  onOpen,
  onSave,
}: {
  style: StyleDefinition;
  index: number;
  saved: boolean;
  busy: boolean;
  onOpen: () => void;
  onSave: () => void;
}) {
  return (
    <article
      className="style-card"
      style={{ "--card-delay": `${index * 35}ms` } as CSSProperties}
    >
      <div className="style-image">
        <button
          aria-label={`Explore ${style.name}`}
          className="style-image-button"
          onClick={onOpen}
        >
          <Image
            src={style.imageUrl}
            alt={`${style.name} demo color palette on a sample Golf`}
          />
          <span className="card-arrow">
            <ArrowUpRight size={23} />
          </span>
        </button>
        <span className="image-label">
          {style.category.toUpperCase()} / COLOR STUDY
        </span>
        <button
          className={`save-style ${saved ? "saved" : ""}`}
          aria-label={`${saved ? "Unsave" : "Save"} ${style.name} style`}
          disabled={busy}
          onClick={onSave}
        >
          <Bookmark size={18} fill={saved ? "currentColor" : "none"} />
        </button>
      </div>
      <div className="style-card-info">
        <div>
          <h3>{style.name}</h3>
          <p>{style.description}</p>
        </div>
        <span className="style-number">
          {String(
            STYLES.findIndex((item) => item.id === style.id) + 1,
          ).padStart(2, "0")}
        </span>
      </div>
    </article>
  );
}
function Empty({
  title,
  text,
  onStart,
}: {
  title: string;
  text: string;
  onStart: () => void;
}) {
  return (
    <div className="empty-state">
      <Bookmark size={37} strokeWidth={1} />
      <h2>{title}</h2>
      <p>{text}</p>
      <button className="button primary" onClick={onStart}>
        Explore directions <ArrowRight size={18} />
      </button>
    </div>
  );
}
