import React from "react";
import { Screen } from "../../../src/components/ui/Screen";
import { EmptyState } from "../../../src/components/states";

export default function Search() {
  return (
    <Screen>
      <EmptyState
        icon="search"
        title="Universal search"
        message="Find clients, leads, folios, SIPs, service requests and documents from one place. Wiring up to /api/search next."
      />
    </Screen>
  );
}
