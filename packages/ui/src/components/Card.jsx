import { forwardRef } from "react";
import { cn } from "../lib/utils.js";

const Card = forwardRef(function Card(
  { className, variant = "default", ...props },
  ref,
) {
  return (
    <div
      ref={ref}
      className={cn(
        "rounded-2xl",
        variant === "default" && "glass",
        // "shell" = near-opaque glass for structural content containers that
        // sit directly on the app's plain page background (no colorful
        // backdrop behind them, unlike auth/setup screens) — plain "glass" is
        // nearly invisible there, especially in light mode (~68% opaque white
        // on an already-white page). Same pattern SetupWizard/LoginScreen use
        // for their main card, just applied to regular module content.
        variant === "shell" && "glass-shell",
        // "shell-flat" = same look as "shell" but with no backdrop-filter —
        // for repeated structural cards (RunlyDetail's hero + section
        // cards) where blur is cosmetic-only and kept causing rendering
        // artifacts. See styles.css's .glass-shell-flat.
        variant === "shell-flat" && "glass-shell-flat",
        variant === "solid" &&
          "bg-[hsl(var(--card))] border border-[hsl(var(--border))] shadow-sm",
        variant === "bordered" &&
          "border border-[hsl(var(--border))] bg-transparent",
        variant === "interactive" &&
          "bg-[hsl(var(--card))] border border-[hsl(var(--border))] shadow-sm cursor-pointer transition-all duration-200 hover:shadow-md hover:border-[hsl(var(--muted-foreground))]/30 active:scale-[0.99]",
        className,
      )}
      {...props}
    />
  );
});

const CardHeader = forwardRef(function CardHeader(
  { className, ...props },
  ref,
) {
  return (
    <div
      ref={ref}
      className={cn("flex flex-col gap-1.5 p-4 sm:p-6", className)}
      {...props}
    />
  );
});

const CardTitle = forwardRef(function CardTitle({ className, ...props }, ref) {
  return (
    <h3
      ref={ref}
      className={cn(
        "text-base font-semibold leading-tight tracking-tight min-w-0",
        className,
      )}
      {...props}
    />
  );
});

const CardDescription = forwardRef(function CardDescription(
  { className, ...props },
  ref,
) {
  return (
    <p
      ref={ref}
      className={cn("text-sm text-[hsl(var(--muted-foreground))]", className)}
      {...props}
    />
  );
});

const CardContent = forwardRef(function CardContent(
  { className, ...props },
  ref,
) {
  return (
    <div
      ref={ref}
      className={cn("p-4 pt-0 sm:p-6 sm:pt-0", className)}
      {...props}
    />
  );
});

const CardFooter = forwardRef(function CardFooter(
  { className, ...props },
  ref,
) {
  return (
    <div
      ref={ref}
      className={cn("flex items-center p-4 pt-0 sm:p-6 sm:pt-0", className)}
      {...props}
    />
  );
});

export {
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardContent,
  CardFooter,
};
