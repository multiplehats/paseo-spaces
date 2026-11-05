import type { PluginScreenProps } from "@getpaseo/plugin/client";
import { getPaseoClient, useHosts } from "@getpaseo/plugin/client";
import {
  ScrollView,
  SettingsAction,
  SettingsRow,
  SettingsSection,
  SettingsSelect,
  TextInput,
} from "@getpaseo/plugin/client/ui";
import { useQuery } from "@tanstack/react-query";
import { useState, useSyncExternalStore } from "react";
import { Pressable, Text, View } from "react-native";
import { type Layout, removalTarget, type Space, spaceFor } from "../shared/layout";
import { type HostApi, type HostProject, listHostProjects } from "./hosts";
import type { Store } from "./store";

type Colors = PluginScreenProps["theme"]["colors"];

interface Project extends HostProject {
  hosts: string[];
}

/** Every project on every online host, one entry per sidebar view key. */
async function loadProjects(hosts: readonly { serverId: string; label: string }[]) {
  const merged = new Map<string, Project>();
  await Promise.all(
    hosts.map(async ({ serverId, label }) => {
      let projects: HostProject[];
      try {
        projects = await listHostProjects(getPaseoClient(serverId) as HostApi, serverId);
      } catch {
        return;
      }
      for (const project of projects) {
        const known = merged.get(project.viewKey);
        if (known) known.hosts.push(label);
        else merged.set(project.viewKey, { ...project, hosts: [label] });
      }
    }),
  );
  return [...merged.values()].sort((a, b) => a.name.localeCompare(b.name));
}

export function createManageScreen(store: Store) {
  return function ManageScreen({ theme, layout: screen }: PluginScreenProps) {
    const { status, layout, saving, error } = useSyncExternalStore(
      store.subscribe,
      store.getSnapshot,
      store.getSnapshot,
    );
    const colors = theme.colors;
    const online = useHosts().filter((host) => host.status === "online");
    const projects = useQuery({
      queryKey: ["spaces", "projects", online.map((host) => host.serverId)],
      queryFn: () => loadProjects(online),
      refetchInterval: 30_000,
    });
    const list = projects.data ?? [];
    const options = layout.spaces.map((space) => ({ label: space.name, value: space.id }));

    return (
      <ScrollView
        style={{ flex: 1, backgroundColor: colors.surface0 }}
        contentContainerStyle={{ padding: screen.compact ? 16 : 24, gap: 24 }}
      >
        {error ? <Text style={{ color: colors.statusDanger }}>{error}</Text> : null}
        <SettingsSection title="Spaces">
          {status !== "ready" ? (
            <SettingsAction
              label={status === "loading" ? "Loading spaces…" : "Spaces could not be loaded"}
              actionLabel="Try again"
              onPress={() => store.retry()}
            />
          ) : (
            <>
              {layout.spaces.map((space) => (
                <SpaceRow
                  key={space.id}
                  space={space}
                  layout={layout}
                  count={list.filter((p) => spaceFor(layout, p.viewKey) === space.id).length}
                  counted={projects.isSuccess}
                  disabled={saving}
                  colors={colors}
                  store={store}
                />
              ))}
              <SettingsAction
                label="Add a space"
                actionLabel="New space"
                disabled={saving}
                onPress={() => void store.create()}
              />
            </>
          )}
        </SettingsSection>
        <SettingsSection title="Projects">
          {projects.isPending ? (
            <Text style={{ color: colors.foregroundMuted }}>Loading projects…</Text>
          ) : list.length === 0 ? (
            <Text style={{ color: colors.foregroundMuted }}>No connected host has projects.</Text>
          ) : (
            list.map((project) => (
              <SettingsSelect
                key={project.viewKey}
                label={project.name}
                // Host names only help tell projects apart when more than one host is connected.
                hint={online.length > 1 ? project.hosts.join(", ") : undefined}
                value={spaceFor(layout, project.viewKey)}
                options={options}
                disabled={status !== "ready" || saving}
                onValueChange={(id) => void store.assign(project.viewKey, id)}
              />
            ))
          )}
        </SettingsSection>
      </ScrollView>
    );
  };
}

/** One row per Space: rename and remove happen in place. */
function SpaceRow(props: {
  space: Space;
  layout: Layout;
  count: number;
  counted: boolean;
  disabled: boolean;
  colors: Colors;
  store: Store;
}) {
  const { space, store, colors } = props;
  const [mode, setMode] = useState<"view" | "rename" | "remove">("view");
  const [draft, setDraft] = useState(space.name);
  const removable = props.layout.spaces.length > 1;
  const projects = `${props.count} ${props.count === 1 ? "project" : "projects"}`;

  if (mode === "rename") {
    const save = async () => {
      if (draft.trim() && (await store.rename(space.id, draft))) setMode("view");
    };
    return (
      <SettingsRow label={`Rename “${space.name}”`}>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
          <TextInput
            value={draft}
            onChangeText={setDraft}
            onSubmitEditing={() => void save()}
            autoFocus
            selectTextOnFocus
            maxLength={60}
            accessibilityLabel="Space name"
            style={{
              minWidth: 160,
              color: colors.foreground,
              borderColor: colors.border,
              borderWidth: 1,
              borderRadius: 6,
              paddingHorizontal: 8,
              paddingVertical: 5,
              fontSize: 13,
            }}
          />
          <Button
            colors={colors}
            label="Save"
            disabled={props.disabled || !draft.trim()}
            onPress={save}
          />
          <Button colors={colors} label="Cancel" onPress={() => setMode("view")} />
        </View>
      </SettingsRow>
    );
  }

  if (mode === "remove")
    return (
      <SettingsRow
        label={`Remove “${space.name}”?`}
        hint={`Its projects move to ${removalTarget(props.layout, space.id).name}.`}
      >
        <View style={{ flexDirection: "row", gap: 8 }}>
          <Button
            colors={colors}
            label="Remove"
            danger
            disabled={props.disabled}
            onPress={async () => {
              if (await store.remove(space.id)) setMode("view");
            }}
          />
          <Button colors={colors} label="Cancel" onPress={() => setMode("view")} />
        </View>
      </SettingsRow>
    );

  return (
    <SettingsRow label={space.name} hint={props.counted ? projects : undefined}>
      <View style={{ flexDirection: "row", gap: 8 }}>
        <Button
          colors={colors}
          label="Rename"
          disabled={props.disabled}
          onPress={() => {
            setDraft(space.name);
            setMode("rename");
          }}
        />
        {removable ? (
          <Button
            colors={colors}
            label="Remove…"
            disabled={props.disabled}
            onPress={() => setMode("remove")}
          />
        ) : null}
      </View>
    </SettingsRow>
  );
}

function Button(props: {
  colors: Colors;
  label: string;
  danger?: boolean;
  disabled?: boolean;
  onPress(): void | Promise<void>;
}) {
  const { colors } = props;
  return (
    <Pressable
      accessibilityRole="button"
      disabled={props.disabled}
      onPress={() => void props.onPress()}
      style={({ pressed }) => ({
        paddingHorizontal: 12,
        paddingVertical: 7,
        borderRadius: 8,
        borderWidth: 1,
        borderColor: colors.border,
        backgroundColor: pressed ? colors.surface2 : "transparent",
        opacity: props.disabled ? 0.5 : 1,
      })}
    >
      <Text
        style={{
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
