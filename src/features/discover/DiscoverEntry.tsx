import { useEffect, useState, type ReactNode } from 'react';
import type { EditRequest, SourceRef } from '../../../shared/v2/edit-plan.js';
import { canExplore, DISCOVER, guardedEntry, originalIntent, publishedExample, type EntryCapabilities, type EntryView, type RecentEntry } from '../navigation/entry.js';
import './discover.css';

export interface DiscoverEntryProps {
  ownerId: string | null;
  capabilities: EntryCapabilities;
  recent: readonly RecentEntry[];
  restoredView?: unknown;
  renderPhoto(intent: EditRequest): ReactNode;
  onOpenProject(projectId: string, source: SourceRef): void;
  onOpenTask(taskId: string): void;
}

/** Isolated F13 flow. Service-backed publication/history are supplied at F32 wiring. */
export function DiscoverEntry(props: DiscoverEntryProps) {
  const [navigation, setNavigation] = useState(() => ({ owner: props.ownerId, view: guardedEntry(props.restoredView, props.capabilities) }));
  const view = navigation.owner === props.ownerId ? guardedEntry(navigation.view, props.capabilities) : DISCOVER;
  const example = publishedExample(props.capabilities);
  const enabled = canExplore(props.capabilities);
  const recent = props.ownerId ? props.recent.filter(item => item.ownerId === props.ownerId).slice(0, 20) : [];

  useEffect(() => {
    setNavigation(previous => {
      const next = previous.owner === props.ownerId ? guardedEntry(previous.view, props.capabilities) : DISCOVER;
      return previous.owner === props.ownerId && previous.view === next ? previous : { owner: props.ownerId, view: next };
    });
  }, [props.ownerId, props.capabilities]);

  function go(next: EntryView) { setNavigation({ owner: props.ownerId, view: guardedEntry(next, props.capabilities) }); }
  function choose(operation: 'explore' | 'detail') {
    const intent = originalIntent(operation, props.capabilities);
    if (intent) go({ screen: 'photo', intent });
  }

  if (view.screen === 'photo') return <div className="entry-flow">
    <nav aria-label="Photo navigation"><button type="button" onClick={() => go(DISCOVER)}>Back to Discover</button></nav>
    <p className="entry-source">Original photo · {view.intent.operation === 'explore' ? `Direction: ${view.intent.styleId}` : 'One detail, no full style'}</p>
    {props.renderPhoto(view.intent)}
  </div>;

  return <main className="entry-flow">
    <header className="entry-header"><span className="entry-wordmark">FORM</span><span>YOUR CAR, YOUR DIRECTION</span></header>
    {view.screen === 'details' && example ? <section className="entry-details">
      <button type="button" onClick={() => go(DISCOVER)}>Back to Discover</button>
      <p className="entry-eyebrow">{example.name}</p><h1>About this direction</h1>
      <p>{example.description}</p>
      <p>Example - not your car</p>
      <button type="button" className="entry-primary" disabled={!enabled} onClick={() => choose('explore')}>Try this look on my car</button>
      {!enabled && <p>This direction is not available for new looks.</p>}
    </section> : <>
      {!!recent.length && <section className="entry-recent" aria-label="Your work">
        <h2>Pick up where you left off</h2>
        <div className="entry-projects">{recent.map(item => <article key={item.projectId}>
          {item.thumbnailUrl ? <img src={item.thumbnailUrl} alt={`${item.name} selected version`} /> : <p>Image unavailable</p>}
          <h3>{item.name}</h3>
          <p>{item.favorite ? 'Favorite' : 'Selected version'}{item.styleId ? ` · ${item.styleId}` : ''}</p>
          <button type="button" onClick={() => props.onOpenProject(item.projectId, item.selectedSource)}>Continue {item.name}</button>
          {item.activeTaskId && <button type="button" onClick={() => props.onOpenTask(item.activeTaskId!)}>Check active task</button>}
        </article>)}</div>
      </section>}
      <section className="entry-hero" aria-labelledby="entry-title">
        <div className="entry-heading"><p className="entry-eyebrow">DISCOVER</p><h1 id="entry-title">Find your next look.</h1></div>
        {example ? <figure className="entry-case">
          <div><img src={example.beforeUrl} alt={`${example.name} case before`} /><img src={example.afterUrl} alt={`${example.name} case after`} /></div>
          <figcaption><strong>{example.name}</strong><span>Example - not your car</span></figcaption>
        </figure> : <p className="entry-missing">A verified example is not available yet.</p>}
        <div className="entry-actions">
          <button type="button" className="entry-primary" disabled={!enabled} onClick={() => choose('explore')}>Try this look on my car</button>
          {example && <button type="button" onClick={() => go({ screen: 'details' })}>View style details</button>}
          <button type="button" disabled={!props.capabilities.detail} onClick={() => choose('detail')}>Change one detail</button>
        </div>
        {!enabled && example && <p>This direction is not available for new looks.</p>}
        {!props.capabilities.detail && <p>Detail editing is not available right now.</p>}
      </section>
    </>}
    <footer className="entry-footer">AI styling concept. No guarantee of real-world fitment, material color accuracy or road legality.</footer>
  </main>;
}
