/**
 * Generic module create form. Reads the :module param, looks up its FormSpec in
 * the forms registry, and renders a FormScreen — the same create form as the web
 * CRM. Modules without a spec yet show a titled placeholder.
 */

import React from "react";
import { useLocalSearchParams } from "expo-router";
import { FormScreen } from "../../../../src/components/form/FormScreen";
import { WebOnlyState } from "../../../../src/components/WebOnlyState";
import { getForm } from "../../../../src/features/forms";
import { MENU } from "../../../../src/navigation/menu";

export default function GenericModuleNew() {
  const { module } = useLocalSearchParams<{ module: string }>();

  const spec = getForm(module);

  if (!spec) {
    const item = MENU.flatMap((g) => g.items).find((it) => it.key === module);
    return <WebOnlyState title={item?.label ? `New ${item.label}` : "New"} webPath={`/dashboard/${module ?? ""}/new`} icon="edit-3" />;
  }

  return <FormScreen spec={spec} />;
}
