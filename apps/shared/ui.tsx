/* shadcn/ui-style primitives (copied-in components, styled with the shared Apple-inspired tokens). */
import * as React from "react";
import * as DialogPrimitive from "@radix-ui/react-dialog";
import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";
import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";
import { Loader2, X } from "lucide-react";

export const cn = (...inputs: ClassValue[]) => twMerge(clsx(inputs));

// --- Button ------------------------------------------------------------------

const buttonVariants = cva(
  "inline-flex items-center justify-center gap-1.5 whitespace-nowrap rounded-full text-[13px] font-medium transition-all duration-150 active:scale-[0.98] disabled:pointer-events-none disabled:opacity-45 select-none",
  {
    variants: {
      variant: {
        primary: "bg-accent text-white shadow-sm hover:bg-accent-hover",
        secondary: "bg-fill text-ink hover:bg-fill-strong",
        outline: "border border-hairline bg-surface text-ink hover:bg-canvas",
        ghost: "text-ink hover:bg-fill",
        danger: "bg-danger text-white hover:brightness-95",
        "danger-ghost": "text-danger hover:bg-danger/10",
        link: "text-accent hover:underline rounded-md px-0",
      },
      size: { sm: "h-7 px-3", md: "h-9 px-4", lg: "h-11 px-6 text-[15px]", icon: "h-8 w-8" },
    },
    defaultVariants: { variant: "primary", size: "md" },
  },
);

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement>, VariantProps<typeof buttonVariants> {
  asChild?: boolean;
  loading?: boolean;
}
export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(({ className, variant, size, asChild, loading, children, ...props }, ref) => {
  if (asChild)
    return (
      <Slot ref={ref} className={cn(buttonVariants({ variant, size }), className)} {...props}>
        {children}
      </Slot>
    );
  return (
    <button ref={ref} className={cn(buttonVariants({ variant, size }), className)} {...props}>
      {loading && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
      {children}
    </button>
  );
});
Button.displayName = "Button";

// --- Card --------------------------------------------------------------------

export const Card = ({ className, ...p }: React.HTMLAttributes<HTMLDivElement>) => (
  <div className={cn("rounded-2xl bg-surface shadow-card ring-1 ring-black/[0.03]", className)} {...p} />
);
export const CardHeader = ({ className, ...p }: React.HTMLAttributes<HTMLDivElement>) => <div className={cn("flex items-start justify-between gap-4 px-5 pt-5", className)} {...p} />;
export const CardTitle = ({ className, ...p }: React.HTMLAttributes<HTMLHeadingElement>) => <h3 className={cn("text-[15px] font-semibold tracking-tight", className)} {...p} />;
export const CardDescription = ({ className, ...p }: React.HTMLAttributes<HTMLParagraphElement>) => <p className={cn("mt-0.5 text-[13px] text-muted", className)} {...p} />;
export const CardContent = ({ className, ...p }: React.HTMLAttributes<HTMLDivElement>) => <div className={cn("p-5", className)} {...p} />;

// --- Form fields -------------------------------------------------------------

const field =
  "w-full rounded-[10px] border border-hairline bg-surface px-3 text-[14px] text-ink placeholder:text-subtle shadow-[inset_0_1px_1px_rgba(0,0,0,0.02)] transition-[border,box-shadow] outline-none focus:border-accent focus:ring-4 focus:ring-accent/15 aria-[invalid=true]:border-danger aria-[invalid=true]:ring-danger/10 disabled:bg-canvas disabled:text-muted";

export const Input = React.forwardRef<HTMLInputElement, React.InputHTMLAttributes<HTMLInputElement>>(({ className, ...p }, ref) => (
  <input ref={ref} className={cn(field, "h-9", className)} {...p} />
));
Input.displayName = "Input";

export const Textarea = React.forwardRef<HTMLTextAreaElement, React.TextareaHTMLAttributes<HTMLTextAreaElement>>(({ className, ...p }, ref) => (
  <textarea ref={ref} className={cn(field, "min-h-[84px] py-2 leading-relaxed", className)} {...p} />
));
Textarea.displayName = "Textarea";

export const Select = React.forwardRef<HTMLSelectElement, React.SelectHTMLAttributes<HTMLSelectElement>>(({ className, children, ...p }, ref) => (
  <select
    ref={ref}
    className={cn(
      field,
      "h-9 appearance-none bg-[url('data:image/svg+xml;utf8,<svg xmlns=%22http://www.w3.org/2000/svg%22 width=%2212%22 height=%2212%22 viewBox=%220 0 24 24%22 fill=%22none%22 stroke=%22%236e6e73%22 stroke-width=%222.5%22><path d=%22m6 9 6 6 6-6%22/></svg>')] bg-[length:12px] bg-[right_10px_center] bg-no-repeat pr-8",
      className,
    )}
    {...p}
  >
    {children}
  </select>
));
Select.displayName = "Select";

export function Field({ label, htmlFor, error, hint, required, children, className }: { label: string; htmlFor: string; error?: string; hint?: string; required?: boolean; children: React.ReactNode; className?: string }) {
  return (
    <div className={cn("space-y-1.5", className)}>
      <label htmlFor={htmlFor} className="block text-[13px] font-medium text-ink">
        {label}
        {required && <span className="ml-0.5 text-muted">*</span>}
      </label>
      {children}
      {error ? (
        <p id={`${htmlFor}-error`} role="alert" className="text-[12px] text-danger animate-fade-in">
          {error}
        </p>
      ) : hint ? (
        <p className="text-[12px] text-muted">{hint}</p>
      ) : null}
    </div>
  );
}

// --- Badge -------------------------------------------------------------------

const badgeVariants = cva("inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11.5px] font-medium whitespace-nowrap", {
  variants: {
    tone: {
      neutral: "bg-fill text-muted",
      blue: "bg-accent/10 text-accent",
      green: "bg-success/12 text-[#248a3d]",
      orange: "bg-warning/12 text-[#c93400]",
      red: "bg-danger/10 text-[#d70015]",
      purple: "bg-[#af52de]/10 text-[#8944ab]",
    },
  },
  defaultVariants: { tone: "neutral" },
});
export const Badge = ({ className, tone, dot, children, ...p }: React.HTMLAttributes<HTMLSpanElement> & VariantProps<typeof badgeVariants> & { dot?: boolean }) => (
  <span className={cn(badgeVariants({ tone }), className)} {...p}>
    {dot && <span className="h-1.5 w-1.5 rounded-full bg-current" />}
    {children}
  </span>
);

// --- Segmented control -------------------------------------------------------

export function Segmented<T extends string>({ value, onChange, options, className, ariaLabel }: { value: T; onChange: (v: T) => void; options: { value: T; label: React.ReactNode }[]; className?: string; ariaLabel?: string }) {
  return (
    <div role="tablist" aria-label={ariaLabel} className={cn("inline-flex rounded-[10px] bg-fill p-0.5", className)}>
      {options.map((o) => (
        <button
          key={o.value}
          role="tab"
          type="button"
          aria-selected={value === o.value}
          onClick={() => onChange(o.value)}
          className={cn(
            "h-7 rounded-[8px] px-3 text-[12.5px] font-medium transition-all",
            value === o.value ? "bg-surface text-ink shadow-[0_1px_3px_rgba(0,0,0,0.12)]" : "text-muted hover:text-ink",
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

// --- Table -------------------------------------------------------------------

export const Table = ({ className, ...p }: React.TableHTMLAttributes<HTMLTableElement>) => (
  <div className="w-full overflow-x-auto">
    <table className={cn("w-full border-collapse text-[13.5px]", className)} {...p} />
  </div>
);
export const Th = ({ className, ...p }: React.ThHTMLAttributes<HTMLTableCellElement>) => (
  <th className={cn("h-9 px-4 text-left text-[11.5px] font-medium uppercase tracking-wide text-subtle", className)} {...p} />
);
export const Td = ({ className, ...p }: React.TdHTMLAttributes<HTMLTableCellElement>) => <td className={cn("px-4 py-3 align-middle", className)} {...p} />;
export const Tr = ({ className, ...p }: React.HTMLAttributes<HTMLTableRowElement>) => (
  <tr className={cn("border-t border-hairline transition-colors hover:bg-canvas/70", className)} {...p} />
);

// --- Dialog ------------------------------------------------------------------

export const Dialog = DialogPrimitive.Root;
export const DialogTrigger = DialogPrimitive.Trigger;
export const DialogClose = DialogPrimitive.Close;

export function DialogContent({ title, description, children, className, wide }: { title: string; description?: string; children: React.ReactNode; className?: string; wide?: boolean }) {
  return (
    <DialogPrimitive.Portal>
      <DialogPrimitive.Overlay className="fixed inset-0 z-40 bg-black/25 backdrop-blur-[2px] animate-fade-in" />
      <DialogPrimitive.Content
        className={cn(
          "fixed left-1/2 top-1/2 z-50 max-h-[90vh] w-[calc(100vw-2rem)] -translate-x-1/2 -translate-y-1/2 overflow-y-auto rounded-2xl bg-surface p-6 shadow-pop animate-scale-in",
          wide ? "max-w-2xl" : "max-w-md",
          className,
        )}
      >
        <div className="mb-4 flex items-start justify-between gap-4">
          <div>
            <DialogPrimitive.Title className="text-[17px] font-semibold tracking-tight">{title}</DialogPrimitive.Title>
            {description ? (
              <DialogPrimitive.Description className="mt-1 text-[13px] text-muted">{description}</DialogPrimitive.Description>
            ) : (
              <DialogPrimitive.Description className="sr-only">{title}</DialogPrimitive.Description>
            )}
          </div>
          <DialogPrimitive.Close className="rounded-full p-1 text-muted hover:bg-fill" aria-label="Close">
            <X className="h-4 w-4" />
          </DialogPrimitive.Close>
        </div>
        {children}
      </DialogPrimitive.Content>
    </DialogPrimitive.Portal>
  );
}

// --- Misc --------------------------------------------------------------------

export const Spinner = ({ className }: { className?: string }) => <Loader2 className={cn("h-4 w-4 animate-spin text-muted", className)} />;

export const Skeleton = ({ className }: { className?: string }) => <div className={cn("skeleton h-4", className)} />;

export function EmptyState({ icon, title, description, action }: { icon?: React.ReactNode; title: string; description?: string; action?: React.ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center px-6 py-14 text-center animate-fade-in">
      {icon && <div className="mb-3 rounded-2xl bg-fill p-3 text-muted">{icon}</div>}
      <p className="text-[15px] font-medium">{title}</p>
      {description && <p className="mt-1 max-w-sm text-[13px] text-muted">{description}</p>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}

export function PageHeader({ title, subtitle, actions }: { title: string; subtitle?: React.ReactNode; actions?: React.ReactNode }) {
  return (
    <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
      <div>
        <h1 className="text-[28px] font-semibold tracking-[-0.022em]">{title}</h1>
        {subtitle && <p className="mt-1 text-[14px] text-muted">{subtitle}</p>}
      </div>
      {actions && <div className="flex items-center gap-2">{actions}</div>}
    </div>
  );
}
