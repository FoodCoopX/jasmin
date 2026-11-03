import {
  createContext,
  useContext,
  useState,
  useEffect,
  useCallback,
  useMemo,
} from "react";
import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { useAuth } from "./AuthContext";
import { useCapability } from "@hooks/configuration/useCapability";
import { notify } from "@shared/utils";

const EDIT_MODES = {
  INLINE: "inline",
  MODAL: "modal",
} as const;

type EditMode = (typeof EDIT_MODES)[keyof typeof EDIT_MODES];

interface ModalContextValue {
  editMode: EditMode;
  saveEditMode: (newMode: EditMode) => void;
  toggleEditMode: () => void;
  isModalMode: boolean;
  isInlineMode: boolean;
}

const ModalContext = createContext<ModalContextValue | undefined>(undefined);

function asEditMode(value: unknown): EditMode | null {
  return value === EDIT_MODES.INLINE || value === EDIT_MODES.MODAL
    ? value
    : null;
}

function readBrowserEditMode(): EditMode | null {
  try {
    return asEditMode(localStorage.getItem("editMode"));
  } catch {
    return null;
  }
}

/**
 * The edit mode is a device-local preference: it is kept on the signed-in
 * user in the stored ``auth`` entry and never sent to the server. Without
 * jasmin's own logins the host application writes that entry afresh on every
 * visit, which would drop the mode with it, so it then has a key of its own in
 * this browser.
 */
export function ModalProvider({ children }: { children: ReactNode }) {
  const { t } = useTranslation();
  const { user, updateUser } = useAuth();
  const keptOnUser = useCapability("user_accounts");
  const [editMode, setEditMode] = useState<EditMode>(
    asEditMode(user?.edit_mode) ?? EDIT_MODES.INLINE,
  );

  useEffect(() => {
    const storedMode = keptOnUser
      ? asEditMode(user?.edit_mode)
      : readBrowserEditMode();
    if (storedMode) {
      setEditMode(storedMode);
    }
  }, [user, keptOnUser]);

  const saveEditMode = useCallback(
    (newMode: EditMode) => {
      if (newMode === editMode) {
        return;
      }
      setEditMode(newMode);
      try {
        if (keptOnUser) {
          updateUser({ edit_mode: newMode });
        } else {
          localStorage.setItem("editMode", newMode);
        }
      } catch {
        // The browser refused the stored entry (quota, blocked storage):
        // the mode still applies for this session.
        notify.error(t("profile.preferences_save_error"));
      }
    },
    [editMode, keptOnUser, updateUser, t],
  );

  const toggleEditMode = useCallback(() => {
    saveEditMode(
      editMode === EDIT_MODES.INLINE ? EDIT_MODES.MODAL : EDIT_MODES.INLINE,
    );
  }, [editMode, saveEditMode]);

  // Memoized so consumers of useModal() (e.g. every mounted EditableTable)
  // don't re-render on every ModalProvider render — only when a value here
  // actually changes.
  const value: ModalContextValue = useMemo(
    () => ({
      editMode,
      saveEditMode,
      toggleEditMode,
      isModalMode: editMode === EDIT_MODES.MODAL,
      isInlineMode: editMode === EDIT_MODES.INLINE,
    }),
    [editMode, saveEditMode, toggleEditMode],
  );

  return (
    <ModalContext.Provider value={value}>{children}</ModalContext.Provider>
  );
}

/* eslint-disable-next-line react-refresh/only-export-components --
   the hook is the only way into the private context above */
export function useModal() {
  const context = useContext(ModalContext);
  if (!context) {
    throw new Error("useModal must be used within a ModalProvider");
  }
  return context;
}
