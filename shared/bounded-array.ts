import { z } from "zod";

// Zod 3's array.max() records an issue but still parses every element. Reject
// oversized collections before visiting elements or allocating their errors.
export function boundedArray<T extends z.ZodTypeAny>(
  element: T,
  maximum: number,
  minimum = 0,
) {
  return z.preprocess((value, ctx) => {
    if (Array.isArray(value) && value.length > maximum) {
      ctx.addIssue({
        code: z.ZodIssueCode.too_big,
        type: "array",
        maximum,
        inclusive: true,
        exact: false,
        fatal: true,
      });
      return z.NEVER;
    }
    return value;
  }, z.array(element).min(minimum).max(maximum));
}
