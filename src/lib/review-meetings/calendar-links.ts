/**
 * "Add to calendar" links for one meeting: Google and Outlook open the event
 * already filled in (one click on Save adds it — no file), and the .ics is
 * the fallback for Apple Calendar and anything else.
 *
 * Plain module (no "use client") so server and client code can both call it.
 */

export type CalendarLinkInput = {
  id?: string | null;
  start: Date | string;
  durationMinutes?: number | null;
  title: string;
  details?: string | null;
  location?: string | null;
};

export function meetingCalendarLinks(m: CalendarLinkInput) {
  const start = new Date(m.start);
  const valid = !isNaN(start.getTime());
  const end = new Date(start.getTime() + (Number(m.durationMinutes) || 30) * 60_000);
  const title = m.title.trim();
  const details = (m.details ?? "").trim();
  const loc = (m.location ?? "").trim();
  const gfmt = (d: Date) => d.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");

  const google = valid
    ? `https://calendar.google.com/calendar/render?action=TEMPLATE` +
      `&text=${encodeURIComponent(title)}` +
      `&dates=${gfmt(start)}/${gfmt(end)}` +
      `&details=${encodeURIComponent(details)}` +
      `&location=${encodeURIComponent(loc)}`
    : null;
  const outlook = valid
    ? `https://outlook.live.com/calendar/0/deeplink/compose?path=/calendar/action/compose&rru=addevent` +
      `&subject=${encodeURIComponent(title)}` +
      `&startdt=${encodeURIComponent(start.toISOString())}` +
      `&enddt=${encodeURIComponent(end.toISOString())}` +
      `&body=${encodeURIComponent(details)}` +
      `&location=${encodeURIComponent(loc)}`
    : null;
  const ics = m.id ? `/api/review-meetings/${m.id}/calendar.ics` : null;

  return { valid, google, outlook, ics };
}
