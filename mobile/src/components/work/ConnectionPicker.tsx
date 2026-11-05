import { useEffect, useState } from "react";
import { View } from "react-native";
import { searchConnections, type Connection } from "@/api/projectInvitations";
import { Avatar } from "@/components/Avatar";
import { Button } from "@/components/Button";
import { DataState } from "@/components/DataState";
import { ListRow } from "@/components/ListRow";
import { TextField } from "@/components/TextField";
import { FormMessage } from "@/components/work/FormControls";
import { useAsyncResource } from "@/hooks/useAsyncResource";
import { spacing } from "@/theme";

export function ConnectionPicker({
  selected,
  onSelect,
  role,
}: {
  selected: Connection | null;
  onSelect: (person: Connection | null) => void;
  role?: string;
}) {
  const [search, setSearch] = useState("");
  const [query, setQuery] = useState("");
  useEffect(() => {
    const timer = setTimeout(() => setQuery(search.trim()), 250);
    return () => clearTimeout(timer);
  }, [search]);
  const data = useAsyncResource((signal) => searchConnections(query, signal), {
    enabled: query.length >= 2 && !selected,
    deps: [query],
  });
  if (selected)
    return (
      <View style={{ gap: spacing[2] }}>
        <ListRow
          title={selected.name}
          subtitle={selected.headline ?? selected.role}
          leading={
            <Avatar name={selected.name} uri={selected.avatar} size="md" />
          }
        />
        <Button
          label="Change connection"
          variant="ghost"
          onPress={() => onSelect(null)}
        />
      </View>
    );
  return (
    <View style={{ gap: spacing[2] }}>
      <TextField
        label="Find a connection"
        placeholder="Search by name…"
        value={search}
        onChangeText={setSearch}
      />
      {search.trim().length < 2 ? (
        <FormMessage text="Enter at least two characters. Only your existing connections appear here." />
      ) : search.trim() !== query ? (
        <FormMessage text="Searching…" />
      ) : (
        <DataState
          resource={data.resource}
          onRetry={data.reload}
          skeleton="list"
          skeletonRows={2}
        >
          {(results) => {
            const matches = results.filter(
              (person) => !role || person.role === role,
            );
            return matches.length ? (
              <>
                {matches.map((person) => (
                  <ListRow
                    key={person.id}
                    title={person.name}
                    subtitle={person.headline ?? person.role}
                    leading={
                      <Avatar
                        name={person.name}
                        uri={person.avatar}
                        size="md"
                      />
                    }
                    onPress={() => onSelect(person)}
                    chevron
                  />
                ))}
              </>
            ) : (
              <FormMessage text="No matching connections. Connect with them in Discover first." />
            );
          }}
        </DataState>
      )}
    </View>
  );
}
