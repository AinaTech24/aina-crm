"use client";

import { useId, useState } from "react";
import Link from "next/link";

type Art = { id: string; slug: string; title: string };

const DocIcon = () => (
  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z" /><path d="M14 3v5h5M9 13h6M9 17h6" /></svg>
);

/** A folder's guide list: the first few, and the rest slide open in place under "View all". */
export function FolderGuides({ articles, preview = 3 }: { articles: Art[]; preview?: number }) {
  const [open, setOpen] = useState(false);
  const id = useId();
  const first = articles.slice(0, preview);
  const rest = articles.slice(preview);
  const row = (a: Art) => (
    <li key={a.id}>
      <DocIcon />
      <Link href={`/knowledge-base/${a.slug}`}>{a.title}</Link>
    </li>
  );
  return (
    <>
      <ul>{first.map(row)}</ul>
      {rest.length > 0 && (
        <>
          <div id={id} className={`kb-more${open ? " open" : ""}`} aria-hidden={!open}>
            <div className="kb-more-in">
              <ul>{rest.map(row)}</ul>
            </div>
          </div>
          <button type="button" className="all" aria-expanded={open} aria-controls={id} onClick={() => setOpen((v) => !v)}>
            {open ? "View less" : `View all ${articles.length}`}
          </button>
        </>
      )}
    </>
  );
}
