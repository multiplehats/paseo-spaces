import type { PluginPopoverProps, PluginSidebarItemProps } from "@getpaseo/plugin/client";
import { Icon, SidebarRow, TextInput } from "@getpaseo/plugin/client/ui";
import { type Ref, useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import {
  Modal,
  Pressable,
  type PressableStateCallbackType,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { removalTarget, type Space } from "../shared/layout";
import type { SwitcherControl } from "./keys";
import type { Store } from "./store";

type Colors = PluginPopoverProps["theme"]["colors"];
type Focusable = { focus?(): void } | null;
type Mode = { kind: "list" } | { kind: "rename"; space: Space } | { kind: "remove"; space: Space };

/**
 * Paseo binds Escape to interrupting the running agent, and its shortcut dispatcher (on window,
 * capture phase, so before any plugin listener) only stands aside while an HTML popover is
 * open: that is how its own menus keep Escape. While our menu is open we hold an empty,
 * invisible popover open too, so Escape closes the menu and never stops an agent.
 */
function holdEscape(): () => void {
  if (typeof document === "undefined") return () => {};
  const marker = document.createElement("div");
  if (typeof marker.showPopover !== "function") return () => {};
  marker.setAttribute("popover", "manual");
  marker.setAttribute("aria-hidden", "true");
  marker.style.cssText =
    "position:fixed;inset:auto;width:0;height:0;margin:0;padding:0;border:0;opacity:0;pointer-events:none";
  document.body.appendChild(marker);
  try {
    marker.showPopover();
  } catch {
    /* Already open or not allowed: the menu still works, Escape just stays Paseo's. */
  }
  return () => {
    try {
      marker.hidePopover();
    } catch {
      /* Closed already. */
    }
    marker.remove();
  };
}

export interface SwitcherOptions {
  /** The client has a keyboard: rows show the digit that picks them. */
  keyboard: boolean;
  /** ⌘J is bound, so the popover shows it. */
  shortcut: boolean;
}

export function createSwitcher(store: Store, { keyboard, shortcut }: SwitcherOptions) {
  // The mounted header item can open the popover; the open popover can close itself.
  let open: (() => void) | null = null;
  let close: (() => void) | null = null;
  let returnFocus: Focusable = null;

  const useSnapshot = () =>
    useSyncExternalStore(store.subscribe, store.getSnapshot, store.getSnapshot);

  const control: SwitcherControl = {
    toggle(from) {
      if (close) return close();
      returnFocus = from as Focusable;
      open?.();
    },
  };

  // On wide layouts the menu drops down under the row, at the row's width, drawn by the plugin:
  // Paseo's own popover opens beside the row. Compact layouts keep Paseo's bottom sheet.
  function Item({
    openPopover,
    openScreen,
    currentScreen,
    theme,
    layout: device,
  }: PluginSidebarItemProps) {
    const { status, layout, current } = useSnapshot();
    const anchor = useRef<View>(null);
    const [place, setPlace] = useState<{ top: number; left: number; width: number } | null>(null);
    const show = useCallback(() => {
      if (device.compact) return openPopover(Sheet);
      anchor.current?.measureInWindow((x, y, width, height) =>
        setPlace({ top: y + height + 2, left: x + 8, width: Math.max(width - 16, 220) }),
      );
    }, [device.compact, openPopover]);
    const hide = useCallback(() => setPlace(null), []);
    const shown = place !== null;
    useEffect(() => (shown ? holdEscape() : undefined), [shown]);
    useEffect(() => {
      open = show;
      return () => {
        if (open === show) open = null;
      };
    }, [show]);
    const press = () => {
      returnFocus = null;
      show();
    };
    const name = layout.spaces.find((space) => space.id === current)?.name;
    const colors = theme.colors;
    return (
      <View ref={anchor} collapsable={false}>
        <SidebarRow
          icon="Layers"
          label={status === "ready" && name ? name : "Spaces"}
          active={currentScreen?.screenId === "manage"}
          onPress={press}
          trailing={
            <Pressable accessibilityLabel="Switch space" onPress={press} style={{ padding: 4 }}>
              <Icon name="ChevronsUpDown" size={14} color={colors.foregroundMuted} />
            </Pressable>
          }
        />
        <Modal visible={place !== null} transparent animationType="none" onRequestClose={hide}>
          <Pressable accessible={false} style={StyleSheet.absoluteFill} onPress={hide} />
          {place ? (
            <View
              style={{
                position: "absolute",
                ...place,
                backgroundColor: colors.surface0,
                borderColor: colors.border,
                borderWidth: 1,
                borderRadius: 10,
                padding: 4,
                shadowColor: "#000",
                shadowOpacity: 0.35,
                shadowRadius: 16,
                shadowOffset: { width: 0, height: 8 },
              }}
            >
              <Menu colors={colors} close={hide} openScreen={openScreen} />
            </View>
          ) : null}
        </Modal>
      </View>
    );
  }

  function Sheet({ close, openScreen, theme }: PluginPopoverProps) {
    return <Menu colors={theme.colors} close={close} openScreen={openScreen} />;
  }

  function Menu({
    close: dismiss,
    openScreen,
    colors,
  }: {
    close(): void;
    openScreen: PluginPopoverProps["openScreen"];
    colors: Colors;
  }) {
    const { status, layout, current, saving, error } = useSnapshot();
    const [mode, setMode] = useState<Mode>({ kind: "list" });
    const toList = () => setMode({ kind: "list" });

    const finish = () => {
      const back = returnFocus;
      returnFocus = null;
      dismiss();
      back?.focus?.();
    };
    useEffect(() => {
      close = finish;
      return () => {
        if (close === finish) close = null;
      };
    });

    // Escape closes the menu in every mode (a rename draft is discarded). See holdEscape for why
    // Paseo leaves it to us instead of interrupting the running agent.
    useEffect(() => {
      if (typeof document === "undefined") return;
      const onKeyDown = (event: KeyboardEvent) => {
        if (event.key !== "Escape" || event.isComposing) return;
        event.preventDefault();
        event.stopPropagation();
        finish();
      };
      document.addEventListener("keydown", onKeyDown, true);
      return () => document.removeEventListener("keydown", onKeyDown, true);
    });

    // While the list shows, 1–9 pick that Space.
    useEffect(() => {
      if (!keyboard || mode.kind !== "list" || typeof document === "undefined") return;
      const onKeyDown = (event: KeyboardEvent) => {
        if (event.metaKey || event.ctrlKey || event.altKey || event.shiftKey) return;
        const digit = /^Digit([1-9])$/.exec(event.code);
        const space = digit && layout.spaces[Number(digit[1]) - 1];
        if (!space) return;
        event.preventDefault();
        event.stopPropagation();
        store.select(space.id);
        finish();
      };
      document.addEventListener("keydown", onKeyDown, true);
      return () => document.removeEventListener("keydown", onKeyDown, true);
    });

    if (status !== "ready")
      return (
        <View style={panel}>
          <Text style={body(colors)}>{error ?? "Loading spaces…"}</Text>
          {error ? (
            <Action colors={colors} label="Try again" onPress={() => void store.reload()} />
          ) : null}
        </View>
      );

    if (mode.kind === "rename") {
      const { space } = mode;
      return (
        <Rename
          colors={colors}
          initial={space.name}
          saving={saving}
          error={error}
          onCancel={toList}
          onSave={async (name) => {
            if (await store.rename(space.id, name)) toList();
          }}
        />
      );
    }

    if (mode.kind === "remove") {
      const { space } = mode;
      return (
        <Confirm
          colors={colors}
          message={`Remove “${space.name}”? Its projects move to ${removalTarget(layout, space.id).name}.`}
          busy={saving}
          onCancel={toList}
          onRemove={async () => {
            if (await store.remove(space.id)) toList();
          }}
        />
      );
    }

    const active = layout.spaces.find((space) => space.id === current) ?? layout.spaces[0];
    return (
      <View style={panel}>
        <View style={header}>
          <Text style={caption(colors)}>Spaces</Text>
          {shortcut ? <Chip colors={colors} label="⌘J" /> : null}
        </View>
        {layout.spaces.map((space, index) => (
          <SpaceRow
            key={space.id}
            colors={colors}
            label={space.name}
            checked={space.id === current}
            hint={keyboard && index < 9 ? String(index + 1) : undefined}
            onPress={() => {
              store.select(space.id);
              finish();
            }}
          />
        ))}
        <View style={{ height: 1, backgroundColor: colors.border, marginVertical: 4 }} />
        <Action
          colors={colors}
          icon="Plus"
          label="New space"
          disabled={saving}
          onPress={async () => {
            if (await store.create()) finish();
          }}
        />
        <Action
          colors={colors}
          icon="Pencil"
          label={`Rename “${active.name}”…`}
          disabled={saving}
          onPress={() => setMode({ kind: "rename", space: active })}
        />
        <Action
          colors={colors}
          icon="Trash2"
          label={`Remove “${active.name}”…`}
          disabled={saving || layout.spaces.length === 1}
          onPress={() => setMode({ kind: "remove", space: active })}
        />
        <Action
          colors={colors}
          icon="Settings2"
          label="Manage spaces…"
          onPress={() => {
            dismiss();
            openScreen({ screenId: "manage" });
          }}
        />
        {error ? <Text style={errorText(colors)}>{error}</Text> : null}
      </View>
    );
  }

  return { Item, control };
}

const panel = { gap: 1 };
const header = {
  flexDirection: "row" as const,
  alignItems: "center" as const,
  justifyContent: "space-between" as const,
  // Text starts after the 14px icon column and its 8px gap, like the rows below.
  paddingLeft: 30,
  paddingRight: 8,
  paddingTop: 4,
  paddingBottom: 4,
};
const row = {
  flexDirection: "row" as const,
  alignItems: "center" as const,
  gap: 8,
  minHeight: 28,
  paddingHorizontal: 8,
  borderRadius: 6,
};
const caption = (colors: Colors) => ({ color: colors.foregroundMuted, fontSize: 11 });
const body = (colors: Colors) => ({
  color: colors.foreground,
  fontSize: 13,
  lineHeight: 19,
  paddingHorizontal: 8,
  paddingBottom: 6,
});
const errorText = (colors: Colors) => ({
  color: colors.statusDanger,
  fontSize: 12,
  paddingHorizontal: 8,
  paddingTop: 4,
});
const tint =
  (colors: Colors) =>
  ({ pressed, hovered }: PressableStateCallbackType & { hovered?: boolean }) =>
    pressed ? colors.surface2 : hovered ? colors.surface1 : "transparent";

function Chip({ colors, label }: { colors: Colors; label: string }) {
  return (
    <View
      style={{
        backgroundColor: colors.surface2,
        borderRadius: 4,
        paddingHorizontal: 5,
        minWidth: 18,
      }}
    >
      <Text
        style={{ color: colors.foregroundMuted, fontSize: 11, lineHeight: 17, textAlign: "center" }}
      >
        {label}
      </Text>
    </View>
  );
}

function SpaceRow(props: {
  colors: Colors;
  label: string;
  checked: boolean;
  hint?: string;
  onPress(): void;
}) {
  const { colors } = props;
  return (
    <Pressable
      accessibilityRole="menuitem"
      accessibilityState={{ checked: props.checked }}
      onPress={props.onPress}
      style={(state) => [row, { backgroundColor: tint(colors)(state) }]}
    >
      {/* The check takes the icon column, so names line up with the action labels below and
          the digit keycaps line up with ⌘J above. */}
      <View style={{ width: 14, alignItems: "center" }}>
        {props.checked ? <Icon name="Check" size={14} color={colors.accent} /> : null}
      </View>
      <Text
        numberOfLines={1}
        style={{
          flex: 1,
          color: colors.foreground,
          fontSize: 13,
          fontWeight: props.checked ? "600" : "400",
        }}
      >
        {props.label}
      </Text>
      {props.hint ? <Chip colors={colors} label={props.hint} /> : null}
    </Pressable>
  );
}

function Action(props: {
  colors: Colors;
  label: string;
  icon?: string;
  danger?: boolean;
  disabled?: boolean;
  innerRef?: Ref<View>;
  onPress(): void | Promise<void>;
}) {
  const { colors } = props;
  return (
    <Pressable
      ref={props.innerRef}
      accessibilityRole="menuitem"
      disabled={props.disabled}
      onPress={() => void props.onPress()}
      style={(state) => [
        row,
        { backgroundColor: tint(colors)(state), opacity: props.disabled ? 0.5 : 1 },
      ]}
    >
      {props.icon ? <Icon name={props.icon} size={14} color={colors.foregroundMuted} /> : null}
      <Text
        numberOfLines={1}
        style={{
          flex: 1,
          color: props.danger ? colors.statusDanger : colors.foreground,
          fontSize: 13,
          fontWeight: props.danger ? "600" : "400",
        }}
      >
        {props.label}
      </Text>
    </Pressable>
  );
}

function Rename(props: {
  colors: Colors;
  initial: string;
  saving: boolean;
  error: string | null;
  onSave(name: string): Promise<void>;
  onCancel(): void;
}) {
  const { colors } = props;
  const [draft, setDraft] = useState(props.initial);
  const save = () => (draft.trim() ? props.onSave(draft) : undefined);
  return (
    <View style={panel}>
      <Text style={[caption(colors), { paddingHorizontal: 8 }]}>Rename space</Text>
      <TextInput
        value={draft}
        onChangeText={setDraft}
        onSubmitEditing={() => void save()}
        autoFocus
        selectTextOnFocus
        maxLength={60}
        accessibilityLabel="Space name"
        style={{
          color: colors.foreground,
          borderColor: colors.border,
          borderWidth: 1,
          borderRadius: 6,
          paddingHorizontal: 8,
          paddingVertical: 6,
          marginVertical: 4,
          fontSize: 13,
        }}
      />
      <Action
        colors={colors}
        label="Save"
        disabled={props.saving || !draft.trim()}
        onPress={() => save()}
      />
      <Action colors={colors} label="Cancel" onPress={props.onCancel} />
      {props.error ? <Text style={errorText(colors)}>{props.error}</Text> : null}
    </View>
  );
}

function Confirm(props: {
  colors: Colors;
  message: string;
  busy: boolean;
  onRemove(): Promise<void>;
  onCancel(): void;
}) {
  const { colors } = props;
  const cancel = useRef<View>(null);
  // Cancel holds focus, so Enter on a destructive prompt does the safe thing.
  useEffect(() => (cancel.current as Focusable)?.focus?.(), []);
  return (
    <View style={panel}>
      <Text style={[caption(colors), { paddingHorizontal: 8 }]}>Remove space</Text>
      <Text style={body(colors)}>{props.message}</Text>
      <Action
        colors={colors}
        label="Remove"
        danger
        disabled={props.busy}
        onPress={props.onRemove}
      />
      <Action colors={colors} label="Cancel" onPress={props.onCancel} innerRef={cancel} />
    </View>
  );
}
