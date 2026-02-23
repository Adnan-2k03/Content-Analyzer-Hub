import React, { useState, useCallback } from "react";
import {
  View,
  Text,
  StyleSheet,
  TextInput,
  Pressable,
  ScrollView,
  ActivityIndicator,
  Alert,
  Platform,
} from "react-native";
import { router } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Ionicons, Feather, MaterialCommunityIcons } from "@expo/vector-icons";
import { Image } from "expo-image";
import * as ImagePicker from "expo-image-picker";
import * as Haptics from "expo-haptics";
import Colors from "@/constants/colors";
import { apiRequest } from "@/lib/query-client";

type ContentType = "video" | "carousel";
type AnalysisMode = "multimodal" | "metadata";

export default function AddContentScreen() {
  const insets = useSafeAreaInsets();
  const queryClient = useQueryClient();
  const webTopInset = Platform.OS === "web" ? 67 : 0;

  const [contentType, setContentType] = useState<ContentType>("video");
  const [videoUrl, setVideoUrl] = useState("");
  const [analysisMode, setAnalysisMode] = useState<AnalysisMode>("metadata");
  const [selectedImages, setSelectedImages] = useState<{ uri: string; base64: string }[]>([]);
  const [carouselUrl, setCarouselUrl] = useState("");

  const submitMutation = useMutation({
    mutationFn: async () => {
      if (contentType === "video") {
        if (!videoUrl.trim()) throw new Error("Please enter a video URL");
        await apiRequest("POST", "/api/content/video", {
          url: videoUrl.trim(),
          mode: analysisMode,
        });
      } else {
        if (selectedImages.length === 0) throw new Error("Please select at least one image");
        await apiRequest("POST", "/api/content/carousel", {
          images: selectedImages.map((img) => img.base64),
          url: carouselUrl.trim() || undefined,
        });
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/content"] });
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      router.back();
    },
    onError: (error: Error) => {
      // Log error and show alert - also keep a console trace for web
      // eslint-disable-next-line no-console
      console.error("Analyze mutation error:", error);
      Alert.alert("Error", error.message || String(error));
    },
  });

  const pickImages = useCallback(async () => {
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ["images"],
      allowsMultipleSelection: true,
      quality: 0.7,
      base64: true,
    });

    if (!result.canceled && result.assets) {
      const newImages = result.assets
        .filter((a) => a.base64)
        .map((a) => ({ uri: a.uri, base64: a.base64! }));
      setSelectedImages((prev) => [...prev, ...newImages]);
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    }
  }, []);

  const removeImage = useCallback((index: number) => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setSelectedImages((prev) => prev.filter((_, i) => i !== index));
  }, []);

  return (
    <View style={[styles.container, { paddingTop: insets.top + webTopInset }]}>
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} hitSlop={12}>
          <Ionicons name="close" size={28} color={Colors.text} />
        </Pressable>
        <Text style={styles.headerTitle}>New Analysis</Text>
        <View style={{ width: 28 }} />
      </View>

      <ScrollView
        style={styles.scrollView}
        contentContainerStyle={[styles.scrollContent, { paddingBottom: insets.bottom + (Platform.OS === "web" ? 34 : 0) + 100 }]}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
      >
        <View style={styles.segmentControl}>
          <Pressable
            onPress={() => {
              setContentType("video");
              Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
            }}
            style={[styles.segmentButton, contentType === "video" && styles.segmentActive]}
          >
            <Ionicons
              name="videocam"
              size={18}
              color={contentType === "video" ? Colors.bg : Colors.textSecondary}
            />
            <Text
              style={[
                styles.segmentText,
                contentType === "video" && styles.segmentTextActive,
              ]}
            >
              Video Link
            </Text>
          </Pressable>
          <Pressable
            onPress={() => {
              setContentType("carousel");
              Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
            }}
            style={[styles.segmentButton, contentType === "carousel" && styles.segmentActive]}
          >
            <MaterialCommunityIcons
              name="image-multiple"
              size={18}
              color={contentType === "carousel" ? Colors.bg : Colors.textSecondary}
            />
            <Text
              style={[
                styles.segmentText,
                contentType === "carousel" && styles.segmentTextActive,
              ]}
            >
              Screenshots
            </Text>
          </Pressable>
        </View>

        {contentType === "video" ? (
          <View style={styles.section}>
            <Text style={styles.label}>Video URL</Text>
            <View style={styles.inputContainer}>
              <Feather name="link" size={18} color={Colors.textTertiary} style={styles.inputIcon} />
              <TextInput
                style={styles.input}
                placeholder="Paste YouTube or Instagram link..."
                placeholderTextColor={Colors.textTertiary}
                value={videoUrl}
                onChangeText={setVideoUrl}
                autoCapitalize="none"
                autoCorrect={false}
                keyboardType="url"
              />
            </View>

            <Text style={[styles.label, { marginTop: 24 }]}>Analysis Mode</Text>
            <View style={styles.modeContainer}>
              <Pressable
                onPress={() => {
                  setAnalysisMode("metadata");
                  Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                }}
                style={[styles.modeCard, analysisMode === "metadata" && styles.modeCardActive]}
              >
                <View style={[styles.modeIconContainer, { backgroundColor: Colors.primaryDim }]}>
                  <Feather name="file-text" size={22} color={Colors.primary} />
                </View>
                <Text style={styles.modeTitle}>Metadata Only</Text>
                <Text style={styles.modeDesc}>
                  Uses existing captions & transcript from the platform. Faster analysis.
                </Text>
                {analysisMode === "metadata" && (
                  <View style={styles.modeCheck}>
                    <Ionicons name="checkmark-circle" size={22} color={Colors.primary} />
                  </View>
                )}
              </Pressable>

              <Pressable
                onPress={() => {
                  setAnalysisMode("multimodal");
                  Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                }}
                style={[styles.modeCard, analysisMode === "multimodal" && styles.modeCardActive]}
              >
                <View style={[styles.modeIconContainer, { backgroundColor: Colors.secondaryDim }]}>
                  <MaterialCommunityIcons name="eye-outline" size={22} color={Colors.secondary} />
                </View>
                <Text style={styles.modeTitle}>Full Multimodal</Text>
                <Text style={styles.modeDesc}>
                  Downloads video, extracts frames & audio for deep AI analysis.
                </Text>
                {analysisMode === "multimodal" && (
                  <View style={styles.modeCheck}>
                    <Ionicons name="checkmark-circle" size={22} color={Colors.secondary} />
                  </View>
                )}
              </Pressable>
            </View>
          </View>
        ) : (
          <View style={styles.section}>
            <Text style={styles.label}>Screenshots</Text>
            <Pressable onPress={pickImages} style={styles.pickButton}>
              <Feather name="image" size={20} color={Colors.primary} />
              <Text style={styles.pickButtonText}>Select from Gallery</Text>
            </Pressable>

            {selectedImages.length > 0 && (
              <ScrollView
                horizontal
                showsHorizontalScrollIndicator={false}
                style={styles.imageStrip}
                contentContainerStyle={styles.imageStripContent}
              >
                {selectedImages.map((img, i) => (
                  <View key={i} style={styles.imageThumbContainer}>
                    <Image source={{ uri: img.uri }} style={styles.imageThumb} contentFit="cover" />
                    <Pressable
                      onPress={() => removeImage(i)}
                      style={styles.imageRemove}
                      hitSlop={8}
                    >
                      <Ionicons name="close-circle" size={22} color={Colors.error} />
                    </Pressable>
                    <View style={styles.imageIndex}>
                      <Text style={styles.imageIndexText}>{i + 1}</Text>
                    </View>
                  </View>
                ))}
              </ScrollView>
            )}

            <Text style={[styles.label, { marginTop: 24 }]}>
              Instagram Link (optional)
            </Text>
            <View style={styles.inputContainer}>
              <Feather name="link" size={18} color={Colors.textTertiary} style={styles.inputIcon} />
              <TextInput
                style={styles.input}
                placeholder="Paste link to get caption..."
                placeholderTextColor={Colors.textTertiary}
                value={carouselUrl}
                onChangeText={setCarouselUrl}
                autoCapitalize="none"
                autoCorrect={false}
                keyboardType="url"
              />
            </View>
          </View>
        )}
      </ScrollView>

      <View style={[styles.footer, { paddingBottom: insets.bottom + (Platform.OS === "web" ? 34 : 0) + 12 }]}>
        <Pressable
          onPress={() => submitMutation.mutate()}
          disabled={submitMutation.isPending}
          style={({ pressed }) => [
            styles.submitButton,
            pressed && styles.submitPressed,
            submitMutation.isPending && styles.submitDisabled,
          ]}
        >
          {submitMutation.isPending ? (
            <ActivityIndicator size="small" color={Colors.bg} />
          ) : (
            <>
              <MaterialCommunityIcons name="creation" size={20} color={Colors.bg} />
              <Text style={styles.submitText}>Analyze</Text>
            </>
          )}
        </Pressable>
      </View>
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
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 20,
    paddingVertical: 14,
  },
  headerTitle: {
    fontSize: 17,
    fontFamily: "Inter_600SemiBold",
    color: Colors.text,
  },
  scrollView: {
    flex: 1,
  },
  scrollContent: {
    paddingHorizontal: 20,
  },
  segmentControl: {
    flexDirection: "row",
    backgroundColor: Colors.surface,
    borderRadius: 12,
    padding: 4,
    marginBottom: 28,
  },
  segmentButton: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    paddingVertical: 10,
    borderRadius: 10,
  },
  segmentActive: {
    backgroundColor: Colors.primary,
  },
  segmentText: {
    fontSize: 14,
    fontFamily: "Inter_600SemiBold",
    color: Colors.textSecondary,
  },
  segmentTextActive: {
    color: Colors.bg,
  },
  section: {},
  label: {
    fontSize: 13,
    fontFamily: "Inter_600SemiBold",
    color: Colors.textSecondary,
    textTransform: "uppercase",
    letterSpacing: 0.8,
    marginBottom: 10,
  },
  inputContainer: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: Colors.surface,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  inputIcon: {
    paddingLeft: 14,
  },
  input: {
    flex: 1,
    paddingHorizontal: 12,
    paddingVertical: 14,
    fontSize: 15,
    fontFamily: "Inter_400Regular",
    color: Colors.text,
  },
  modeContainer: {
    gap: 12,
  },
  modeCard: {
    backgroundColor: Colors.surface,
    borderRadius: 14,
    padding: 16,
    borderWidth: 1.5,
    borderColor: Colors.border,
  },
  modeCardActive: {
    borderColor: Colors.primary,
  },
  modeIconContainer: {
    width: 40,
    height: 40,
    borderRadius: 10,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 10,
  },
  modeTitle: {
    fontSize: 16,
    fontFamily: "Inter_600SemiBold",
    color: Colors.text,
    marginBottom: 4,
  },
  modeDesc: {
    fontSize: 13,
    fontFamily: "Inter_400Regular",
    color: Colors.textSecondary,
    lineHeight: 18,
  },
  modeCheck: {
    position: "absolute",
    top: 14,
    right: 14,
  },
  pickButton: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    backgroundColor: Colors.primaryDim,
    borderRadius: 12,
    paddingVertical: 14,
    borderWidth: 1,
    borderColor: Colors.primary,
    borderStyle: "dashed",
  },
  pickButtonText: {
    fontSize: 15,
    fontFamily: "Inter_500Medium",
    color: Colors.primary,
  },
  imageStrip: {
    marginTop: 14,
  },
  imageStripContent: {
    gap: 10,
  },
  imageThumbContainer: {
    position: "relative",
  },
  imageThumb: {
    width: 80,
    height: 80,
    borderRadius: 10,
  },
  imageRemove: {
    position: "absolute",
    top: -6,
    right: -6,
  },
  imageIndex: {
    position: "absolute",
    bottom: 4,
    left: 4,
    backgroundColor: "rgba(0,0,0,0.6)",
    borderRadius: 4,
    paddingHorizontal: 5,
    paddingVertical: 1,
  },
  imageIndexText: {
    fontSize: 10,
    fontFamily: "Inter_600SemiBold",
    color: Colors.text,
  },
  footer: {
    paddingHorizontal: 20,
    paddingTop: 12,
    borderTopWidth: 1,
    borderTopColor: Colors.border,
    backgroundColor: Colors.bg,
  },
  submitButton: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    backgroundColor: Colors.primary,
    borderRadius: 14,
    paddingVertical: 16,
  },
  submitPressed: {
    opacity: 0.85,
    transform: [{ scale: 0.98 }],
  },
  submitDisabled: {
    opacity: 0.5,
  },
  submitText: {
    fontSize: 16,
    fontFamily: "Inter_700Bold",
    color: Colors.bg,
  },
});
