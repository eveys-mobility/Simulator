import { AlertTriangle } from 'lucide-react';
import { type ReactNode, useEffect, useState } from 'react';
import {
    AlertDialog,
    AlertDialogAction,
    AlertDialogCancel,
    AlertDialogContent,
    AlertDialogDescription,
    AlertDialogFooter,
    AlertDialogHeader,
    AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { cn } from '@/lib/cn';

interface ConfirmDialogProps {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    title: string;
    /** Body text or rich content. Plain string gets a default styling;
     *  pass a node when you want to mix in inline code, lists, etc. */
    description: ReactNode;
    /** Label on the action button. Defaults to "Confirm". */
    confirmText?: string;
    cancelText?: string;
    /** When true, the action button uses the destructive variant.
     *  Defaults to false (regular primary). */
    destructive?: boolean;
    /** When set, user must type this string into the field before
     *  the action button enables. Use "DELETE" or similar for the
     *  irreversible operations (server reset, fleet stop-all). */
    typedConfirmation?: string;
    onConfirm: () => void;
    /** Disables the action button while a parent mutation is in flight. */
    pending?: boolean;
}

/**
 * Replacement for `window.confirm`. Two flavors:
 *
 *   <ConfirmDialog … />                  single-tap confirm
 *   <ConfirmDialog typedConfirmation="DELETE" … />   user must type the word
 *
 * The typed-confirmation flow matches the Settings reset endpoint's
 * server-side guard (`POST /api/settings/reset { confirm: 'DELETE' }`)
 * so the safety story is the same on both sides.
 */
export function ConfirmDialog({
    open,
    onOpenChange,
    title,
    description,
    confirmText = 'Confirm',
    cancelText = 'Cancel',
    destructive = false,
    typedConfirmation,
    onConfirm,
    pending = false,
}: ConfirmDialogProps) {
    const [typed, setTyped] = useState('');

    // Reset the typed-confirmation field whenever the dialog reopens —
    // otherwise the previous run's text would persist if the parent
    // remounts the dialog on a new target.
    useEffect(() => {
        if (open) setTyped('');
    }, [open]);

    const requiresTyping = typeof typedConfirmation === 'string' && typedConfirmation.length > 0;
    const canConfirm = !requiresTyping || typed === typedConfirmation;

    return (
        <AlertDialog open={open} onOpenChange={onOpenChange}>
            <AlertDialogContent>
                <AlertDialogHeader>
                    <AlertDialogTitle className="flex items-center gap-2">
                        {destructive && <AlertTriangle className="h-5 w-5 text-destructive" />}
                        {title}
                    </AlertDialogTitle>
                    <AlertDialogDescription asChild>
                        <div>{description}</div>
                    </AlertDialogDescription>
                </AlertDialogHeader>

                {requiresTyping && (
                    <div className="space-y-1.5">
                        <Label htmlFor="confirm-input" className="text-xs text-muted-foreground">
                            Type{' '}
                            <span className="font-mono font-bold text-destructive">
                                {typedConfirmation}
                            </span>{' '}
                            to confirm
                        </Label>
                        <Input
                            id="confirm-input"
                            autoFocus
                            autoComplete="off"
                            value={typed}
                            onChange={(e) => setTyped(e.target.value)}
                            placeholder={typedConfirmation}
                        />
                    </div>
                )}

                <AlertDialogFooter>
                    <AlertDialogCancel disabled={pending}>{cancelText}</AlertDialogCancel>
                    <AlertDialogAction
                        disabled={!canConfirm || pending}
                        className={cn(
                            destructive &&
                                'bg-destructive text-destructive-foreground hover:bg-destructive/90',
                        )}
                        onClick={(e) => {
                            // Default close-on-click would race a pending
                            // mutation; let the parent flip `open` after
                            // the call settles instead.
                            e.preventDefault();
                            if (!canConfirm || pending) return;
                            onConfirm();
                        }}
                    >
                        {pending ? 'Working…' : confirmText}
                    </AlertDialogAction>
                </AlertDialogFooter>
            </AlertDialogContent>
        </AlertDialog>
    );
}
