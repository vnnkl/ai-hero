import type { Action } from "./get-next-action";

export type OurMessageAnnotation = {
  type: "NEW_ACTION";
  action: Action;
};
