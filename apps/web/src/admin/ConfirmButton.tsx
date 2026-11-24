import type { ReactNode } from 'react';
import { Button, Dialog, DialogTrigger, Heading, Modal, ModalOverlay } from 'react-aria-components';

import { BUTTON_CLASS, DANGER_BUTTON_CLASS } from './format.js';

interface ConfirmButtonProps {
  /** The button that opens the dialog. */
  label: string;
  /** The dialog's heading, e.g. "Cancel this event?". */
  title: string;
  /** What happens, and whether it can be undone. */
  children: ReactNode;
  confirmLabel: string;
  dismissLabel: string;
  onConfirm: () => void;
  isDisabled?: boolean;
}

/**
 * A button for an action that can't be undone: it opens an alert dialog that asks first. Focus
 * moves into the dialog and back to the button when it closes; Escape dismisses it.
 */
export function ConfirmButton({
  label,
  title,
  children,
  confirmLabel,
  dismissLabel,
  onConfirm,
  isDisabled = false,
}: ConfirmButtonProps) {
  return (
    <DialogTrigger>
      <Button isDisabled={isDisabled} className={`${DANGER_BUTTON_CLASS} disabled:opacity-60`}>
        {label}
      </Button>
      <ModalOverlay
        isDismissable
        className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 dark:bg-black/60 p-4"
      >
        <Modal className="w-full max-w-md rounded-lg bg-white p-6 shadow-xl">
          <Dialog role="alertdialog" className="outline-none">
            {({ close }) => (
              <>
                <Heading slot="title" className="text-xl font-semibold text-slate-900">
                  {title}
                </Heading>
                <div className="mt-3 text-slate-700">{children}</div>
                <div className="mt-6 flex flex-wrap justify-end gap-3">
                  <Button autoFocus onPress={close} className={BUTTON_CLASS}>
                    {dismissLabel}
                  </Button>
                  <Button
                    onPress={() => {
                      close();
                      onConfirm();
                    }}
                    className="rounded-md bg-red-700 px-4 py-2 font-semibold text-white hover:bg-red-800"
                  >
                    {confirmLabel}
                  </Button>
                </div>
              </>
            )}
          </Dialog>
        </Modal>
      </ModalOverlay>
    </DialogTrigger>
  );
}
