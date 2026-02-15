// Placeholder for Dialog component
import { cn } from "@/lib/utils";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const Dialog = ({ children, open, onOpenChange: _onOpenChange }: any) => (
  <div className={cn("dialog", { open })} data-state={open ? "open" : "closed"}>
    {children}
  </div>
);

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const DialogTrigger = ({ children, asChild: _asChild }: any) => (
  <div className="dialog-trigger">{children}</div>
);

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const DialogContent = ({ children, className }: any) => (
  <div className={cn("dialog-content", className)}>{children}</div>
);

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const DialogHeader = ({ children, className }: any) => (
  <div className={cn("dialog-header", className)}>{children}</div>
);

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const DialogTitle = ({ children, className }: any) => (
  <h2 className={cn("dialog-title", className)}>{children}</h2>
);

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const DialogDescription = ({ children, className }: any) => (
  <p className={cn("dialog-description", className)}>{children}</p>
);

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const DialogFooter = ({ children, className }: any) => (
  <div className={cn("dialog-footer", className)}>{children}</div>
);
