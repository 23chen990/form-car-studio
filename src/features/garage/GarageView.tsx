import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Comparison } from '../../components/Comparison.js';
import type { ResultProjectSnapshot, ResultVersionSnapshot } from '../result/ResultView.js';
import { createGarageExport, type GarageExportFile, type GarageExportKind, type OwnedAssetBlob } from '../../lib/export-v2.js';
import './garage.css';

export interface GarageProjectSnapshot extends ResultProjectSnapshot { coverVersionId: string | null }
export interface GarageAssetRequest { ownerId: string; projectId: string; assetId: string; source: { kind: 'original' } | { kind: 'version'; versionId: string } }
export interface GarageFavoriteRequest { ownerId: string; projectId: string; versionId: string; favorite: boolean }
export interface GarageCoverRequest { ownerId: string; projectId: string; versionId: string }
export interface GarageRenameRequest { ownerId: string; projectId: string; name: string }
export interface GarageDeleteRequest { ownerId: string; projectId: string; versionId: string }
export type GarageShareOutcome = 'opened' | 'cancelled' | 'unavailable';
export interface GarageServicePort {
  setFavorite(request: GarageFavoriteRequest): Promise<GarageProjectSnapshot>;
  setCover(request: GarageCoverRequest): Promise<GarageProjectSnapshot>;
  renameProject(request: GarageRenameRequest): Promise<GarageProjectSnapshot>;
  deleteVersion(request: GarageDeleteRequest): Promise<GarageProjectSnapshot>;
  loadOwnedAsset(request: GarageAssetRequest): Promise<OwnedAssetBlob>;
  share(request: { ownerId: string; projectId: string; versionId: string; file: GarageExportFile }): Promise<GarageShareOutcome>;
}
export interface GarageViewProps { ownerId: string; project: GarageProjectSnapshot; service: GarageServicePort; initialVersionId?: string }

function validProject(project: GarageProjectSnapshot, ownerId: string): boolean {
  const ids = new Set<string>();
  return project.loadedForOwnerId === ownerId && project.id.length > 0 && project.versions.every(version => {
    if (version.projectId !== project.id || !version.id || ids.has(version.id)) return false;
    ids.add(version.id); return true;
  }) && (!project.coverVersionId || ids.has(project.coverVersionId));
}
function sameRecipeGraph(before: GarageProjectSnapshot, after: GarageProjectSnapshot): boolean {
  return before.coverVersionId === after.coverVersionId && before.versions.length === after.versions.length && before.versions.every(version => {
    const next = after.versions.find(item => item.id === version.id);
    return !!next && next.parentVersionId === version.parentVersionId && next.favorite === version.favorite &&
      next.name === version.name && next.taskId === version.taskId && next.displayAssetId === version.displayAssetId &&
      next.displayUrl === version.displayUrl && next.verification === version.verification &&
      JSON.stringify(next.desiredRecipe) === JSON.stringify(version.desiredRecipe);
  });
}

export function GarageView(props: GarageViewProps) {
  if (!validProject(props.project, props.ownerId)) return <main className="v2-garage"><section role="region" aria-label="Garage"><h1>Garage unavailable</h1><p>This saved project is unavailable for this account.</p></section></main>;
  return <GarageSession key={`${props.ownerId}:${props.project.id}`} {...props} />;
}

function GarageSession({ ownerId, project: initialProject, service, initialVersionId }: GarageViewProps) {
  const [project, setProject] = useState(initialProject);
  const [selectedId, setSelectedId] = useState<string | null>(initialVersionId ?? initialProject.versions[0]?.id ?? null);
  const [baseline, setBaseline] = useState('original');
  const [favoritesOnly, setFavoritesOnly] = useState(false);
  const [rename, setRename] = useState(initialProject.name);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [exported, setExported] = useState<{ file: GarageExportFile; url: string } | null>(null);
  const mounted = useRef(true), generation = useRef(0), selectedRef = useRef(selectedId), objectUrl = useRef('');
  const lastCanonical = useRef(initialProject), lastReceived = useRef(initialProject);
  const versions = useMemo(() => project.versions.filter(version => version.projectId === project.id), [project]);
  const visibleVersions = favoritesOnly ? versions.filter(version => version.favorite) : versions;
  const selected = versions.find(version => version.id === selectedId);
  const cover = project.coverVersionId ? versions.find(version => version.id === project.coverVersionId) : undefined;
  const originalAvailable = !!project.originalAssetId && !!project.originalUrl;
  const coverUrl = cover?.displayUrl ?? (project.coverVersionId === null && originalAvailable ? project.originalUrl : null);
  const compareVersion = baseline === 'original' ? undefined : versions.find(version => version.id === baseline);
  const compareUrl = baseline === 'original' ? project.originalUrl : compareVersion?.displayUrl;

  useEffect(() => { mounted.current = true; return () => { mounted.current = false; if (objectUrl.current) URL.revokeObjectURL(objectUrl.current); }; }, []);
  useLayoutEffect(() => {
    const previous = lastCanonical.current;
    if (lastReceived.current === initialProject) return;
    lastReceived.current = initialProject; lastCanonical.current = initialProject;
    generation.current++;
    if (objectUrl.current) URL.revokeObjectURL(objectUrl.current);
    objectUrl.current = ''; setExported(null); setMessage(''); setError('');
    setProject(initialProject);
    setRename(value => value === previous.name ? initialProject.name : value);
    if (selectedRef.current && !initialProject.versions.some(version => version.id === selectedRef.current)) {
      selectedRef.current = null; setSelectedId(null);
    }
    if (baseline !== 'original' && !initialProject.versions.some(version => version.id === baseline)) setBaseline('original');
  }, [initialProject, baseline]);
  useEffect(() => {
    if (objectUrl.current) URL.revokeObjectURL(objectUrl.current);
    objectUrl.current = ''; setExported(null);
  }, [selectedId]);

  function chooseVersion(id: string) { generation.current++; selectedRef.current = id; setSelectedId(id); setBaseline('original'); setMessage(''); setError(''); }
  function ticket() { return { generation: generation.current, selectedId: selectedRef.current }; }
  function current(stamp: ReturnType<typeof ticket>) { return mounted.current && stamp.generation === generation.current && stamp.selectedId === selectedRef.current; }
  function accept(snapshot: GarageProjectSnapshot) {
    if (!validProject(snapshot, ownerId) || snapshot.id !== project.id) throw new Error('The service returned a different project or owner.');
    lastCanonical.current = snapshot;
    setProject(snapshot); setRename(snapshot.name);
    if (selectedRef.current && !snapshot.versions.some(version => version.id === selectedRef.current)) {
      selectedRef.current = null; generation.current++; setSelectedId(null);
    }
  }
  async function mutate(action: () => Promise<GarageProjectSnapshot>, verify: (snapshot: GarageProjectSnapshot) => boolean, success: string) {
    if (busy) return;
    const stamp = ticket(); setBusy(true); setError(''); setMessage('');
    try {
      const snapshot = await action();
      if (!current(stamp)) return;
      if (!verify(snapshot)) throw new Error('The saved project did not match the requested change.');
      accept(snapshot); setMessage(success);
    } catch {
      if (current(stamp)) setError('This change was not confirmed. The saved project remains unchanged here.');
    } finally { if (mounted.current) setBusy(false); }
  }
  async function favorite(version: ResultVersionSnapshot) {
    const favorite = !version.favorite;
    await mutate(() => service.setFavorite({ ownerId, projectId: project.id, versionId: version.id, favorite }),
      snapshot => snapshot.versions.find(item => item.id === version.id)?.favorite === favorite, favorite ? 'Added to favorites.' : 'Removed from favorites.');
  }
  async function setCover(version: ResultVersionSnapshot) {
    await mutate(() => service.setCover({ ownerId, projectId: project.id, versionId: version.id }),
      snapshot => snapshot.coverVersionId === version.id, 'Project cover updated.');
  }
  async function saveRename() {
    const name = rename.trim();
    if (!name || name === project.name) return;
    await mutate(() => service.renameProject({ ownerId, projectId: project.id, name }),
      snapshot => snapshot.name === name && sameRecipeGraph(project, snapshot), 'Project name saved.');
  }
  async function removeVersion(version: ResultVersionSnapshot) {
    const before = project;
    await mutate(() => service.deleteVersion({ ownerId, projectId: project.id, versionId: version.id }), snapshot =>
      !snapshot.versions.some(item => item.id === version.id) && before.versions.filter(item => item.id !== version.id).every(item => {
        const remaining = snapshot.versions.find(next => next.id === item.id);
        return remaining?.parentVersionId === item.parentVersionId;
      }), 'Version removed.');
  }
  async function makeExport(kind: GarageExportKind) {
    if (!selected || busy || !selected.displayAssetId) return;
    const stamp = ticket(); setBusy(true); setError(''); setMessage('');
    try {
      const asset = await service.loadOwnedAsset({ ownerId, projectId: project.id, assetId: selected.displayAssetId,
        source: { kind: 'version', versionId: selected.id } });
      let comparison: { versionId: string; assetId: string; asset: OwnedAssetBlob } | undefined;
      if (kind === 'comparison') {
        const assetId = baseline === 'original' ? project.originalAssetId : compareVersion?.displayAssetId;
        if (!assetId) throw new Error('Comparison image is unavailable.');
        const source = baseline === 'original' ? { kind: 'original' as const } : { kind: 'version' as const, versionId: baseline };
        comparison = { versionId: baseline, assetId, asset: await service.loadOwnedAsset({ ownerId, projectId: project.id, assetId, source }) };
      }
      const file = await createGarageExport({ kind, ownerId, projectId: project.id, versionId: selected.id, assetId: selected.displayAssetId, asset,
        ...(comparison ? { comparison } : {}), recipe: selected.desiredRecipe });
      if (!current(stamp)) return;
      if (objectUrl.current) URL.revokeObjectURL(objectUrl.current);
      const url = URL.createObjectURL(file.blob); objectUrl.current = url; setExported({ file, url });
      setMessage('Static image is ready. Dimensions are shown below.');
    } catch { if (current(stamp)) setError('Export is unavailable for this saved image. Check its owner-scoped image and try again.'); }
    finally { if (mounted.current) setBusy(false); }
  }
  async function shareExport() {
    if (!exported || !selected || exported.file.versionId !== selected.id || busy) return;
    const stamp = ticket(), file = exported.file; setBusy(true); setError(''); setMessage('');
    try {
      const outcome = await service.share({ ownerId, projectId: project.id, versionId: selected.id, file });
      if (!current(stamp)) return;
      setMessage(outcome === 'opened' ? 'Share sheet opened. No post outcome is reported.' : outcome === 'cancelled' ? 'Sharing cancelled.' : 'Sharing is unavailable here.');
    } catch { if (current(stamp)) setError('Sharing could not be opened. The image remains available to download.'); }
    finally { if (mounted.current) setBusy(false); }
  }
  const coverLabel = cover ? `Project cover: ${cover.name}` : project.coverVersionId === null && originalAvailable ? 'Project cover: Original' : 'Project cover unavailable';

  return <main className="v2-garage"><section className="v2-garage__panel" role="region" aria-label="Garage" data-project-id={project.id}>
    <header className="v2-garage__header"><p className="v2-garage__eyebrow">YOUR GARAGE</p><h1>Garage</h1>
      <form className="v2-garage__rename" onSubmit={event => { event.preventDefault(); void saveRename(); }}>
        <label htmlFor="garage-project-name">Project name</label><input id="garage-project-name" value={rename} maxLength={80} onChange={event => setRename(event.target.value)} />
        <button type="submit" disabled={busy || !rename.trim()}>Save name</button>
      </form>
    </header>
    <section className="v2-garage__cover" aria-label="Current project cover">
      <h2>{project.name}</h2>{coverUrl ? <img src={coverUrl} alt={coverLabel} /> : <p role="status">{coverLabel}</p>}
      <p>{cover ? `Selected cover · ${cover.name}` : project.coverVersionId === null && originalAvailable ? 'Original cover' : 'Cover unavailable'}</p>
    </section>
    <section className="v2-garage__versions" aria-label="Saved versions"><h2>Saved versions</h2>
      <button type="button" aria-pressed={favoritesOnly} onClick={() => setFavoritesOnly(value => !value)}>Show favorites only</button>
      {favoritesOnly && visibleVersions.length === 0 && <p role="status">No favorite versions yet.</p>}
      {!favoritesOnly && versions.length === 0 && <p>No saved versions are available. The original project is preserved.</p>}
      <div className="v2-garage__cards">{visibleVersions.map(version => <article className="v2-garage__card" key={version.id} data-version-id={version.id}>
        <button className="v2-garage__select" type="button" aria-pressed={version.id === selectedId} onClick={() => chooseVersion(version.id)}>
          {version.displayUrl ? <img src={version.displayUrl} alt={`${version.name} saved image`} /> : <span>Saved image unavailable</span>}
          <span>{version.name}</span>
        </button>
        <p>{version.parentVersionId ? versions.some(item => item.id === version.parentVersionId) ? `Parent · ${versions.find(item => item.id === version.parentVersionId)!.name}` : 'Parent version unavailable' : 'Original version'}</p>
        <button type="button" aria-label={`${version.name}, ${version.favorite ? 'favorited' : 'not favorited'}`} aria-pressed={version.favorite} disabled={busy}
          onClick={() => void favorite(version)}>{version.favorite ? '★ Favorited' : '☆ Add favorite'}</button>
        <button type="button" disabled={busy} onClick={() => void setCover(version)}>Set as project cover</button>
        <button type="button" disabled={busy} onClick={() => void removeVersion(version)}>Delete version</button>
        <small>V{versions.indexOf(version) + 1} · {version.verification === 'unverified' ? 'Unverified image' : 'No image verification claimed'}</small>
      </article>)}</div>
    </section>
    {selected && <section className="v2-garage__detail" aria-label="Selected version" data-selected-version={selected.id}>
      <h2>Selected version: {selected.name}</h2><p>Requested changes · not a verified description of the image</p>
      {selected.desiredRecipe.length ? <ul>{selected.desiredRecipe.map((item, index) => <li key={`${index}:${item}`}>{item}</li>)}</ul> : <p>No saved request details are available.</p>}
      <label htmlFor="garage-compare">Compare this version with</label><select id="garage-compare" value={baseline} onChange={event => setBaseline(event.target.value)}>
        {project.originalAssetId && <option value="original">Original</option>}{versions.filter(item => item.id !== selected.id).map(item => <option key={item.id} value={item.id}>{item.name}</option>)}
      </select>
      {selected.displayUrl && compareUrl ? <div className="v2-garage__comparison" data-testid="garage-comparison" data-before-source={baseline}>
        <Comparison beforeUrl={compareUrl} afterUrl={selected.displayUrl} beforeLabel={baseline === 'original' ? 'Original' : compareVersion?.name ?? 'Saved version'} />
      </div> : <p role="status">Comparison image unavailable.</p>}
      <div className="v2-garage__exports" aria-label="Static image exports">
        <button type="button" disabled={busy || !selected.displayAssetId} onClick={() => void makeExport('clean')}>Export clean image</button>
        <button type="button" disabled={busy || !selected.displayAssetId || (baseline !== 'original' && !compareVersion?.displayAssetId)} onClick={() => void makeExport('comparison')}>Export comparison image</button>
        <button type="button" disabled={busy || !selected.displayAssetId} onClick={() => void makeExport('recipe')}>Export portrait recipe</button>
      </div>
      {exported?.file.versionId === selected.id && <section className="v2-garage__export-result" aria-label="Static export">
        <h3>Static image ready · {exported.file.width} × {exported.file.height}</h3><img src={exported.url} alt="Static export preview" data-export-dimensions={`${exported.file.width}x${exported.file.height}`} />
        <a href={exported.url} download={exported.file.filename}>Download PNG</a><button type="button" disabled={busy} onClick={() => void shareExport()}>Open share sheet</button>
      </section>}
    </section>}
    {error && <p role="alert">{error}</p>}{message && <p role="status" data-testid="garage-status">{message}</p>}
    <p className="v2-garage__note">Comparing and exporting use your saved images.</p>
  </section></main>;
}
