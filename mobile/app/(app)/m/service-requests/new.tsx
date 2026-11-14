import React from "react";
import { FormScreen } from "../../../../src/components/form/FormScreen";
import { serviceRequestForm } from "../../../../src/features/forms/service-requests";

export default function NewServiceRequest() {
  return <FormScreen spec={serviceRequestForm} />;
}
