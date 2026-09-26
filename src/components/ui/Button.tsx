"use client";

/**
 * Button — the one place a button's look is decided.
 *
 * Before this, 289 files hand-wrote `className="btn-primary"` (818 uses) and
 * picked the variant by eye. The result is visible on Settings → Profile, where
 * `Enable 2FA`, `Upload photo`, `Upload signature` and `Save details` all render
 * as the same solid blue, so nothing on the screen reads as *the* action.
 *
 * The variants encode that hierarchy instead of leaving it to the author:
 *
 *   primary    one per screen — the thing the user came to do
 *   secondary  supporting actions that sit beside it
 *   ghost      low-stakes, text-first (cancel, "view all")
 *   danger     destructive; always pair with a confirm
 *   link       inline, looks like text
 *
 * The class builder itself lives in ./button-class, which has NO "use client".
 * It was written for the many call sites that are `<Link>`s rather than
 * `<button>`s — and most of those are server components, which cannot call a
 * function exported from a client module. Re-exported here so existing imports
 * are unaffected.
 */

import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from "react";
import { Loader2 } from "lucide-react";
import { buttonClass, type ButtonSize, type ButtonVariant } from "./button-class";

export { buttonClass };
export type { ButtonSize, ButtonVariant };

export type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: ButtonVariant;
  size?: ButtonSize;
  /** Shows a spinner and blocks input. Keeps the label so the width doesn't jump. */
  loading?: boolean;
  /** Rendered before the label. */
  icon?: ReactNode;
};

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = "secondary", size = "md", loading = false, icon, className, children, disabled, type = "button", ...rest },
  ref,
) {
  return (
    <button
      ref={ref}
      type={type}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      className={buttonClass(variant, size, className)}
      {...rest}
    >
      {loading ? <Loader2 className="size-4 animate-spin" aria-hidden /> : icon}
      {children}
    </button>
  );
});
