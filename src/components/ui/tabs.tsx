// Placeholder for Tabs component
import { cn } from "@/lib/utils";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const Tabs = ({ children, defaultValue, className }: any) => (
  <div className={cn("tabs", className)} data-default={defaultValue}>
    {children}
  </div>
);

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const TabsList = ({ children, className }: any) => (
  <div className={cn("tabs-list", className)}>{children}</div>
);

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const TabsTrigger = ({ children, value, className }: any) => (
  <button className={cn("tabs-trigger", className)} data-value={value}>
    {children}
  </button>
);

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const TabsContent = ({ children, value, className }: any) => (
  <div className={cn("tabs-content", className)} data-value={value}>
    {children}
  </div>
);
