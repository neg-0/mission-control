// Placeholder for Input component
import { cn } from "@/lib/utils";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const Input = ({ className, ...props }: any) => (
  <input className={cn("input", className)} {...props} />
);
