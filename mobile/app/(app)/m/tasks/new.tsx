/**
 * New task (NewTaskScreen — the live CRM's form with its request types and
 * scheme rows) or, with ?editId=, edit one (the fields the task page saves).
 */

import React from "react";
import { useLocalSearchParams } from "expo-router";
import { FormScreen } from "../../../../src/components/form/FormScreen";
import { taskForm } from "../../../../src/features/forms/tasks";
import { NewTaskScreen } from "../../../../src/features/tasks/NewTaskScreen";

export default function NewTask() {
  const params = useLocalSearchParams<Record<string, string>>();
  if (params.editId) return <FormScreen spec={taskForm} />;
  return <NewTaskScreen params={params} />;
}
