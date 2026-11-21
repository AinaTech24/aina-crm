/**
 * Invite team member form — parity with the web /dashboard/employees/new page.
 * POSTs to /api/employees/invite with { name, email, roles[] }.
 *
 * Roles is a MULTI-select (checkbox grid on web, chip multi-select on mobile),
 * default ["rm"]. The web also does not navigate on success (it shows a
 * generated invite link) — so redirect returns null (go back / stay).
 */

import { Alert, Share } from "react-native";
import type { FormSpec } from "./types";
import { toast } from "../../lib/toast";

const u = (v: string) => (v?.trim() ? v.trim() : undefined);

export const employeeForm: FormSpec = {
  title: "Invite team member",
  endpoint: "/api/employees/invite",
  submitLabel: "Generate invite link",
  invalidate: ["employees"],

  initial: () => ({
    name: "",
    email: "",
    roles: ["rm"],
  }),

  validate: (v) => {
    const e: Record<string, string> = {};
    if (!v.email?.trim()) e.email = "Work email is required";
    else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v.email.trim())) e.email = "Enter a valid email address";
    if (!Array.isArray(v.roles) || v.roles.length === 0) e.roles = "Pick at least one role";
    return Object.keys(e).length ? e : null;
  },

  sections: [
    {
      fields: [
        { key: "name", label: "Name" },
        { key: "email", label: "Work email", type: "email", required: true },
        {
          key: "roles",
          label: "Roles",
          type: "multiselect",
          required: true,
          help: "Tap to select one or more.",
          options: [
            { value: "rm", label: "Relationship Manager" },
            { value: "back_office", label: "Back Office" },
            { value: "marketing", label: "Marketing" },
            { value: "compliance", label: "Compliance / DDQ" },
            { value: "branch_head", label: "Branch Head" },
            { value: "team_member", label: "Limited Team Member" },
          ],
        },
      ],
    },
  ],

  // A blank name must be LEFT OUT: the route takes name as min(1).optional(),
  // so "" was a 400 "invalid body" for everyone who skipped the field.
  buildBody: (form) => ({
    name: u(form.name),
    email: String(form.email ?? "").trim(),
    roles: Array.isArray(form.roles) ? form.roles : [],
  }),

  // The route returns { inviteUrl, emailSent }. When the email could not be
  // sent the link is the only way in — the web shows it, so the app must too.
  afterCreate: (json, _v, { router }) => {
    const url = typeof json?.inviteUrl === "string" ? json.inviteUrl : null;
    if (json?.emailSent === false && url) {
      Alert.alert("Invite created", `The invite email could not be sent. Share this link with them (valid for 7 days):\n\n${url}`, [
        { text: "Share link", onPress: () => { Share.share({ message: url }).catch(() => {}); router.back(); } },
        { text: "Done", style: "cancel", onPress: () => router.back() },
      ]);
      return;
    }
    toast.success("Invite sent");
    router.back();
  },
};
