import * as React from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Drawer,
  DrawerContent,
  DrawerDescription,
  DrawerHeader,
  DrawerTitle,
} from "@/components/ui/drawer";
import { useMediaQuery, SHEET_QUERY } from "@/hooks/use-media-query";
import { cn } from "@/lib/utils";

interface ResponsiveDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: React.ReactNode;
  description?: React.ReactNode;
  children: React.ReactNode;
  /** PC のモーダル面に足すクラス（幅の変更など） */
  desktopClassName?: string;
  testId?: string;
}

/**
 * 入力・共有系ダイアログの共通シェル。
 * モバイルでは親指で扱いやすいボトムシート（vaul）、
 * md 以上では従来のセンターモーダルとして開く。
 */
export function ResponsiveDialog({
  open,
  onOpenChange,
  title,
  description,
  children,
  desktopClassName,
  testId,
}: ResponsiveDialogProps) {
  const isDesktop = useMediaQuery(SHEET_QUERY);

  if (isDesktop) {
    return (
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent
          className={cn("max-h-[90vh] w-[calc(100%-2rem)] max-w-sm overflow-y-auto", desktopClassName)}
          data-testid={testId}
        >
          <DialogHeader>
            <DialogTitle className="text-base">{title}</DialogTitle>
            {description && <DialogDescription className="text-sm">{description}</DialogDescription>}
          </DialogHeader>
          {children}
        </DialogContent>
      </Dialog>
    );
  }

  return (
    <Drawer open={open} onOpenChange={onOpenChange}>
      <DrawerContent
        className="max-h-[94dvh] rounded-t-[32px] border-card-border bg-card"
        data-testid={testId}
      >
        <div className="mx-auto flex w-full max-w-lg min-h-0 flex-col">
          <DrawerHeader className="px-5 pb-2 pt-2 text-left">
            <DrawerTitle className="text-base font-bold">{title}</DrawerTitle>
            {description && <DrawerDescription className="text-sm">{description}</DrawerDescription>}
          </DrawerHeader>
          <div className="min-h-0 overflow-y-auto px-5 pb-[calc(1.25rem+env(safe-area-inset-bottom))]">
            {children}
          </div>
        </div>
      </DrawerContent>
    </Drawer>
  );
}
