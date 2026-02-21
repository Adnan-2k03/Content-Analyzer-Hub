import React, { useCallback } from "react";
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  Pressable,
  ActivityIndicator,
  Platform,
  RefreshControl,
  Alert,
} from "react-native";
import { router } from "expo-router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons, Feather, MaterialCommunityIcons } from "@expo/vector-icons";
import { Image } from "expo-image";
import * as Haptics from "expo-haptics";
import Colors from "@/constants/colors";
import { apiRequest, getQueryFn } from "@/lib/query-client";
import type { ContentItem } from "@shared/schema";

function ContentCard({ item, onDelete }: { item: ContentItem; onDelete: (id: number) => void }) {
  const isProcessing = item.status === "processing";
  const isError = item.status === "error";

  const handlePress = () => {
    if (isProcessing) return;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    router.push({ pathname: "/content/[id]", params: { id: String(item.id) } });
  };

  const handleLongPress = () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    Alert.alert("Delete", "Remove this analysis?", [
      { text: "Cancel", style: "cancel" },
      {
        text: "Delete",
        style: "destructive",
        onPress: () => onDelete(item.id),
      },
    ]);
  };

  let topics: string[] = [];
  try {
    if (item.keyTopics) topics = JSON.parse(item.keyTopics);
  } catch {}

  return (
    <Pressable
      onPress={handlePress}
      onLongPress={handleLongPress}
      style={({ pressed }) => [
        styles.card,
        pressed && !isProcessing && styles.cardPressed,
        isProcessing && styles.cardProcessing,
      ]}
    >
      <View style={styles.cardContent}>
        {item.thumbnailData ? (
          <Image
            source={{ uri: `data:image/jpeg;base64,${item.thumbnailData}` }}
            style={styles.thumbnail}
            contentFit="cover"
          />
        ) : (
          <View style={[styles.thumbnail, styles.thumbnailPlaceholder]}>
            {item.type === "video" ? (
              <Ionicons name="videocam" size={24} color={Colors.textTertiary} />
            ) : (
              <MaterialCommunityIcons name="image-multiple" size={24} color={Colors.textTertiary} />
            )}
          </View>
        )}
        <View style={styles.cardText}>
          <View style={styles.cardHeader}>
            <View
              style={[
                styles.typeBadge,
                { backgroundColor: item.type === "video" ? Colors.secondaryDim : Colors.primaryDim },
              ]}
            >
              <Text
                style={[
                  styles.typeBadgeText,
                  { color: item.type === "video" ? Colors.secondary : Colors.primary },
                ]}
              >
                {item.type === "video"
                  ? item.analysisMode === "multimodal"
                    ? "Full Analysis"
                    : "Metadata"
                  : "Carousel"}
              </Text>
            </View>
            {isProcessing && (
              <ActivityIndicator size="small" color={Colors.primary} />
            )}
            {isError && (
              <Ionicons name="alert-circle" size={16} color={Colors.error} />
            )}
          </View>
          <Text style={styles.cardTitle} numberOfLines={2}>
            {isProcessing ? "Analyzing..." : isError ? "Analysis Failed" : item.title}
          </Text>
          {!isProcessing && !isError && topics.length > 0 && (
            <View style={styles.topicsRow}>
              {topics.slice(0, 3).map((topic, i) => (
                <View key={i} style={styles.topicChip}>
                  <Text style={styles.topicChipText} numberOfLines={1}>{topic}</Text>
                </View>
              ))}
            </View>
          )}
        </View>
      </View>
    </Pressable>
  );
}

export default function LibraryScreen() {
  const insets = useSafeAreaInsets();
  const queryClient = useQueryClient();
  const webTopInset = Platform.OS === "web" ? 67 : 0;

  const { data: items, isLoading, refetch } = useQuery<ContentItem[]>({
    queryKey: ["/api/content"],
    queryFn: getQueryFn({ on401: "throw" }),
    refetchInterval: 5000,
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: number) => {
      await apiRequest("DELETE", `/api/content/${id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/content"] });
    },
  });

  const handleDelete = useCallback(
    (id: number) => {
      deleteMutation.mutate(id);
    },
    [deleteMutation],
  );

  const renderItem = useCallback(
    ({ item }: { item: ContentItem }) => (
      <ContentCard item={item} onDelete={handleDelete} />
    ),
    [handleDelete],
  );

  return (
    <View style={[styles.container, { paddingTop: insets.top + webTopInset }]}>
      <View style={styles.header}>
        <View>
          <Text style={styles.headerTitle}>ContentLens</Text>
          <Text style={styles.headerSubtitle}>
            {items?.length || 0} analyses saved
          </Text>
        </View>
        <Pressable
          onPress={() => {
            Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
            router.push("/add");
          }}
          style={({ pressed }) => [styles.addButton, pressed && styles.addButtonPressed]}
        >
          <Ionicons name="add" size={24} color={Colors.bg} />
        </Pressable>
      </View>

      {isLoading ? (
        <View style={styles.centerContent}>
          <ActivityIndicator size="large" color={Colors.primary} />
        </View>
      ) : !items || items.length === 0 ? (
        <View style={styles.centerContent}>
          <Feather name="inbox" size={48} color={Colors.textTertiary} />
          <Text style={styles.emptyTitle}>No analyses yet</Text>
          <Text style={styles.emptySubtitle}>
            Tap + to analyze a video or screenshot carousel
          </Text>
        </View>
      ) : (
        <FlatList
          data={items}
          renderItem={renderItem}
          keyExtractor={(item) => String(item.id)}
          contentContainerStyle={[styles.list, { paddingBottom: insets.bottom + (Platform.OS === "web" ? 34 : 0) + 20 }]}
          showsVerticalScrollIndicator={false}
          scrollEnabled={!!items && items.length > 0}
          refreshControl={
            <RefreshControl
              refreshing={false}
              onRefresh={refetch}
              tintColor={Colors.primary}
            />
          }
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: Colors.bg,
  },
  header: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingHorizontal: 20,
    paddingTop: 12,
    paddingBottom: 16,
  },
  headerTitle: {
    fontSize: 28,
    fontFamily: "Inter_700Bold",
    color: Colors.text,
  },
  headerSubtitle: {
    fontSize: 14,
    fontFamily: "Inter_400Regular",
    color: Colors.textSecondary,
    marginTop: 2,
  },
  addButton: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: Colors.primary,
    alignItems: "center",
    justifyContent: "center",
  },
  addButtonPressed: {
    opacity: 0.8,
    transform: [{ scale: 0.95 }],
  },
  centerContent: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    gap: 12,
    paddingHorizontal: 40,
  },
  emptyTitle: {
    fontSize: 18,
    fontFamily: "Inter_600SemiBold",
    color: Colors.text,
    marginTop: 8,
  },
  emptySubtitle: {
    fontSize: 14,
    fontFamily: "Inter_400Regular",
    color: Colors.textSecondary,
    textAlign: "center",
    lineHeight: 20,
  },
  list: {
    paddingHorizontal: 16,
    gap: 12,
  },
  card: {
    backgroundColor: Colors.card,
    borderRadius: 16,
    overflow: "hidden",
    marginBottom: 12,
  },
  cardPressed: {
    opacity: 0.85,
    transform: [{ scale: 0.98 }],
  },
  cardProcessing: {
    opacity: 0.7,
  },
  cardContent: {
    flexDirection: "row",
    padding: 12,
    gap: 12,
  },
  thumbnail: {
    width: 72,
    height: 72,
    borderRadius: 10,
  },
  thumbnailPlaceholder: {
    backgroundColor: Colors.surface,
    alignItems: "center",
    justifyContent: "center",
  },
  cardText: {
    flex: 1,
    gap: 6,
  },
  cardHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  typeBadge: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 6,
  },
  typeBadgeText: {
    fontSize: 11,
    fontFamily: "Inter_600SemiBold",
    textTransform: "uppercase",
    letterSpacing: 0.5,
  },
  cardTitle: {
    fontSize: 15,
    fontFamily: "Inter_600SemiBold",
    color: Colors.text,
    lineHeight: 20,
  },
  topicsRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 4,
  },
  topicChip: {
    backgroundColor: Colors.surface,
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 4,
  },
  topicChipText: {
    fontSize: 11,
    fontFamily: "Inter_400Regular",
    color: Colors.textSecondary,
  },
});
