import { useEffect, useMemo, useState, type FormEvent, type ReactNode } from 'react';
import {
  Link,
  NavLink,
  Route,
  Routes,
  useNavigate,
  useParams,
  useSearchParams,
} from 'react-router-dom';
import type {
  Page,
  PublicEventDetailDto,
  PublicEventSummaryDto,
  SearchMetadataDto,
} from '@delaware-scene/contracts';
import { ExternalLink, Field, Pagination, ResultsStatus } from '@delaware-scene/ui';
import { api, ApiError } from './api.js';

const navigation = [
  ['/events', 'Events'],
  ['/regions', 'Regions'],
  ['/features', 'Features'],
  ['/podcasts', 'Podcasts'],
  ['/opportunities', 'Arts opportunities'],
  ['/organizations', 'Organizations'],
  ['/submit', 'Submit'],
  ['/orgs/login', 'Organization access'],
] as const;

function Layout({ children }: { children: ReactNode }): ReactNode {
  return (
    <>
      <a className="skip-link" href="#main-content">Skip to main content</a>
      <header className="site-header">
        <Link className="brand" to="/">Delaware Arts Calendar</Link>
        <nav aria-label="Primary navigation">
          {navigation.map(([href, label]) => (
            <NavLink key={href} to={href}>{label}</NavLink>
          ))}
        </nav>
      </header>
      <main id="main-content" tabIndex={-1}>{children}</main>
      <footer>
        <p>Independent clean-room demonstration. Event details should be confirmed with each original source.</p>
      </footer>
    </>
  );
}

function HomePage(): ReactNode {
  return (
    <div className="page hero-page">
      <p className="eyebrow">Arts and culture across Delaware</p>
      <h1>Find your next Delaware arts experience</h1>
      <p className="lede">Browse independently sourced demonstration listings by date, region, organization, and art form.</p>
      <div className="hero-actions">
        <Link className="button primary" to="/events">Explore upcoming events</Link>
        <Link className="button secondary" to="/regions">Browse by region</Link>
      </div>
      <section aria-labelledby="discover-heading">
        <h2 id="discover-heading">Discover more</h2>
        <div className="card-grid">
          <article className="feature-card"><h3>Curated themes</h3><p>Explore independently authored event groupings.</p><Link to="/features">View features</Link></article>
          <article className="feature-card"><h3>Arts opportunities</h3><p>See demonstration calls and resources for Delaware artists.</p><Link to="/opportunities">View opportunities</Link></article>
          <article className="feature-card"><h3>Community submissions</h3><p>Learn how organizations can propose public listings.</p><Link to="/submit">Submission information</Link></article>
        </div>
      </section>
    </div>
  );
}

function occurrenceLabel(event: PublicEventSummaryDto): string {
  const occurrence = event.occurrence;
  if (occurrence.kind === 'date') return occurrence.startDate;
  return `${occurrence.localDate} at ${occurrence.localTime} ${occurrence.sourceTimezone}`;
}

function EventCard({ event }: { event: PublicEventSummaryDto }): ReactNode {
  return (
    <article className="event-card">
      <p className="event-date">{occurrenceLabel(event)}</p>
      <h2><Link to={`/events/${event.id}`}>{event.title}</Link></h2>
      {event.organization ? <p><strong>{event.organization}</strong></p> : null}
      {event.venue || event.city ? <p>{[event.venue, event.city].filter(Boolean).join(' · ')}</p> : null}
      {event.categories.length > 0 ? <ul className="tags" aria-label="Categories">{event.categories.map((category) => <li key={category}>{category}</li>)}</ul> : null}
      <dl className="summary-details">
        {event.cost ? <><dt>Cost</dt><dd>{event.cost}</dd></> : null}
        {event.audience ? <><dt>Audience</dt><dd>{event.audience}</dd></> : null}
        {event.accessibility ? <><dt>Accessibility</dt><dd>{event.accessibility}</dd></> : null}
      </dl>
    </article>
  );
}

function EventsPage(): ReactNode {
  const [searchParams, setSearchParams] = useSearchParams();
  const [submittedInput, setSubmittedInput] = useState(searchParams.get('q') ?? '');
  const [page, setPage] = useState<Page<PublicEventSummaryDto> | null>(null);
  const [metadata, setMetadata] = useState<SearchMetadataDto | null>(null);
  const [error, setError] = useState<string | null>(null);
  const canonical = useMemo(() => {
    const params = new URLSearchParams(searchParams);
    if (!params.has('pageSize')) params.set('pageSize', '12');
    return params;
  }, [searchParams]);

  useEffect(() => {
    const controller = new AbortController();
    void api.metadata(controller.signal).then(setMetadata).catch(() => undefined);
    return () => controller.abort();
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    setError(null);
    void api.events(canonical, controller.signal)
      .then(setPage)
      .catch((reason: unknown) => {
        if ((reason as Error).name !== 'AbortError') setError(reason instanceof Error ? reason.message : 'Unable to load events.');
      });
    return () => controller.abort();
  }, [canonical]);

  const update = (name: string, value: string): void => {
    const next = new URLSearchParams(searchParams);
    if (value) next.set(name, value);
    else next.delete(name);
    next.delete('page');
    setSearchParams(next, { replace: true });
  };

  const submitSearch = (event: FormEvent): void => {
    event.preventDefault();
    const trimmed = submittedInput.trim();
    if (trimmed.length > 200) {
      setError('Search must contain no more than 200 characters. Previous results remain displayed.');
      return;
    }
    update('q', trimmed);
  };

  const clear = (): void => {
    setSubmittedInput('');
    setError(null);
    setSearchParams({}, { replace: true });
  };

  return (
    <div className="page">
      <h1>Upcoming events</h1>
      <div className="discovery-layout">
        <aside aria-label="Search and filters">
          <form onSubmit={submitSearch} noValidate>
            <Field id="event-search" label="Search events" error={error?.startsWith('Search must') ? error : undefined} inputProps={{ value: submittedInput, maxLength: 400, onChange: (event) => setSubmittedInput(event.target.value) }} />
            <button type="submit" className="button primary">Search</button>
          </form>
          <div className="field">
            <label htmlFor="category-filter">Category</label>
            <select id="category-filter" value={searchParams.get('category') ?? ''} onChange={(event) => update('category', event.target.value)}>
              <option value="">All categories</option>
              {metadata?.categories.map((category) => <option key={category}>{category}</option>)}
            </select>
          </div>
          <div className="field">
            <label htmlFor="region-filter">Region</label>
            <select id="region-filter" value={searchParams.get('region') ?? ''} onChange={(event) => update('region', event.target.value)}>
              <option value="">All regions</option>
              {metadata?.regions.map((region) => <option key={region}>{region}</option>)}
            </select>
          </div>
          <button type="button" className="button secondary" onClick={clear}>Clear search and filters</button>
        </aside>
        <section aria-labelledby="results-heading">
          <h2 id="results-heading" className="visually-hidden">Event results</h2>
          {error && !error.startsWith('Search must') ? <p className="error" role="alert">{error}</p> : null}
          <ResultsStatus count={page?.totalCount ?? 0} />
          {page && page.items.length === 0 ? (
            <div className="empty-state"><h2>No upcoming events match</h2><p>Try removing a filter or search term.</p><button className="button primary" type="button" onClick={clear}>Show all upcoming events</button></div>
          ) : null}
          <div className="event-list">{page?.items.map((event) => <EventCard key={`${event.id}-${event.occurrence.id}`} event={event} />)}</div>
          {page ? <Pagination page={page.page} totalPages={page.totalPages} onPage={(nextPage) => update('page', String(nextPage))} /> : null}
        </section>
      </div>
    </div>
  );
}

function EventDetailPage(): ReactNode {
  const { eventId = '' } = useParams();
  const [event, setEvent] = useState<PublicEventDetailDto | null>(null);
  const [status, setStatus] = useState<'loading' | 'ready' | 'not-found' | 'error'>('loading');
  useEffect(() => {
    const controller = new AbortController();
    void api.event(eventId, controller.signal)
      .then((value) => { setEvent(value); setStatus('ready'); })
      .catch((reason: unknown) => setStatus(reason instanceof ApiError && reason.status === 404 ? 'not-found' : 'error'));
    return () => controller.abort();
  }, [eventId]);
  if (status === 'loading') return <div className="page"><h1>Loading event</h1><p role="status">Loading…</p></div>;
  if (status === 'not-found') return <NotFoundPage />;
  if (status === 'error' || !event) return <div className="page"><h1>Event unavailable</h1><p role="alert">The event could not be loaded.</p></div>;
  return (
    <article className="page detail-page">
      <Link to="/events">← Back to events</Link>
      <h1>{event.title}</h1>
      {event.organization ? <p className="lede">Presented by {event.organization}</p> : null}
      {event.description ? <p>{event.description}</p> : null}
      <section aria-labelledby="dates-heading"><h2 id="dates-heading">Dates and times</h2><ul>{event.occurrences.map((occurrence) => <li key={occurrence.id}>{occurrence.kind === 'date' ? occurrence.startDate : `${occurrence.localDate} at ${occurrence.localTime} ${occurrence.sourceTimezone}`}</li>)}</ul></section>
      <section aria-labelledby="details-heading"><h2 id="details-heading">Event details</h2><dl className="detail-list">
        {event.venue ? <><dt>Venue</dt><dd>{event.venue}</dd></> : null}
        {event.city ? <><dt>City</dt><dd>{event.city}</dd></> : null}
        {event.region ? <><dt>Region</dt><dd>{event.region}</dd></> : null}
        {event.cost ? <><dt>Cost</dt><dd>{event.cost}</dd></> : null}
        {event.audience ? <><dt>Audience</dt><dd>{event.audience}</dd></> : null}
        {event.accessibility ? <><dt>Accessibility</dt><dd>{event.accessibility}</dd></> : null}
        {event.coordinates ? <><dt>Coordinates</dt><dd>{event.coordinates.latitude}, {event.coordinates.longitude}</dd></> : null}
      </dl></section>
      {event.address ? <section aria-labelledby="address-heading"><h2 id="address-heading">Address</h2><address>{Object.values(event.address).map((part) => <div key={part}>{part}</div>)}</address></section> : null}
      <section aria-labelledby="links-heading"><h2 id="links-heading">Event links</h2><ul>
        {event.source ? <li><ExternalLink href={event.source.url}>View original source</ExternalLink></li> : null}
        {event.ticket ? <li><ExternalLink href={event.ticket.url}>Get tickets</ExternalLink></li> : null}
        {event.registration ? <li><ExternalLink href={event.registration.url}>Register</ExternalLink></li> : null}
      </ul></section>
      {event.attribution ? <p className="attribution">Source note: {event.attribution}</p> : null}
      {event.rightsNotice ? <p className="attribution">{event.rightsNotice}</p> : null}
    </article>
  );
}

const regionCards = [
  ['Northern Delaware', 'Wilmington, Newark, New Castle, and nearby communities'],
  ['Central Delaware', 'Dover, Milford, and nearby communities'],
  ['Southern Delaware', 'Georgetown, Lewes, Rehoboth Beach, and nearby communities'],
] as const;

function RegionsPage(): ReactNode {
  return <div className="page"><h1>Explore by region</h1><p className="lede">Use regional groupings to narrow upcoming demonstration listings.</p><div className="card-grid">{regionCards.map(([region, description]) => <article className="feature-card" key={region}><h2>{region}</h2><p>{description}</p><Link to={`/events?region=${encodeURIComponent(region)}`}>View events in {region}</Link></article>)}</div></div>;
}

function FeaturesPage(): ReactNode {
  return <div className="page"><h1>Editorial features</h1><article className="feature-card"><p className="eyebrow">Independent feature</p><h2>Creative communities of the First State</h2><p>A demonstration collection highlighting visual art, music, theatre, dance, and literary programs.</p><Link to="/events">Browse the collection</Link></article></div>;
}

function PodcastsPage(): ReactNode {
  return <div className="page"><h1>Podcasts</h1><div className="empty-state"><h2>No published podcast episodes</h2><p>This clean-room demonstration does not reproduce unlicensed audio or protected episode art.</p></div></div>;
}

function OpportunitiesPage(): ReactNode {
  return <div className="page"><h1>Arts opportunities</h1><article className="event-card"><p className="event-date">Ongoing demonstration listing</p><h2>Community artist resource exchange</h2><p>An independently authored example showing how a current opportunity would appear.</p><dl className="summary-details"><dt>Sponsor</dt><dd>Demo Arts Network</dd><dt>Location</dt><dd>Statewide</dd></dl></article></div>;
}

function OrganizationsPage(): ReactNode {
  return <div className="page"><h1>Arts organizations</h1><p>Approved organization profiles will connect visitors with future published events.</p><div className="empty-state"><h2>No public profiles in this fixture</h2><p>Use the event index to browse current demonstration organizations.</p><Link className="button primary" to="/events">Browse events</Link></div></div>;
}

function SubmitPage(): ReactNode {
  return <div className="page narrow"><h1>Submit arts information</h1><p className="lede">This implementation provides the public information architecture without transmitting data to DelawareScene or another third party.</p><nav aria-label="Submission workflows"><ul><li><Link to="/submit/organization">Submit an organization profile</Link></li><li><Link to="/submit/event">Submit an event</Link></li><li><Link to="/events/example/corrections/new">Request an event correction</Link></li><li><Link to="/submit/opportunity">Submit an arts opportunity</Link></li></ul></nav><p><Link to="/orgs/login">Open local demonstration access</Link></p></div>;
}

function SubmissionPlaceholder({ title, description }: { title: string; description: string }): ReactNode {
  return <div className="page narrow"><h1>{title}</h1><p className="lede">{description}</p><p>This foundation route is ready for the validated submission form implemented in the submissions slice.</p><Link to="/submit">View all submission workflows</Link></div>;
}

function ModerationPage(): ReactNode {
  const navigate = useNavigate();
  const [accessCode, setAccessCode] = useState('');
  const [csrf, setCsrf] = useState<string | null>(() => sessionStorage.getItem('ds.csrf'));
  const [events, setEvents] = useState<Array<PublicEventSummaryDto & { publicationStatus: string; version: number }>>([]);
  const [sourceCount, setSourceCount] = useState<number | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const refresh = (): void => {
    void Promise.all([api.moderationEvents(), api.moderationSources()])
      .then(([eventResponse, sourceResponse]) => { setEvents(eventResponse.items); setSourceCount(sourceResponse.totalCount); setMessage(null); })
      .catch((reason: unknown) => { if (reason instanceof ApiError && reason.status === 401) setCsrf(null); else setMessage(reason instanceof Error ? reason.message : 'Unable to load moderation data.'); });
  };
  useEffect(() => { if (csrf) refresh(); }, [csrf]);

  const login = (event: FormEvent): void => {
    event.preventDefault();
    setMessage(null);
    void api.login('demo-editor', accessCode)
      .then((session) => { sessionStorage.setItem('ds.csrf', session.csrfToken); setCsrf(session.csrfToken); setAccessCode(''); })
      .catch((reason: unknown) => setMessage(reason instanceof Error ? reason.message : 'Login failed.'));
  };

  const transition = (eventId: string, action: 'approve' | 'reject' | 'archive', version: number): void => {
    if (!csrf) return;
    const reason = action === 'reject' ? 'Does not meet local demonstration publication criteria.' : undefined;
    void api.transition(eventId, action, version, csrf, reason).then(() => { setMessage(`Event ${action} action completed.`); refresh(); }).catch((error: unknown) => setMessage(error instanceof Error ? error.message : 'Action failed.'));
  };

  if (!csrf) {
    return <div className="page narrow"><h1>Organization and editor access</h1><p>This local-only demo requires the access code supplied through the server environment. No credential is stored in source control.</p><form onSubmit={login}><Field id="access-code" label="Local demo access code" inputProps={{ type: 'password', autoComplete: 'current-password', value: accessCode, onChange: (event) => setAccessCode(event.target.value), required: true }} />{message ? <p className="error" role="alert">{message}</p> : null}<button className="button primary" type="submit">Sign in</button></form></div>;
  }
  return <div className="page"><h1>Moderation dashboard</h1><div className="dashboard-summary"><p><strong>{events.length}</strong> events in review storage</p><p><strong>{sourceCount ?? '—'}</strong> authoritative sources</p></div>{message ? <p role="status">{message}</p> : null}<div className="moderation-list">{events.map((event) => <article className="event-card" key={event.id}><h2>{event.title}</h2><p>Status: <strong>{event.publicationStatus}</strong></p><p>Version {event.version}</p><div className="button-row">{event.publicationStatus === 'pending' ? <><button className="button primary" type="button" onClick={() => transition(event.id, 'approve', event.version)}>Approve</button><button className="button danger" type="button" onClick={() => transition(event.id, 'reject', event.version)}>Reject</button></> : null}{event.publicationStatus === 'published' ? <button className="button secondary" type="button" onClick={() => transition(event.id, 'archive', event.version)}>Archive</button> : null}</div></article>)}</div><button className="button secondary" type="button" onClick={() => { void api.logout(csrf).finally(() => { sessionStorage.removeItem('ds.csrf'); setCsrf(null); navigate('/'); }); }}>Sign out</button></div>;
}

function AboutPage(): ReactNode {
  return <div className="page narrow"><h1>About this demonstration</h1><p>This is an independently implemented clean-room arts calendar. It uses supplied organization catalogs for discovery metadata and locally authored fixture events for automated demonstration.</p><p>No automated test or demo seed contacts a live organization website.</p></div>;
}

function NotFoundPage(): ReactNode {
  return <div className="page"><h1>Page not found</h1><p>The requested public record is unavailable.</p><Link to="/events">Browse upcoming events</Link></div>;
}

export function App(): ReactNode {
  return <Layout><Routes>
    <Route path="/" element={<HomePage />} />
    <Route path="/events" element={<EventsPage />} />
    <Route path="/events/:eventId" element={<EventDetailPage />} />
    <Route path="/regions" element={<RegionsPage />} />
    <Route path="/features" element={<FeaturesPage />} />
    <Route path="/podcasts" element={<PodcastsPage />} />
    <Route path="/opportunities" element={<OpportunitiesPage />} />
    <Route path="/organizations" element={<OrganizationsPage />} />
    <Route path="/submit" element={<SubmitPage />} />
    <Route path="/submit/organization" element={<SubmissionPlaceholder title="Submit an organization profile" description="Propose public organization information for editor review." />} />
    <Route path="/submit/event" element={<SubmissionPlaceholder title="Submit an event" description="Approved organization contributors can propose an event for moderation." />} />
    <Route path="/events/:eventId/corrections/new" element={<SubmissionPlaceholder title="Request an event correction" description="Propose one or more corrections to a published event." />} />
    <Route path="/submit/opportunity" element={<SubmissionPlaceholder title="Submit an arts opportunity" description="Propose a call, grant, job, audition, or related opportunity." />} />
    <Route path="/orgs/login" element={<ModerationPage />} />
    <Route path="/moderation" element={<ModerationPage />} />
    <Route path="/about" element={<AboutPage />} />
    <Route path="/about/faq" element={<AboutPage />} />
    <Route path="*" element={<NotFoundPage />} />
  </Routes></Layout>;
}
