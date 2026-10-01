/**
 * The look of one row in a record's "More" menu, in a server-safe module.
 *
 * A record menu holds a dozen actions that each ship their own drawer or
 * dialog — AI brief, portal link, change history, delete. Each used to bring
 * its own trigger too (a bordered button here, a pill there, a bare red icon),
 * so the menu read as a pile of controls rather than a list. Every trigger now
 * takes this class when it sits in a menu, which is what makes the rows line up.
 *
 * A plain constant rather than a component: the rows are <button>, <a> and
 * <Link> elements owned by other components, and a server component may read a
 * string from this module but could not call a function exported from a
 * "use client" one.
 */
export const MENU_ITEM =
  "flex w-full cursor-pointer select-none items-center gap-2 rounded-lg px-2.5 py-2 text-left text-sm font-medium text-foreground/80 transition-colors hover:bg-secondary hover:text-foreground focus-visible:outline-none focus-visible:bg-secondary disabled:pointer-events-none disabled:opacity-50";

/** A destructive row — always the last one, behind a separator. */
export const MENU_ITEM_DANGER =
  "flex w-full cursor-pointer select-none items-center gap-2 rounded-lg px-2.5 py-2 text-left text-sm font-medium text-destructive transition-colors hover:bg-destructive/10 focus-visible:outline-none focus-visible:bg-destructive/10 disabled:pointer-events-none disabled:opacity-50";

/** The icon at the start of a row. */
export const MENU_ICON = "size-4 shrink-0 text-muted-foreground";
