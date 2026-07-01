import React from "react";
import { Screen } from "../../../src/components/ui/Screen";
import { EmptyState } from "../../../src/components/states";

export default function FirmProfile() {
  return (
    <Screen>
      <EmptyState
        icon="briefcase"
        title="Firm profile"
        message="Your firm's identity, ARN/SEBI registration, branding and business profile — backed by /api/tenant settings."
      />
    </Screen>
  );
}
