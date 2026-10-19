import { redirect } from "next/navigation";

// Self-serve sign-up is closed — workspaces are created by Aina.
export default function SignupPage() {
  redirect("/login");
}
