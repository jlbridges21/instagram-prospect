"use client";

import { useState } from "react";
import { Check, Copy } from "lucide-react";
import { toast } from "sonner";
import { buttonClasses } from "@/components/ui/button";
import { cn } from "@/lib/utils/cn";

export function CopyButton({
  value,
  label = "Copy",
  variant = "secondary",
}: {
  value: string;
  label?: string;
  variant?: "secondary" | "ghost";
}) {
  const [copied, setCopied] = useState(false);

  async function onCopy() {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      toast.success("Copied");
      window.setTimeout(() => setCopied(false), 1600);
    } catch {
      toast.error("Could not copy. Select the text and copy it manually.");
    }
  }

  return (
    <button type="button" onClick={onCopy} className={cn(buttonClasses(variant, "sm"))}>
      {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
      {copied ? "Copied" : label}
    </button>
  );
}
