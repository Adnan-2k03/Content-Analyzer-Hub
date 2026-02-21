import React, { useState, useRef, useCallback } from "react";
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  Pressable,
  TextInput,
  ActivityIndicator,
  Platform,
  KeyboardAvoidingView,
  FlatList,
} from "react-native";
import { router, useLocalSearchParams } from "expo-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons, Feather, MaterialCommunityIcons } from "@expo/vector-icons";
import { Image } from "expo-image";
import * as Haptics from "expo-haptics";
import { fetch } from "expo/fetch";
import Colors from "@/constants/colors";
import { getQueryFn, getApiUrl } from "@/lib/query-client";
import type { ContentItem, ContentImage, QAMessage } from "@shared/schema";

type DetailData = ContentItem & { images: ContentImage[]; qa: QAMessage[] };

function SectionHeader({ icon, title }: { icon: React.ReactNode; title: string }) {
  return (
    <View style={styles.sectionHeader}>
      {icon}
      <Text style={styles.sectionTitle}>{title}</Text>
    </View>
  );
}

function TopicChip({ topic }: { topic: string }) {
  return (
    <View style={styles.topicChip}>
      <Text style={styles.topicChipText}>{topic}</Text>
    </View>
  );
}

export default function ContentDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const insets = useSafeAreaInsets();
  const queryClient = useQueryClient();
  const webTopInset = Platform.OS === "web" ? 67 : 0;

  const [question, setQuestion] = useState("");
  const [isAsking, setIsAsking] = useState(false);
  const [streamingAnswer, setStreamingAnswer] = useState("");
  const scrollRef = useRef<ScrollView>(null);

  const { data, isLoading, refetch } = useQuery<DetailData>({
    queryKey: [`/api/content/${id}`],
    queryFn: getQueryFn({ on401: "throw" }),
    refetchInterval: (query) => {
      const d = query.state.data as DetailData | undefined;
      return d?.status === "processing" ? 3000 : false;
    },
  });

  const askQuestion = useCallback(async () => {
    if (!question.trim() || isAsking) return;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setIsAsking(true);
    setStreamingAnswer("");

    const q = question.trim();
    setQuestion("");

    try {
      const baseUrl = getApiUrl();
      const url = new URL(`/api/content/${id}/qa`, baseUrl);

      const response = await fetch(url.toString(), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ question: q }),
      });

      if (!response.ok) throw new Error("Failed to ask question");

      const reader = response.body?.getReader();
      if (!reader) throw new Error("No response body");

      const decoder = new TextDecoder();
      let buffer = "";
      let fullAnswer = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() || "";

        for (const line of lines) {
          if (!line.startsWith("data: ")) continue;
          try {
            const event = JSON.parse(line.slice(6));
            if (event.content) {
              fullAnswer += event.content;
              setStreamingAnswer(fullAnswer);
            }
            if (event.done) {
              setStreamingAnswer("");
              refetch();
            }
          } catch {}
        }
      }
    } catch (err) {
      console.error("Q&A error:", err);
    } finally {
      setIsAsking(false);
      setStreamingAnswer("");
    }
  }, [question, isAsking, id, refetch]);

  if (isLoading) {
    return (
      <View style={[styles.container, styles.center, { paddingTop: insets.top + webTopInset }]}>
        <ActivityIndicator size="large" color={Colors.primary} />
      </View>
    );
  }

  if (!data) {
    return (
      <View style={[styles.container, styles.center, { paddingTop: insets.top + webTopInset }]}>
        <Text style={styles.errorText}>Content not found</Text>
        <Pressable onPress={() => router.back()}>
          <Text style={styles.linkText}>Go back</Text>
        </Pressable>
      </View>
    );
  }

  let topics: string[] = [];
  try {
    if (data.keyTopics) topics = JSON.parse(data.keyTopics);
  } catch {}

  const isProcessing = data.status === "processing";
  const isError = data.status === "error";

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === "ios" ? "padding" : "height"}
      keyboardVerticalOffset={0}
    >
      <View style={[styles.topBar, { paddingTop: insets.top + webTopInset + 8 }]}>
        <Pressable onPress={() => router.back()} hitSlop={12} style={styles.backButton}>
          <Ionicons name="chevron-back" size={24} color={Colors.text} />
        </Pressable>
        <Text style={styles.topBarTitle} numberOfLines={1}>
          {isProcessing ? "Analyzing..." : data.title}
        </Text>
        <View style={{ width: 36 }} />
      </View>

      <ScrollView
        ref={scrollRef}
        style={styles.scrollView}
        contentContainerStyle={[styles.scrollContent]}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="interactive"
      >
        {isProcessing && (
          <View style={styles.processingBanner}>
            <ActivityIndicator size="small" color={Colors.primary} />
            <Text style={styles.processingText}>
              Analysis in progress... This may take a moment.
            </Text>
          </View>
        )}

        {isError && (
          <View style={styles.errorBanner}>
            <Ionicons name="alert-circle" size={18} color={Colors.error} />
            <Text style={styles.errorBannerText}>
              {data.errorMessage || "Analysis failed"}
            </Text>
          </View>
        )}

        {data.type === "carousel" && data.images && data.images.length > 0 && (
          <View style={styles.section}>
            <SectionHeader
              icon={<MaterialCommunityIcons name="image-multiple" size={18} color={Colors.primary} />}
              title="Screenshots"
            />
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={styles.carouselStrip}
            >
              {data.images.map((img, i) => (
                <Image
                  key={img.id}
                  source={{ uri: `data:image/jpeg;base64,${img.imageData}` }}
                  style={styles.carouselImage}
                  contentFit="cover"
                />
              ))}
            </ScrollView>
          </View>
        )}

        {data.url && (
          <View style={styles.urlContainer}>
            <Feather name="link" size={14} color={Colors.textTertiary} />
            <Text style={styles.urlText} numberOfLines={1}>
              {data.url}
            </Text>
          </View>
        )}

        {!isProcessing && !isError && (
          <>
            {data.summary && (
              <View style={styles.section}>
                <SectionHeader
                  icon={<Feather name="align-left" size={18} color={Colors.primary} />}
                  title="Summary"
                />
                <Text style={styles.bodyText}>{data.summary}</Text>
              </View>
            )}

            {topics.length > 0 && (
              <View style={styles.section}>
                <SectionHeader
                  icon={<Feather name="hash" size={18} color={Colors.secondary} />}
                  title="Key Topics"
                />
                <View style={styles.topicsContainer}>
                  {topics.map((topic, i) => (
                    <TopicChip key={i} topic={topic} />
                  ))}
                </View>
              </View>
            )}

            {data.transcript && (
              <View style={styles.section}>
                <SectionHeader
                  icon={<Feather name="mic" size={18} color={Colors.warning} />}
                  title="Transcript"
                />
                <View style={styles.transcriptBox}>
                  <Text style={styles.transcriptText}>{data.transcript}</Text>
                </View>
              </View>
            )}

            {data.insights && (
              <View style={styles.section}>
                <SectionHeader
                  icon={<MaterialCommunityIcons name="lightbulb-outline" size={18} color={Colors.accent} />}
                  title="Insights"
                />
                <Text style={styles.bodyText}>{data.insights}</Text>
              </View>
            )}

            {data.rawCaption && (
              <View style={styles.section}>
                <SectionHeader
                  icon={<Feather name="message-square" size={18} color={Colors.textSecondary} />}
                  title="Original Caption"
                />
                <View style={styles.captionBox}>
                  <Text style={styles.captionText}>{data.rawCaption}</Text>
                </View>
              </View>
            )}

            <View style={styles.section}>
              <SectionHeader
                icon={<MaterialCommunityIcons name="chat-question-outline" size={18} color={Colors.primary} />}
                title="Ask Questions"
              />

              {data.qa && data.qa.length > 0 && (
                <View style={styles.qaList}>
                  {data.qa.map((msg) => (
                    <View
                      key={msg.id}
                      style={[
                        styles.qaBubble,
                        msg.role === "user" ? styles.qaUser : styles.qaAssistant,
                      ]}
                    >
                      <Text
                        style={[
                          styles.qaText,
                          msg.role === "user" ? styles.qaUserText : styles.qaAssistantText,
                        ]}
                      >
                        {msg.content}
                      </Text>
                    </View>
                  ))}
                </View>
              )}

              {streamingAnswer ? (
                <View style={[styles.qaBubble, styles.qaAssistant]}>
                  <Text style={[styles.qaText, styles.qaAssistantText]}>
                    {streamingAnswer}
                  </Text>
                </View>
              ) : null}
            </View>
          </>
        )}
        <View style={{ height: 80 }} />
      </ScrollView>

      {!isProcessing && !isError && (
        <View
          style={[
            styles.inputBar,
            { paddingBottom: insets.bottom + (Platform.OS === "web" ? 34 : 0) + 8 },
          ]}
        >
          <TextInput
            style={styles.questionInput}
            placeholder="Ask about this content..."
            placeholderTextColor={Colors.textTertiary}
            value={question}
            onChangeText={setQuestion}
            multiline
            editable={!isAsking}
          />
          <Pressable
            onPress={askQuestion}
            disabled={!question.trim() || isAsking}
            style={({ pressed }) => [
              styles.sendButton,
              (!question.trim() || isAsking) && styles.sendDisabled,
              pressed && styles.sendPressed,
            ]}
          >
            {isAsking ? (
              <ActivityIndicator size="small" color={Colors.bg} />
            ) : (
              <Ionicons name="arrow-up" size={20} color={Colors.bg} />
            )}
          </Pressable>
        </View>
      )}
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: Colors.bg,
  },
  center: {
    alignItems: "center",
    justifyContent: "center",
    gap: 12,
  },
  topBar: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 12,
    paddingBottom: 12,
    borderBottomWidth: 1,
    borderBottomColor: Colors.border,
    backgroundColor: Colors.bg,
  },
  backButton: {
    width: 36,
    height: 36,
    alignItems: "center",
    justifyContent: "center",
  },
  topBarTitle: {
    flex: 1,
    fontSize: 17,
    fontFamily: "Inter_600SemiBold",
    color: Colors.text,
    textAlign: "center",
    marginHorizontal: 8,
  },
  scrollView: {
    flex: 1,
  },
  scrollContent: {
    paddingHorizontal: 20,
    paddingTop: 16,
  },
  processingBanner: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    backgroundColor: Colors.primaryDim,
    borderRadius: 12,
    padding: 14,
    marginBottom: 16,
  },
  processingText: {
    fontSize: 14,
    fontFamily: "Inter_500Medium",
    color: Colors.primary,
    flex: 1,
  },
  errorBanner: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    backgroundColor: "rgba(255, 71, 87, 0.1)",
    borderRadius: 12,
    padding: 14,
    marginBottom: 16,
  },
  errorBannerText: {
    fontSize: 14,
    fontFamily: "Inter_500Medium",
    color: Colors.error,
    flex: 1,
  },
  errorText: {
    fontSize: 16,
    fontFamily: "Inter_500Medium",
    color: Colors.textSecondary,
  },
  linkText: {
    fontSize: 14,
    fontFamily: "Inter_600SemiBold",
    color: Colors.primary,
  },
  urlContainer: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    marginBottom: 20,
    paddingHorizontal: 12,
    paddingVertical: 8,
    backgroundColor: Colors.surface,
    borderRadius: 8,
  },
  urlText: {
    fontSize: 13,
    fontFamily: "Inter_400Regular",
    color: Colors.textTertiary,
    flex: 1,
  },
  section: {
    marginBottom: 24,
  },
  sectionHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    marginBottom: 10,
  },
  sectionTitle: {
    fontSize: 14,
    fontFamily: "Inter_700Bold",
    color: Colors.text,
    textTransform: "uppercase",
    letterSpacing: 0.5,
  },
  bodyText: {
    fontSize: 15,
    fontFamily: "Inter_400Regular",
    color: Colors.textSecondary,
    lineHeight: 22,
  },
  topicsContainer: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
  },
  topicChip: {
    backgroundColor: Colors.secondaryDim,
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 8,
  },
  topicChipText: {
    fontSize: 13,
    fontFamily: "Inter_500Medium",
    color: Colors.secondary,
  },
  transcriptBox: {
    backgroundColor: Colors.surface,
    borderRadius: 12,
    padding: 14,
    maxHeight: 200,
  },
  transcriptText: {
    fontSize: 13,
    fontFamily: "Inter_400Regular",
    color: Colors.textSecondary,
    lineHeight: 20,
  },
  captionBox: {
    backgroundColor: Colors.surface,
    borderRadius: 12,
    padding: 14,
    borderLeftWidth: 3,
    borderLeftColor: Colors.textTertiary,
  },
  captionText: {
    fontSize: 13,
    fontFamily: "Inter_400Regular",
    color: Colors.textSecondary,
    lineHeight: 20,
    fontStyle: "italic",
  },
  carouselStrip: {
    gap: 10,
    paddingVertical: 4,
  },
  carouselImage: {
    width: 160,
    height: 200,
    borderRadius: 12,
  },
  qaList: {
    gap: 10,
    marginBottom: 12,
  },
  qaBubble: {
    maxWidth: "85%",
    borderRadius: 16,
    padding: 12,
  },
  qaUser: {
    alignSelf: "flex-end",
    backgroundColor: Colors.primary,
    borderBottomRightRadius: 4,
  },
  qaAssistant: {
    alignSelf: "flex-start",
    backgroundColor: Colors.card,
    borderBottomLeftRadius: 4,
  },
  qaText: {
    fontSize: 14,
    fontFamily: "Inter_400Regular",
    lineHeight: 20,
  },
  qaUserText: {
    color: Colors.bg,
  },
  qaAssistantText: {
    color: Colors.text,
  },
  inputBar: {
    flexDirection: "row",
    alignItems: "flex-end",
    gap: 8,
    paddingHorizontal: 16,
    paddingTop: 10,
    borderTopWidth: 1,
    borderTopColor: Colors.border,
    backgroundColor: Colors.bg,
  },
  questionInput: {
    flex: 1,
    backgroundColor: Colors.surface,
    borderRadius: 22,
    paddingHorizontal: 16,
    paddingVertical: 10,
    paddingRight: 14,
    fontSize: 15,
    fontFamily: "Inter_400Regular",
    color: Colors.text,
    maxHeight: 100,
  },
  sendButton: {
    width: 38,
    height: 38,
    borderRadius: 19,
    backgroundColor: Colors.primary,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 2,
  },
  sendDisabled: {
    opacity: 0.4,
  },
  sendPressed: {
    opacity: 0.8,
    transform: [{ scale: 0.95 }],
  },
});
