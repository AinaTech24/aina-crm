/**
 * Whose book a section is describing — the words and the links that go with it.
 *
 * The personal cockpit and the branch command centre render several of the
 * SAME section components over the same loaders. Only two things differ: the
 * copy ("My client book" / "Branch client book") and where a count opens
 * (`/dashboard/investors?mine=1` / `?branch=<id>`). Both live here, so a
 * section never has to know which dashboard it is on.
 *
 * Plain module, no "use client": sections are server components and receive a
 * voice with functions in it. MyTrendChart is the one client component shared
 * between the two, and it takes a plain `title` string instead.
 */

import { clientsHref, leadsHref, type MyWindow } from "@/lib/dashboard/my/window";

export type Voice = {
  book: "mine" | "branch";
  /** "My client book" · "Branch client book" · "Client book" (one RM inside a branch). */
  title: (noun: string) => string;
  /** Pick the sentence for this book. */
  say: (mine: string, branch: string) => string;
  /** The client list on exactly this book, plus any extra filter. */
  clients: (extra?: string) => string;
  /** The lead list on exactly this book. */
  leads: (extra?: string) => string;
  /** Show the owning RM beside each row — a branch table spans several RMs. */
  showRm: boolean;
};

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/** The personal cockpit's voice — also the default when a section is given none. */
export const MY_VOICE: Voice = {
  book: "mine",
  title: (noun) => `My ${noun}`,
  say: (mine) => mine,
  clients: (extra) => `/dashboard/investors?mine=1${extra ? `&${extra}` : ""}`,
  leads: (extra) => `/dashboard/leads?mine=1${extra ? `&${extra}` : ""}`,
  showRm: false,
};

export function voiceFor(w: MyWindow): Voice {
  if (w.scope.kind === "rm") return MY_VOICE;
  const scope = w.scope;
  const oneRm = !!scope.rmId;
  return {
    book: "branch",
    // Narrowed to one RM the page header already names them, so the section
    // says "Client book" rather than claiming the branch's whole book.
    title: (noun) => (oneRm ? cap(noun) : `Branch ${noun}`),
    say: (_mine, branch) => branch,
    clients: (extra) => clientsHref(scope, extra),
    leads: (extra) => leadsHref(scope, extra),
    showRm: !oneRm,
  };
}
