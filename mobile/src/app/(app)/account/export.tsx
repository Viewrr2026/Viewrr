import { Download, Share2 } from "lucide-react-native";
import { useCallback, useState } from "react";
import { Linking, Share, StyleSheet, Text, View } from "react-native";

import { describeExport, fetchDataExport, type ExportDocument } from "@/api/account";
import { ApiError } from "@/api/errors";
import { AppHeader } from "@/components/AppHeader";
import { Button } from "@/components/Button";
import { Card, CardBody, CardLabel } from "@/components/Card";
import { DataState } from "@/components/DataState";
import { Screen } from "@/components/Screen";
import { SUPPORT_EMAIL, supportMailto } from "@/config/support";
import { useAsyncResource } from "@/hooks/useAsyncResource";
import { spacing, typography, useTheme } from "@/theme";

/**
 * Download my data — GET /api/me/export.
 *
 * The export is the server's own document; mobile does not reshape it. What
 * this screen shows is derived entirely from the real payload: the section
 * names it contains and, where a section is a list, how many records are in it.
 * No section is listed that the export did not return.
 *
 * Handing the file off uses the OS share sheet, which is the only route on iOS
 * that reaches Files, Mail and iCloud Drive without adding a file-system or
 * sharing dependency to this package. Very large exports are flagged rather
 * than silently truncated, with the support address as the fallback.
 */

const LARGE_EXPORT_BYTES = 512 * 1024;

export default function DataExport() {
  const { colors } = useTheme();
  const [shareError, setShareError] = useState<string | null>(null);
  const [sharing, setSharing] = useState(false);

  const load = useCallback((signal: AbortSignal) => fetchDataExport(signal), []);
  const { resource, reload, refreshing, refresh } = useAsyncResource<ExportDocument>(load);

  const onShare = useCallback(async (document: ExportDocument) => {
    setSharing(true);
    setShareError(null);
    try {
      const json = JSON.stringify(document, null, 2);
      await Share.share({
        title: "Viewrr data export",
        message: json,
      });
    } catch (cause) {
      setShareError(
        cause instanceof ApiError
          ? (cause.serverMessage ?? cause.userMessage)
          : `Your device couldn't hand the file off. Email ${SUPPORT_EMAIL} and the team will send it to you.`,
      );
    } finally {
      setSharing(false);
    }
  }, []);

  return (
    <Screen
      scroll
      edges={["top", "left", "right"]}
      refreshing={refreshing}
      onRefresh={resource.phase === "ready" ? refresh : undefined}
    >
      <AppHeader title="Download my data" back bell={false} />

      <DataState resource={resource} onRetry={reload} skeleton="list">
        {(document) => {
          const sections = describeExport(document);
          const bytes = JSON.stringify(document).length;
          const large = bytes > LARGE_EXPORT_BYTES;

          return (
            <View style={styles.body}>
              <Card tone="brand">
                <View style={styles.headRow}>
                  <Download size={20} color={colors.primary} strokeWidth={2.2} />
                  <CardLabel>Your export is ready</CardLabel>
                </View>
                <CardBody>
                  This is everything Viewrr holds about your account, as JSON — roughly{" "}
                  {Math.max(1, Math.round(bytes / 1024))} KB across {sections.length}{" "}
                  {sections.length === 1 ? "section" : "sections"}.
                </CardBody>
              </Card>

              <Card>
                <CardLabel>What&apos;s included</CardLabel>
                <View style={styles.rows}>
                  {sections.map((section) => (
                    <View key={section.key} style={[styles.row, { borderColor: colors.border }]}>
                      <Text style={[styles.rowTitle, { color: colors.foreground }]}>
                        {humanise(section.key)}
                      </Text>
                      <Text style={[styles.rowMeta, { color: colors.mutedForeground }]}>
                        {section.count === null
                          ? "1 record"
                          : `${section.count} ${section.count === 1 ? "record" : "records"}`}
                      </Text>
                    </View>
                  ))}
                </View>
              </Card>

              {large ? (
                <Card>
                  <CardLabel>Large export</CardLabel>
                  <CardBody>
                    Your export is larger than most devices will hand to another app in one go. If
                    sharing fails, email {SUPPORT_EMAIL} and the team will send you the file
                    directly.
                  </CardBody>
                </Card>
              ) : null}

              {shareError ? (
                <Text accessibilityRole="alert" style={[styles.error, { color: colors.destructive }]}>
                  {shareError}
                </Text>
              ) : null}

              <Button
                label="Share or save the file"
                loading={sharing}
                onPress={() => void onShare(document)}
                accessibilityHint="Opens the system share sheet so you can save the export to Files or email it"
              />
              <Button
                label="Ask support to email it"
                variant="ghost"
                onPress={() => void Linking.openURL(supportMailto("Data export request"))}
              />

              <View style={styles.footRow}>
                <Share2 size={14} color={colors.mutedForeground} strokeWidth={2} />
                <Text style={[styles.rowMeta, { color: colors.mutedForeground }]}>
                  Nothing is uploaded anywhere by this screen — the file goes only where you send
                  it.
                </Text>
              </View>
            </View>
          );
        }}
      </DataState>
    </Screen>
  );
}

/** "savedProfiles" / "saved_profiles" → "Saved profiles". */
function humanise(key: string): string {
  const spaced = key
    .replace(/[_-]+/g, " ")
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .trim();
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}

const styles = StyleSheet.create({
  body: {
    gap: spacing[4],
    paddingBottom: spacing[8],
  },
  headRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing[2],
  },
  rows: {
    gap: spacing[1],
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: spacing[3],
    borderTopWidth: StyleSheet.hairlineWidth,
    paddingTop: spacing[2],
    paddingBottom: spacing[1],
  },
  rowTitle: {
    ...typography.smallBold,
    flexShrink: 1,
  },
  rowMeta: {
    ...typography.caption,
    flexShrink: 1,
  },
  footRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing[2],
  },
  error: {
    ...typography.small,
  },
});
