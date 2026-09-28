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
        // Structural containers are solid (styles.css .surface-card): glass
        // read as washed-out on the plain page background. "shell" and
        // "shell-flat" are kept as aliases for existing call sites. Use
        // "glass" only for cards that float over a colorful backdrop.
        (variant === "default" ||
          variant === "shell" ||
          variant === "shell-flat") &&
          "surface-card",
        variant === "glass" && "glass",
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
