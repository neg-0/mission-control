// Placeholder for Accordion component
import { cn } from "@/lib/utils";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const Accordion = ({ children, type, collapsible, className }: any) => (
  <div className={cn("accordion", className)} data-type={type} data-collapsible={collapsible}>
    {children}
  </div>
);

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const AccordionItem = ({ children, value, className }: any) => (
  <div className={cn("accordion-item", className)} data-value={value}>
    {children}
  </div>
);

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const AccordionTrigger = ({ children, className }: any) => (
  <button className={cn("accordion-trigger", className)}>{children}</button>
);

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const AccordionContent = ({ children, className }: any) => (
  <div className={cn("accordion-content", className)}>{children}</div>
);
