import { compileToPredicate } from "@/lib/filter/predicate";
import type { ActionHandler } from "./index";

/**
 * Evaluate each case's criteria against the subject (live snapshot). The first
 * matching case is taken; its outgoing edge handle is `case_<index>`. If no
 * case matches, the `default` handle is taken.
 */
export const branchHandler: ActionHandler<any> = {
  type: "branch",
  async execute(ctx, node) {
    const cases: Array<{ label: string; criteria: any }> = node.config.cases;
    const row = {
      ...(ctx.subject ?? {}),
      subject: ctx.subject,
      vars: ctx.vars,
      event: ctx.event,
      tenant: ctx.tenant,
    };
    const subject = ctx.subjectType ?? "investor";
    for (let i = 0; i < cases.length; i++) {
      const pred = compileToPredicate(cases[i].criteria, subject);
        if (pred(row)) {
          ctx.log(`branch matched case_${i} (${cases[i].label})`);
          return {
            kind: "continue",
            sourceHandle: `case_${i}`,
            output: { matched: i, label: cases[i].label },
          };
        }
    }
    return { kind: "continue", sourceHandle: "default", output: { matched: -1 } };
  },
};
