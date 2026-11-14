import React from "react";
import { FormScreen } from "../../../../src/components/form/FormScreen";
import { fixedDepositForm } from "../../../../src/features/forms/fixed-deposits";

export default function NewFixedDeposit() {
  return <FormScreen spec={fixedDepositForm} />;
}
