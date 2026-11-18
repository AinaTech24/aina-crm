import { redirect } from "next/navigation";

// Workspaces start from "Get pricing": a quote, then the firm's account and
// the payment (the owner's decision of 2026-11-18). /signup leads there.
export default function SignupPage() {
  redirect("/pricing");
}
