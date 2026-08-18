import type { InputHTMLAttributes, ReactNode } from 'react';

export function Field(props: {
  id: string;
  label: string;
  error?: string;
  hint?: string;
  inputProps?: InputHTMLAttributes<HTMLInputElement>;
}): ReactNode {
  const describedBy = [props.hint ? `${props.id}-hint` : null, props.error ? `${props.id}-error` : null]
    .filter(Boolean)
    .join(' ') || undefined;
  return (
    <div className="field">
      <label htmlFor={props.id}>{props.label}</label>
      {props.hint ? <span id={`${props.id}-hint`} className="hint">{props.hint}</span> : null}
      <input
        {...props.inputProps}
        id={props.id}
        aria-describedby={describedBy}
        aria-invalid={props.error ? true : undefined}
      />
      {props.error ? <span id={`${props.id}-error`} className="field-error">{props.error}</span> : null}
    </div>
  );
}

export function ResultsStatus({ count }: { count: number }): ReactNode {
  return <p className="results-status" role="status" aria-live="polite">{count} result{count === 1 ? '' : 's'}</p>;
}

export function ExternalLink(props: { href: string; children: ReactNode }): ReactNode {
  return <a href={props.href} target="_blank" rel="noreferrer">{props.children} <span className="external-label">(external website)</span></a>;
}

export function Pagination(props: {
  page: number;
  totalPages: number;
  onPage: (page: number) => void;
}): ReactNode {
  if (props.totalPages <= 1) return null;
  return (
    <nav className="pagination" aria-label="Event result pages">
      {props.page > 1 ? <button type="button" onClick={() => props.onPage(props.page - 1)}>Previous</button> : <span>Previous</span>}
      <span>Page {props.page} of {props.totalPages}</span>
      {props.page < props.totalPages ? <button type="button" onClick={() => props.onPage(props.page + 1)}>Next</button> : <span>Next</span>}
    </nav>
  );
}

export function FilterGroup(props: { legend: string; children: ReactNode }): ReactNode {
  return <fieldset className="filter-group"><legend>{props.legend}</legend>{props.children}</fieldset>;
}
